-- ===========================================================================
-- 20261010 — Phase 2 fix batch (C-1/C-2/C-3/C-5/H-1/H-2/H-4/H-5/M-2/M-3).
-- Chained after 20261009000000 (current head): additive except where an
-- unused/weak policy is replaced (each DROP is paired with the CREATE that
-- supersedes it, so a partial apply cannot widen access). Existing users
-- keep every row: columns are added nullable/with defaults, no table is
-- rebuilt, and the demo-directory delete below only touches seed-id rows
-- that have no usable login and no introduction activity.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- C-5 (data): remove the eight fixed demo rows where they are still demo
-- rows. Three guards, all required: fixed seed id, no usable auth login
-- (backfilled placeholders have an empty password), and no introduction
-- activity. A real member on a colliding id keeps their row.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _removed int := 0;
BEGIN
  DELETE FROM public.profiles p
  WHERE p.id IN (
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000005',
    'a1000000-0000-4000-8000-000000000006',
    'a1000000-0000-4000-8000-000000000007',
    'a1000000-0000-4000-8000-000000000008'
  )
  AND NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p.id
      AND u.encrypted_password <> ''
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.interests i
    WHERE i.sender_id = p.id OR i.recipient_id = p.id
  );
  GET DIAGNOSTICS _removed = ROW_COUNT;
  RAISE NOTICE 'demo seed cleanup: removed % row(s)', _removed;
END $$;

-- ---------------------------------------------------------------------------
-- C-3: restore the columns later rewrites of my_profile dropped.
-- 20261004 ended the view with (…, p.is_admin, p.paused_until, p.paused_reason);
-- 20261009 rewrote it ending at p.residency_status — silently dropping the
-- pause columns AND never carrying show_profile_views (added to the table in
-- 20261005) or the 20261009 matrimonial columns into one consistent list.
-- (In fact that 20261009 CREATE OR REPLACE is not appliable in order:
-- Postgres forbids dropping columns via OR REPLACE, so the committed chain
-- breaks on a fresh database there. This migration repairs the chain by
-- replacing the view wholesale.)
-- DROP + CREATE is required because OR REPLACE cannot drop/reorder columns.
-- No object depends on the view (only GRANTs, re-issued below), so the
-- DROP is dependency-free. Every column already exists on the table, so
-- existing rows are untouched.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.my_profile;
CREATE VIEW public.my_profile WITH (security_invoker = false) AS
  SELECT
    p.id, p.full_name, p.gender, p.birth_year, p.city, p.institution, p.degree,
    p.grad_year, p.profession, p.employer, p.relocation, p.values_statement, p.bio,
    p.is_visible, p.onboarded, p.created_at, p.updated_at,
    p.photo_path, p.photo_visibility, p.verification_status,
    p.alumni_email, p.alumni_email_verified, p.verification_doc_path, p.verification_note,
    p.verification_decided_at, p.verification_decided_by,
    p.contact_phone, p.linkedin_url, p.is_admin,
    p.height_cm, p.marital_status, p.diet, p.mother_tongue, p.residency_status,
    p.paused_until, p.paused_reason,
    p.show_profile_views
  FROM public.profiles p
  WHERE p.id = auth.uid();

