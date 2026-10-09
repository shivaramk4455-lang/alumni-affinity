-- ===========================================================================
-- 20261027: Reconcile the paid-allowance truth (follow-up to 20261008/10/11).
--
-- TWO COUNTERS DISAGREE. The live send gate is enforce_intro_allowance()
-- (20261011): it counts qualifying `interests` rows in the current billing
-- window, scaled by the sender's reciprocity multiplier. The
-- subscriptions.requests_used column is displayed in Settings
-- ("N introductions sent this month", settings.tsx) and reset to 0 by the
-- webhook on subscription.activated / invoice.paid — but nothing ever
-- increments it: public.record_intro_usage() has no caller in src/** or
-- supabase/functions/**. A paying member therefore sees "No introductions
-- sent this month" after sending several, and support sees a different
-- number than the gate enforces.
--
-- SAFE DEFAULT (product decision, flagged): make requests_used a
-- maintained mirror of the trigger's count instead of deleting it. The UI
-- already reads it; support tooling may too. Deriving it from the same
-- qualifying-row definition the trigger counts means the display and the
-- gate can never disagree again:
--   * qualifying = sender's non-declined interests created in the current
--     billing window (coalesce period_start, 30d fallback — same as the
--     trigger), excluding the row being written on renewals.
--   * maintained by the same trigger, after the gate passes: INSERT of a
--     fresh pending row and UPDATE renewals (declined/withdrawn/expired ->
--     pending) recompute the sender's count onto their live subscription
--     row (same live-row choice as record_intro_usage: active >
--     authenticated > pending, newest).
--   * record_intro_usage() is kept as the service-role API (desk tooling
--     may call it) but redefined to recompute rather than +1, so a manual
--     call converges instead of drifting.
--   * webhook resets to 0 on invoice.paid / subscription.activated stay as
--     the period boundary; the next send recomputes from the new window.
-- Existing rows are backfilled from the same definition, so deploying never
-- shows a paying member a sudden 0 they did not earn.
-- ===========================================================================

-- 1. Single definition of "qualifying sends in the current window".
CREATE OR REPLACE FUNCTION public.count_intro_usage(_user uuid)
RETURNS int
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _n int := 0;
BEGIN
  IF _user IS NULL THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO _n
  FROM public.interests i
  JOIN public.subscriptions s
    ON s.user_id = _user
   AND s.status IN ('authenticated', 'active', 'pending')
  WHERE i.sender_id = _user
    AND i.status <> 'declined'
    AND i.created_at >= coalesce(s.period_start, now() - interval '30 days');

  RETURN coalesce(_n, 0);
END; $$;

REVOKE EXECUTE ON FUNCTION public.count_intro_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_intro_usage(uuid) TO service_role;

-- 2. Mirror-maintenance: after the gate passes on a fresh/renewed ask,
-- recompute the sender's live row from the shared definition.
CREATE OR REPLACE FUNCTION public.mirror_intro_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sub uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (TG_OP = 'INSERT' AND NEW.status = 'pending')
    OR (TG_OP = 'UPDATE'
        AND OLD.status IN ('declined', 'withdrawn', 'expired')
        AND NEW.status = 'pending')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO _sub
  FROM public.subscriptions
  WHERE user_id = NEW.sender_id
    AND status IN ('authenticated', 'active', 'pending')
  ORDER BY
    array_position(ARRAY['active', 'authenticated', 'pending'], status),
    created_at DESC
  LIMIT 1;

  IF _sub IS NOT NULL THEN
    UPDATE public.subscriptions
    SET requests_used = public.count_intro_usage(NEW.sender_id),
        updated_at = now()
    WHERE id = _sub;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS interests_mirror_usage ON public.interests;
CREATE TRIGGER interests_mirror_usage
  AFTER INSERT OR UPDATE ON public.interests
  FOR EACH ROW EXECUTE FUNCTION public.mirror_intro_usage();

-- 3. record_intro_usage becomes a converging recompute (same live-row
-- choice), so any service-role caller fixes drift instead of adding to it.
CREATE OR REPLACE FUNCTION public.record_intro_usage(_user uuid DEFAULT auth.uid())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sub uuid;
BEGIN
  IF _user IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO _sub
  FROM public.subscriptions
  WHERE user_id = _user
    AND status IN ('authenticated', 'active', 'pending')
  ORDER BY
    array_position(ARRAY['active', 'authenticated', 'pending'], status),
    created_at DESC
  LIMIT 1;

  IF _sub IS NULL THEN
    RETURN; -- free member: nothing to accrue against
  END IF;

  UPDATE public.subscriptions
  SET requests_used = public.count_intro_usage(_user),
      updated_at = now()
  WHERE id = _sub;
END; $$;

REVOKE EXECUTE ON FUNCTION public.record_intro_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intro_usage(uuid) TO service_role;

-- 4. Backfill: paying members see their real window count immediately.
-- Free members (no live row) are untouched; abandoned 'created' rows are
-- untouched (they never entitle and never display).
UPDATE public.subscriptions s
SET requests_used = public.count_intro_usage(s.user_id),
    updated_at = now()
WHERE s.status IN ('authenticated', 'active', 'pending');

-- ---------------------------------------------------------------------------
-- Regression assertions. Fail at migrate time, not in production.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _body
  FROM pg_proc WHERE proname = 'record_intro_usage' AND pronamespace = 'public'::regnamespace;

  IF _body IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: record_intro_usage() is missing';
  END IF;
  -- The old read-modify-write increment must never come back.
  IF _body LIKE '%requests_used + 1%' THEN
    RAISE EXCEPTION 'REGRESSION: record_intro_usage() still increments instead of recomputing';
  END IF;
  IF _body NOT LIKE '%count_intro_usage%' THEN
    RAISE EXCEPTION 'REGRESSION: record_intro_usage() must derive from count_intro_usage()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'interests_mirror_usage'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: interests_mirror_usage trigger is missing';
  END IF;
END $$;
