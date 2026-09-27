-- ===========================================================================
-- 20261003: Deliberate pacing — interest quota and 14-day auto-expiry.
--
-- A mature, private network is judged by restraint: an unlimited right to
-- express interest turns the directory into a volume game. This migration
-- caps outstanding introductions at five and closes unanswered interest after
-- fourteen days, with a single gentle reminder at day seven. Every write is
-- still authorised by the transition trigger from 20260928000000 — RLS never
-- lets a member write 'expired' themselves.
-- ===========================================================================

ALTER TABLE public.interests
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

ALTER TABLE public.interests DROP CONSTRAINT IF EXISTS interests_status_valid;
ALTER TABLE public.interests ADD CONSTRAINT interests_status_valid
  CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired'));

CREATE INDEX IF NOT EXISTS idx_interests_expiry
  ON public.interests(expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_interests_reminder
  ON public.interests(expires_at)
  WHERE status = 'pending' AND reminder_sent_at IS NULL;

-- ---------------------------------------------------------------------------
-- Quota: at most five outstanding outgoing introductions. Skipped for the
-- service role (seeding and the membership desk) and for reads of the row
-- itself on re-approval updates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_interest_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _outstanding int;
BEGIN
  IF auth.uid() IS NULL OR NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO _outstanding
  FROM public.interests
  WHERE sender_id = NEW.sender_id
    AND status = 'pending'
    AND id <> NEW.id;

  IF _outstanding >= 5 THEN
    RAISE EXCEPTION 'At most five outstanding introductions — withdraw one before sending another'
      USING ERRCODE = '45000';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS interests_quota ON public.interests;
CREATE TRIGGER interests_quota BEFORE INSERT OR UPDATE ON public.interests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_interest_quota();

-- ---------------------------------------------------------------------------
-- Expiry + reminder job. SECURITY DEFINER so it can reach every row regardless
-- of who invokes it; the GUC tells the transition trigger these writes come
-- from the pacing job rather than from one of the two candidates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_interests()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _expired int := 0;
  _reminded int := 0;
  _row public.interests;
BEGIN
  PERFORM set_config('app.pacing_job', '1', true);

  FOR _row IN
    SELECT * FROM public.interests
     WHERE status = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at < now()
     FOR UPDATE
  LOOP
    UPDATE public.interests
       SET status = 'expired', updated_at = now()
     WHERE id = _row.id;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      _row.sender_id,
      'interest_expired',
      'An introduction quietly expired',
      'The introduction you sent fourteen days ago has closed on its own. You are free to send it again if you would still like to connect.',
      '/connections'
    );
    _expired := _expired + 1;
  END LOOP;

  FOR _row IN
    SELECT * FROM public.interests
     WHERE status = 'pending'
       AND reminder_sent_at IS NULL
       AND expires_at IS NOT NULL
       AND expires_at - interval '7 days' <= now()
     FOR UPDATE
  LOOP
    UPDATE public.interests
       SET reminder_sent_at = now()
     WHERE id = _row.id;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      _row.recipient_id,
      'interest_reminder',
      'An introduction is waiting for you',
      'An introduction sent to you will close in seven days. A reply of any kind keeps it alive.',
      '/connections'
    );
    _reminded := _reminded + 1;
  END LOOP;

  RETURN _expired + _reminded;
END; $$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_interests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_interests() TO authenticated, service_role;

-- The two inbox kinds above are written only by this function, which runs as
-- the table owner; they are deliberately absent from the member INSERT policy.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid
  CHECK (kind IN (
    'interest_received',
    'interest_accepted',
    'interest_declined',
    'interest_expired',
    'interest_reminder',
    'copilot_invite_accepted',
    'verification_approved',
    'verification_resubmission',
    'verification_rejected',
    'suggestion_received',
    'message_received',
    'call_missed'
  ));

-- ---------------------------------------------------------------------------
-- Transition machine + RLS updated for the new state.
--
--  * 'expired' is system-only: the pacing job flags the transaction with the
--    app.pacing_job GUC, and the member policies never accept an 'expired'
--    write, so nobody can expire their own row early (or re-open someone
--    else's) from the client.
--  * Reopening a closed introduction re-arms a fresh fourteen-day window and
--    clears the day-seven reminder so the recipient is nudged once per cycle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean := false;
BEGIN
  -- Pacing job writes (security definer RPC): let it land on 'expired'.
  IF current_setting('app.pacing_job', true) = '1' AND NEW.status = 'expired' THEN
    RETURN NEW;
  END IF;

  -- Service role / membership desk writes (auth.uid() is null) bypass the guard.
  -- Non-status edits (e.g. editing a note on a still-pending interest) pass too.
  IF _uid IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF _uid = OLD.sender_id AND _uid <> OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status = 'withdrawn')
             OR (OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending');
  ELSIF _uid = OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined'));
  END IF;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Only the recipient may accept an introduction, and only while it is pending'
      USING ERRCODE = '42501';
  END IF;

  -- Reopened: re-arm the window so a stale attempt does not expire tomorrow.
  IF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
    NEW.expires_at := now() + interval '14 days';
    NEW.reminder_sent_at := NULL;
  END IF;

  RETURN NEW;
END; $$;

-- Sender may now also reopen an expired introduction.
DROP POLICY IF EXISTS "Sender withdraws own interest" ON public.interests;
CREATE POLICY "Sender withdraws own interest" ON public.interests FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id AND status IN ('pending', 'declined', 'withdrawn', 'expired'))
  WITH CHECK (auth.uid() = sender_id AND status IN ('pending', 'withdrawn'));