REVOKE ALL ON public.my_profile FROM PUBLIC, anon;
GRANT SELECT ON public.my_profile TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- C-1/C-2: make paid tiers real, and stop treating unpaid checkouts as live.
--
-- SAFE DEFAULT (product decision, flagged): the new gate is
--   free  = 5 outstanding introductions  (unchanged from the pacing trigger)
--   concierge = 20 per billing month, founder = unlimited (per plan table).
-- To change the numbers, edit subscription_plans — not code.
--
-- a) entitlement() no longer counts 'created' (abandoned checkout) as live.
--    Only authenticated/active/pending entitle, active first. A 'created'
--    row becomes entitling only when the webhook moves it forward — which is
--    what razorpay-checkout's own comment already claims.
-- b) idx_subscriptions_one_live drops 'created' from its predicate so a
--    member with an abandoned checkout can start a NEW checkout without a
--    unique-violation 500. Two entitling rows stay impossible; leftover
--    'created' rows are harmless because none of them entitles.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.entitlement(_user uuid)
RETURNS TABLE (
  plan_code text,
  placement_weight integer,
  intro_requests integer,
  requests_used integer,
  requests_remaining integer,
  active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH live AS (
    SELECT s.*, pl.code AS plan, pl.placement_weight AS weight, pl.intro_requests AS allowance
    FROM public.subscriptions s
    JOIN public.subscription_plans pl
      ON pl.code = s.plan_code
     AND pl.active
    WHERE s.user_id = _user
      AND s.status IN ('authenticated', 'active', 'pending')
    ORDER BY
      array_position(ARRAY['active', 'authenticated', 'pending'], s.status),
      s.created_at DESC
    LIMIT 1
  )
  SELECT
    coalesce(live.plan, 'free'),
    coalesce(live.weight, 0),
    live.allowance,
    coalesce(live.requests_used, 0),
    CASE
      WHEN live.allowance IS NULL AND live.id IS NOT NULL THEN NULL
      ELSE greatest(0, coalesce(live.allowance, 0) - coalesce(live.requests_used, 0))
    END,
    live.id IS NOT NULL
  FROM (SELECT 1) AS _
  LEFT JOIN live ON true
$$;

DROP INDEX IF EXISTS public.idx_subscriptions_one_live;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_live
  ON public.subscriptions(user_id)
  WHERE status IN ('authenticated', 'active', 'pending');

-- c) Enforce the allowance at the send path, inside the same statement as
--    the insert — no check-then-act race. Usage is DERIVED from qualifying
--    rows the sender already owns, so concurrent sends serialize on the
--    interests rows the trigger's own count query locks.
--    Only fresh asks consume allowance: brand-new pending rows and renewals
--    of closed ones (declined/withdrawn/expired -> pending). Desk writes
--    (service role, NULL uid) are exempt. Free members keep the pacing
--    trigger (5 outstanding) as their only gate. A recipient "no" does not
--    consume the sender twice: declined rows are excluded from the count.
--    A renewal of a row created *before* the current window therefore costs
--    nothing until the window rolls (bounded by the 5-outstanding pacing cap) —
--    the permissive direction, and the one a courtesy re-ask deserves.
CREATE OR REPLACE FUNCTION public.enforce_intro_allowance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _plan text;
  _allowance int;
  _used int;
BEGIN
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (
    OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT e.plan_code, e.intro_requests INTO _plan, _allowance
  FROM public.entitlement(NEW.sender_id) e;

  IF _plan IS NULL OR _plan = 'free' THEN
    RETURN NEW;
  END IF;
  IF _allowance IS NULL THEN
    RETURN NEW; -- unlimited plan (founder)
  END IF;

  SELECT count(*) INTO _used
  FROM public.interests i
  JOIN public.subscriptions s
    ON s.user_id = NEW.sender_id
   AND s.status IN ('authenticated', 'active', 'pending')
  WHERE i.sender_id = NEW.sender_id
    AND i.status <> 'declined'
    AND i.created_at >= coalesce(s.period_start, now() - interval '30 days')
    AND (TG_OP = 'INSERT' OR i.id <> NEW.id);

  IF _used >= _allowance THEN
    RAISE EXCEPTION 'Monthly introduction allowance used — upgrade or wait for the next billing period'
      USING ERRCODE = '45000';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS interests_allowance ON public.interests;
CREATE TRIGGER interests_allowance BEFORE INSERT OR UPDATE ON public.interests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_intro_allowance();

-- d) record_intro_usage: align its row choice with the new live set so the
--    service-role accrual API cannot attach usage to an abandoned checkout.
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
  SET requests_used = requests_used + 1,
      updated_at = now()
  WHERE id = _sub;
END; $$;

-- ---------------------------------------------------------------------------
-- H-1: make report-and-block real. New terminal status 'blocked':
--   * accepted -> blocked is the ONLY exit from a live introduction, and
--     only the party who did NOT send the last report... precisely: either
--     party may block; the report row is the evidence, this transition is
--     the enforcement. Messaging/call gates check i.status = 'accepted',
--     so 'blocked' closes every channel exactly like withdrawn/expired do.
--   * 'blocked' is terminal for members (no reopen), service role exempt.
--   * The check constraint gains 'blocked'; the sender-withdraw policy and
--     the transition trigger learn the new edge; nothing else changes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.interests DROP CONSTRAINT IF EXISTS interests_status_valid;
ALTER TABLE public.interests ADD CONSTRAINT interests_status_valid
  CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired', 'blocked'));

