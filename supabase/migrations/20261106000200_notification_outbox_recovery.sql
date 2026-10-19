-- ===========================================================================
-- 20261106 (3/3): The notification outbox could be wedged permanently by a
-- single row.
--
-- THE BUG (three facts that only bite in combination):
--
--   1. notification_outbox_attempts_valid caps attempts at 10.
--   2. claim_due_notifications (20261006000000:194) does
--      `SET attempts = o.attempts + 1` with no ceiling check.
--   3. notify-dispatch's stuck-row sweep re-queues anything left in 'sending'
--      past the window (notify-dispatch/index.ts) with NO attempts filter.
--
-- A row is parked as 'failed' at attempts = 10 by finish_notification — so the
-- only way to reach `queued` with attempts = 10 is exactly the crash the sweep
-- exists to repair: the function killed between claiming attempt #10 and
-- finishing it (realistic, because a hung provider call rides the wall clock).
-- The sweep re-queues it, the next claim computes 11, the CHECK raises — and
-- because the claim is ONE statement, claim_due_notifications errors and the
-- handler returns 500 *without claiming a single row*. Every subsequent
-- 5-minute run repeats: sweep, re-queue, CHECK violation, 500. Notification
-- delivery for every member stops until an operator edits one row by hand.
--
-- THE FIX is to make the ceiling impossible to cross, not just higher:
--
--   * claim_due_notifications skips rows already at the ceiling, so it can
--     never raise again;
--   * finish_notification parks at the ceiling;
--   * park_exhausted_notifications() moves anything at the ceiling to 'failed'
--     so the desk sees it and the outbox keeps draining;
--   * the dispatcher calls it before every claim.
--
-- The ceiling moves 10 -> 25 so a provider outage is retried for longer before
-- a human is asked to look, and so the ceiling is not the exact value a crash
-- lands on.
--
-- This migration also REPAIRS an already-wedged outbox: any row sitting at or
-- above the ceiling in a live state is parked, so a database that is currently
-- in the broken state recovers on deploy rather than staying stuck.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The ceiling. Attempts stay bounded, so the retry loop stays bounded.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_attempts_valid;
ALTER TABLE public.notification_outbox
  ADD CONSTRAINT notification_outbox_attempts_valid
  CHECK (attempts >= 0 AND attempts <= 25);

COMMENT ON COLUMN public.notification_outbox.attempts IS
  'Delivery attempts. The ceiling (25) MUST agree with claim_due_notifications '
  '(skips rows at the ceiling), finish_notification (parks them) and '
  'park_exhausted_notifications(). A claim that increments past the CHECK '
  'raises, and because the claim is a single statement the whole batch dies '
  'with it — which is the permanent-outage failure the ceiling exists to '
  'prevent.';

-- ---------------------------------------------------------------------------
-- 2. The claim can no longer raise. It is still one atomic statement, and it
--    still takes no row another worker holds (FOR UPDATE SKIP LOCKED).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_due_notifications(_limit int DEFAULT 25)
RETURNS SETOF public.notification_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH due AS (
    SELECT id
    FROM public.notification_outbox
    WHERE status = 'queued'
      AND scheduled_for <= now()
      -- Never claim a row that is already at the ceiling: the increment below
      -- would violate notification_outbox_attempts_valid and take the entire
      -- batch down with it. A row that gets here was missed by
      -- park_exhausted_notifications; it is skipped rather than fatal.
      AND attempts < 25
    ORDER BY scheduled_for
    LIMIT greatest(1, least(_limit, 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_outbox o
  SET status = 'sending', attempts = o.attempts + 1
  FROM due
  WHERE o.id = due.id
  RETURNING o.*;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_due_notifications(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_notifications(int) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Parking moves to the same ceiling.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_notification(
  _id uuid,
  _ok boolean,
  _error text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.notification_outbox
  SET status = CASE
        WHEN _ok THEN 'sent'
        -- Give up at the ceiling; the desk sees the last error. Must match the
        -- CHECK above and claim_due_notifications.
        WHEN attempts >= 25 THEN 'failed'
        ELSE 'queued'
      END,
      sent_at = CASE WHEN _ok THEN now() ELSE NULL END,
      last_error = CASE WHEN _ok THEN NULL ELSE left(_error, 500) END,
      scheduled_for = CASE
        WHEN _ok THEN scheduled_for
        ELSE now() + make_interval(secs => least(3600, 30 * power(2, greatest(attempts - 1, 0))::int))
      END
  WHERE id = _id AND status = 'sending';
END; $$;

REVOKE EXECUTE ON FUNCTION public.finish_notification(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_notification(uuid, boolean, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The safety net the dispatcher calls before every claim, so a row that
--    exhausts its attempts becomes a desk-visible failure instead of a
--    permanent stall. Idempotent and cheap (partial index on status).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.park_exhausted_notifications()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _parked int := 0;
BEGIN
  UPDATE public.notification_outbox
  SET status = 'failed',
      last_error = coalesce(left(last_error, 400), 'Gave up after 25 attempts')
  WHERE attempts >= 25
    AND status IN ('queued', 'sending');

  GET DIAGNOSTICS _parked = ROW_COUNT;
  RETURN _parked;
END; $$;

REVOKE EXECUTE ON FUNCTION public.park_exhausted_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.park_exhausted_notifications() TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Repair a database that is wedged right now. Order matters: park first, so
--    the assertion that follows describes the state after recovery.
-- ---------------------------------------------------------------------------
SELECT public.park_exhausted_notifications();

-- ---------------------------------------------------------------------------
-- 6. Fail-loud assertions. The three places that must agree about the ceiling
--    are checked together, because disagreement is what caused the outage.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _claim text;
  _finish text;
  _stuck int;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _claim
  FROM pg_proc WHERE proname = 'claim_due_notifications' AND pronamespace = 'public'::regnamespace;
  SELECT pg_get_functiondef(oid) INTO _finish
  FROM pg_proc WHERE proname = 'finish_notification' AND pronamespace = 'public'::regnamespace;

  IF _claim IS NULL OR _claim NOT LIKE '%attempts < 25%' THEN
    RAISE EXCEPTION
      'REGRESSION: claim_due_notifications must skip rows at the attempts ceiling, or one poisoned row stops every notification';
  END IF;

  IF _finish IS NULL OR _finish NOT LIKE '%attempts >= 25%' THEN
    RAISE EXCEPTION
      'REGRESSION: finish_notification must park at the same ceiling claim_due_notifications skips (25)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'notification_outbox_attempts_valid'
      AND c.conrelid = 'public.notification_outbox'::regclass
      AND pg_get_constraintdef(c.oid) LIKE '%25%'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: the attempts ceiling must be 25 to match the claim and finish logic';
  END IF;

  -- The terminal state of this migration: nothing live may sit at the ceiling.
  SELECT count(*) INTO _stuck
  FROM public.notification_outbox
  WHERE attempts >= 25 AND status IN ('queued', 'sending');

  IF _stuck > 0 THEN
    RAISE EXCEPTION
      'REGRESSION: % outbox row(s) sit at the ceiling in a live state and would stall the pipeline', _stuck;
  END IF;
END $$;