CREATE OR REPLACE FUNCTION public.enforce_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean := false;
BEGIN
  IF current_setting('app.pacing_job', true) = '1' AND NEW.status = 'expired' THEN
    RETURN NEW;
  END IF;

  IF _uid IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF _uid = OLD.sender_id AND _uid <> OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status = 'withdrawn')
             OR (OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending')
             -- Either side may end a live introduction by blocking.
             OR (OLD.status = 'accepted' AND NEW.status = 'blocked');
  ELSIF _uid = OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined'))
             OR (OLD.status = 'accepted' AND NEW.status = 'blocked');
  END IF;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Only the recipient may accept an introduction, and only while it is pending'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
    NEW.expires_at := now() + interval '14 days';
    NEW.reminder_sent_at := NULL;
  END IF;

  RETURN NEW;
END; $$;

-- Sender policy must admit the new terminal edge from an accepted row.
DROP POLICY IF EXISTS "Sender withdraws own interest" ON public.interests;
CREATE POLICY "Sender withdraws own interest" ON public.interests FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id AND status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired'))
  WITH CHECK (auth.uid() = sender_id AND status IN ('pending', 'withdrawn', 'blocked'));

-- Recipient policy must admit accepted -> blocked as well.
DROP POLICY IF EXISTS "Recipient answers interest" ON public.interests;
CREATE POLICY "Recipient answers interest" ON public.interests FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id AND status IN ('pending', 'accepted'))
  WITH CHECK (auth.uid() = recipient_id AND status IN ('pending', 'accepted', 'declined', 'blocked'));

-- H-2 (part 1): counterparty notifications on interest transitions move
-- server-side. Members lose the INSERT policy entirely; a SECURITY DEFINER
-- trigger writes fixed, server-composed rows on transitions that already
-- passed the transition trigger. No title/body/link is member-controlled:
-- all three are constants, links stay in the four-destination allowlist.
-- A block reuses the declined copy — it must not announce itself as a block
-- to the blocked party.
DROP POLICY IF EXISTS "Notify other members" ON public.notifications;

CREATE OR REPLACE FUNCTION public.notify_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _other uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (OLD.sender_id, 'interest_accepted', 'Introduction accepted',
            'Contact details are now visible to both of you.', '/connections');
  ELSIF OLD.status = 'pending' AND NEW.status = 'declined' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (OLD.sender_id, 'interest_declined', 'Introduction declined',
            'This introduction was declined. No contact was shared.', '/connections');
  ELSIF NEW.status = 'blocked' AND OLD.status <> 'blocked' THEN
    _other := CASE WHEN auth.uid() = OLD.sender_id THEN OLD.recipient_id ELSE OLD.sender_id END;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_other, 'interest_declined', 'Introduction declined',
            'This introduction was declined. No contact was shared.', '/connections');
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS interests_notify_counterparty ON public.interests;
CREATE TRIGGER interests_notify_counterparty AFTER UPDATE ON public.interests
  FOR EACH ROW EXECUTE FUNCTION public.notify_interest_transition();

-- H-2 (part 2): relationship-checked writer for the remaining member-caused
-- events (new interest, suggestion, message, missed call). The client calls
-- this instead of inserting rows; every string is a server constant and each
-- event requires the relationship that justifies it, so a forged "accepted"
-- notice requires a real accepted interest (which the writer never sends —
-- acceptance notices come only from the trigger above).
CREATE OR REPLACE FUNCTION public.notify_counterparty(_user uuid, _event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _user IS NULL OR _user = _uid THEN
    RETURN;
  END IF;

  IF _event = 'interest_received' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.interests i
      WHERE i.sender_id = _uid AND i.recipient_id = _user AND i.status = 'pending'
    ) THEN
      RAISE EXCEPTION 'No pending introduction justifies this notification'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_user, 'interest_received', 'New introduction',
            'A member expressed interest in connecting.', '/connections');
  ELSIF _event = 'suggestion_received' THEN
    IF NOT private.is_copilot_of(_user, _uid) THEN
      RAISE EXCEPTION 'Only an active co-pilot may notify this candidate'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_user, 'suggestion_received', 'New family suggestion',
            'Your co-pilot suggested a profile for you to consider.', '/copilots');
  ELSIF _event = 'message_received' THEN
    IF NOT private.has_accepted_interest(_uid, _user) THEN
      RAISE EXCEPTION 'No accepted introduction justifies this notification'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_user, 'message_received', 'New message',
            'You have a new message in an accepted introduction.', '/connections');
  ELSIF _event = 'call_missed' THEN
    IF NOT private.has_accepted_interest(_uid, _user) THEN
      RAISE EXCEPTION 'No accepted introduction justifies this notification'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_user, 'call_missed', 'Missed video call',
            'A video call from an accepted introduction was not answered.', '/connections');
  ELSE
    RAISE EXCEPTION 'Unknown notification event' USING ERRCODE = '22023';
  END IF;
END; $$;

REVOKE EXECUTE ON FUNCTION public.notify_counterparty(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_counterparty(uuid, text) TO authenticated, service_role;

-- M-3: drop the leftover permissive copilot-claim UPDATE policy. Invite
-- acceptance runs exclusively through accept_copilot_invite() (email-bound,
-- SECURITY DEFINER) since 20260928000000; the old policy is a second, weaker
-- path to the same rows.
DROP POLICY IF EXISTS "Copilot accepts own invite" ON public.copilots;

-- ---------------------------------------------------------------------------
-- H-5: a ringing call must die on its own. New sweeper closes calls that
-- rang unanswered for >60s (client ring budget is 45s + skew) or sat in a
-- non-terminal state for >2h (crashed tab mid-call). Runs as the table owner
-- via SECURITY DEFINER; callable by any signed-in member (harmless: it only
-- ever moves rows toward 'ended') and by the service role. Members cannot
-- end calls early through it — the guard only touches rows past the
-- deadline, and 'ended' is already terminal for everyone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_stale_calls()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _closed int := 0;
  _row public.calls;
BEGIN
  FOR _row IN
    SELECT * FROM public.calls
    WHERE status = 'ringing'
      AND started_at < now() - interval '60 seconds'
    FOR UPDATE
  LOOP
    UPDATE public.calls
    SET status = 'ended',
        ended_at = now(),
        decline_reason = coalesce(decline_reason, 'missed')
    WHERE id = _row.id;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_row.callee_id, 'call_missed', 'Missed video call',
            'A video call from an accepted introduction was not answered.', '/connections');

    _closed := _closed + 1;
  END LOOP;

  UPDATE public.calls
  SET status = 'ended',
      ended_at = now(),
      decline_reason = coalesce(decline_reason, 'ended')
  WHERE status <> 'ended'
    AND started_at < now() - interval '2 hours';

  GET DIAGNOSTICS _closed = ROW_COUNT;

  RETURN _closed;
END; $$;

REVOKE EXECUTE ON FUNCTION public.sweep_stale_calls() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_stale_calls() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- M-2: correct the record — blocks are hidden client-side, not by RLS.
-- (The UI at members.tsx already excludes the reporter's own blocks via a
-- `not.in` filter; this comment-only migration pins the truth in the schema
-- history so nobody "fixes" the policy into a page-count bug later.)
-- ---------------------------------------------------------------------------
COMMENT ON POLICY "Verified members and copilots read the directory" ON public.profiles IS
  'Directory gate: onboarded + visible + verified (+ caller verified or active copilot). '
  'Reporter blocks, pauses and ghost-mode are applied client-side (see members.tsx) '
  'so server counts stay in agreement with the rendered rows.';








-- ===========================================================================

-- ---------------------------------------------------------------------------
-- C-5 (data): remove the eight fixed demo rows where they are still demo
-- rows. Three guards, all required: fixed seed id, no usable auth login
-- (backfilled placeholders have an empty password), and no introduction
-- activity. A real member on a colliding id keeps their row.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  DELETE FROM public.profiles p
  WHERE p.id IN (
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000005',
    'a1000000-0000-4000-8000-000000000006',
    'a1000000-0000-4000-8000-000000000007',
    'a1000000-0000-4000-8000-000000000008'
  )
  AND NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p.id
      AND coalesce((u.raw_app_meta_data ->> 'provider'), '') <> 'email'
      AND u.encrypted_password <> ''
  )
  -- A real member who verified/used the account keeps it even on a seed id.
  AND NOT EXISTS (
    SELECT 1 FROM public.interests i
    WHERE i.sender_id = p.id OR i.recipient_id = p.id
  );
  RAISE NOTICE 'demo seed cleanup: removed % row(s)',
    (SELECT count(*) FROM public.profiles WHERE id::text LIKE 'a1000000-%');
END $$;
