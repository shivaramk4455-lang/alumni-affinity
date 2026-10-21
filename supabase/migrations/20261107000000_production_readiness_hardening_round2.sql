-- ===========================================================================
-- 20261107: Production-readiness hardening, round 2.
--
-- Every change below is backward compatible: no column is dropped, no table
-- is rewritten, no behaviour a member can observe changes except where a bug
-- is explicitly corrected. Where a fix required a product decision, the
-- decision is written next to the code that implements it.
--
-- Contents, in severity order:
--
--   1. [CRITICAL] reconcile-orphaned-subscriptions could never authenticate,
--                 so a deleted member's Razorpay mandate kept debiting.
--   2. [CRITICAL] public.interests: the member controlled created_at and
--                 expires_at, defeating the paid allowance and the 14-day
--                 expiry.
--   3. [CRITICAL] public.copilots: the member could insert an already-active
--                 co-pilot, which is a bypass of the verified-only directory.
--   4. [HIGH]     public.consent_events: the member chose the recorded_at and
--                 the policy_version of their own consent evidence.
--   5. [HIGH]     public.calls / public.profile_views: table-level UPDATE
--                 grants let a member rewrite another party's rows.
--   6. [MEDIUM]   Global sweeps were member-callable; they are now scheduled
--                 jobs with member-scoped wrappers.
--   7. [MEDIUM]   get_or_create_conversation re-pointed the governing
--                 interest of an existing thread.
--   8. [MEDIUM]   The permissive directory policy is removed everywhere.
--   9. [MEDIUM]   The co-pilot cap and the storage caps were unlocked
--                 check-then-count races.
--  10. [MEDIUM]   notify_counterparty failed open on an unknown event.
--  11. [MEDIUM]   A block could abort its own transaction and double-notify.
--  12. [MEDIUM]   The partner age band used a fabricated 1-January birthday.
--  13.            Fail-loud regression assertions.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. [CRITICAL] The orphaned-mandate reconciler could never authenticate.
-- ---------------------------------------------------------------------------
-- 20261106000100 scheduled this job with an X-Cron-Secret but no
-- Authorization header, while supabase/config.toml leaves verify_jwt enabled
-- for razorpay-cancel. The Edge Gateway therefore answered 401 before the
-- function body ran, net.http_post swallowed the failure, and cron.job
-- reported a healthy job. The scenario the job exists to prevent — "I deleted
-- my account and the debit continued" — silently recurred.
--
-- The two cron jobs that DO work (20261007000000) send the gateway JWT
-- explicitly, precisely because the gateway and the function check different
-- layers. This job now does the same.
--
-- SAFE DEFAULT: the job is rescheduled with the gateway JWT. The function's
-- own X-Cron-Secret check is untouched, so the shared secret is still the
-- function-level boundary.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not available; reconcile-orphaned-subscriptions not scheduled.';
    RETURN;
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret') THEN
    RAISE WARNING
      'Vault secrets project_url / cron_secret are missing, so reconcile-orphaned-subscriptions is NOT scheduled. '
      'Until it runs, a member deleted while holding a live mandate is not cancelled at the provider. See DEPLOYMENT.md section 5.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE WARNING
      'Vault secret service_role_key is missing, so reconcile-orphaned-subscriptions is NOT scheduled: '
      'the Edge Gateway requires a service-role JWT and would reject the request before the function runs. '
      'See DEPLOYMENT.md section 5.';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reconcile-orphaned-subscriptions';
  PERFORM cron.schedule(
    'reconcile-orphaned-subscriptions',
    '23 * * * *',
    $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
             || '/functions/v1/razorpay-cancel',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        -- Gateway JWT: satisfies the function gateway's own verify_jwt. The
        -- X-Cron-Secret below is what the function itself checks; the two
        -- headers serve different layers on purpose.
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'X-Cron-Secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'), ''),
        'X-Cron-Previous', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret_previous'), '')
      ),
      body := '{"mode":"reconcile-orphans"}'::jsonb
    )
    $job$
  );
END $$;

-- ---------------------------------------------------------------------------
-- 2. [CRITICAL] public.interests: server-owned columns and a column-scoped
--               INSERT grant.
-- ---------------------------------------------------------------------------
-- GRANT INSERT ON <table> is table-scoped: it covers every column. The chain
-- already narrowed the UPDATE grant (20261104000000) and the profiles INSERT
-- grant (20261101000000), but the interests INSERT grant was never narrowed.
--
-- A member could therefore post created_at and expires_at. Back-dating
-- created_at moved the row outside the billing window, so
-- enforce_intro_allowance counted _used = 0 and the paid allowance
-- ("20 per billing month") stopped applying — and because count_intro_usage
-- recomputes from the same predicate, the member's own usage display still
-- read 0, so support could not see the abuse either. A far-future expires_at
-- pinned the 14-day expiry open, and back-dating also corrupted the
-- recipient's response_rate denominator.
--
-- The fix stamps the server-owned columns on INSERT and grants INSERT on the
-- three columns the browser actually sends (sender_id, recipient_id, message).
CREATE OR REPLACE FUNCTION public.guard_interest_insert_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- created_at and expires_at are server-owned. A member-supplied value would
  -- move the row outside the billing window or pin the expiry open.
  NEW.created_at := now();
  NEW.updated_at := now();
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := now() + interval '14 days';
  END IF;
  NEW.decided_at := NULL;
  NEW.reminder_sent_at := NULL;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS interests_guard_insert_columns ON public.interests;
CREATE TRIGGER interests_guard_insert_columns
  BEFORE INSERT ON public.interests
  FOR EACH ROW EXECUTE FUNCTION public.guard_interest_insert_columns();

REVOKE INSERT ON public.interests FROM authenticated;
GRANT INSERT (sender_id, recipient_id, message) ON public.interests TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. [CRITICAL] public.copilots: a co-pilot relationship is an invitation
--               until it is redeemed.
-- ---------------------------------------------------------------------------
-- guard_copilot_columns is a BEFORE UPDATE trigger, so on INSERT nothing
-- stopped a member from writing copilot_user_id and status = 'active'
-- directly. private.is_active_copilot requires only that the CANDIDATE is
-- verified — never the co-pilot — and the directory policy grants read on
-- "verified member OR active co-pilot". A verified member could therefore
-- register a second, unverified account, bind it as an active co-pilot, and
-- that account could immediately browse the whole verified directory and
-- download every all_members photograph. accept_copilot_invite() was not, as
-- the README claimed, the only way to claim an invitation.
--
-- The fix forces an INSERT to be an invitation, and grants INSERT only on the
-- four columns the browser sends. accept_copilot_invite() is SECURITY
-- DEFINER and therefore unaffected by the narrowed grant.
CREATE OR REPLACE FUNCTION public.guard_copilot_insert_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- A co-pilot relationship starts as an invitation and only becomes active
  -- when the invited person redeems their code. Binding a user id or
  -- activating the row on INSERT would let a candidate mint an active
  -- co-pilot, and with it directory access for an unverified account.
  NEW.copilot_user_id := NULL;
  NEW.status := 'invited';
  NEW.accepted_at := NULL;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS copilots_guard_insert_columns ON public.copilots;
CREATE TRIGGER copilots_guard_insert_columns
  BEFORE INSERT ON public.copilots
  FOR EACH ROW EXECUTE FUNCTION public.guard_copilot_insert_columns();

REVOKE INSERT ON public.copilots FROM authenticated;
GRANT INSERT (candidate_id, copilot_email, copilot_name, relation) ON public.copilots TO authenticated;

-- The browser only ever changes the access state of its own co-pilot.
REVOKE UPDATE ON public.copilots FROM authenticated;
GRANT UPDATE (status) ON public.copilots TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. [HIGH] public.consent_events: the ledger is server-stamped evidence.
-- ---------------------------------------------------------------------------
-- The consent ledger is the evidence a DPDP dispute is answered with ("you
-- agreed to v2026-09, on this date, for this purpose"). With a table-level
-- INSERT grant the member chose recorded_at, policy_version and granted
-- themselves, so a back-dated receipt was indistinguishable from one written
-- by the signup flow.
--
-- The browser only ever writes the ledger through record_consent(), so the
-- table-level INSERT grant and its policy are removed and the RPC becomes the
-- single write path. The policy version is now stamped by the database: it
-- is a fact about which notice was in force, not a claim by the caller.
CREATE OR REPLACE FUNCTION public.current_policy_version()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT '2026-09'::text;
$$;

REVOKE EXECUTE ON FUNCTION public.current_policy_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_policy_version() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_consent(
  _purpose text, _granted boolean, _policy_version text, _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to record consent' USING ERRCODE = '42501';
  END IF;

  -- The policy version is server-owned. _policy_version is kept in the
  -- signature so the existing client call does not break, but the value
  -- written is the version the database has in force.
  INSERT INTO public.consent_events (user_id, purpose, granted, policy_version, note)
  VALUES (_uid, _purpose, _granted, public.current_policy_version(), _note)
  RETURNING id INTO _id;
  RETURN _id;
END; $$;

REVOKE INSERT ON public.consent_events FROM authenticated;
DROP POLICY IF EXISTS "Own consent events insert" ON public.consent_events;

-- ---------------------------------------------------------------------------
-- 5. [HIGH] public.calls and public.profile_views: column-scoped UPDATE.
-- ---------------------------------------------------------------------------
-- calls: the guard freezes conversation_id, caller_id, callee_id and the
-- status transitions, but not started_at. sweep_stale_calls() selects on
-- started_at, so a participant could push started_at into the future and make
-- a hung call immortal, defeating the sweeper and the one-live-call index.
--
-- profile_views: "Bump own visit timestamp" asserts only that viewed_id is
-- not the caller's own id; it does not pin viewed_id to the OLD value, so a
-- member could repoint a visit row at another member and forge their visitor
-- log. The browser writes profile_views only through record_profile_view(),
-- which is SECURITY DEFINER, so the table-level grants can go entirely.
REVOKE UPDATE ON public.calls FROM authenticated;
GRANT UPDATE (status, answered_at, ended_at, decline_reason) ON public.calls TO authenticated;

REVOKE INSERT, UPDATE ON public.profile_views FROM authenticated;

-- ---------------------------------------------------------------------------
-- 6. [MEDIUM] Global sweeps become scheduled jobs with member-scoped
--               wrappers.
-- ---------------------------------------------------------------------------
-- expire_stale_interests() and sweep_stale_calls() are SECURITY DEFINER
-- functions that write across the whole member base, and both were granted to
-- `authenticated`: any signed-in member could trigger a global write plus
-- inbox inserts for other people, on every page load of /connections.
--
-- They are global sweeps, so a scheduler is their right owner. They are now
-- service_role-only and scheduled; the browser calls member-scoped wrappers
-- that touch only rows the caller is a party to, which keeps a member's own
-- list accurate without giving them a cross-user write.
CREATE OR REPLACE FUNCTION public.expire_my_stale_interests()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _n int := 0;
BEGIN
  IF _uid IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM set_config('app.pacing_job', '1', true);

  WITH expired AS (
    UPDATE public.interests
       SET status = 'expired', updated_at = now()
     WHERE id IN (
       SELECT i.id
         FROM public.interests i
        WHERE i.status = 'pending'
          AND i.expires_at IS NOT NULL
          AND i.expires_at < now()
          AND (i.sender_id = _uid OR i.recipient_id = _uid)
        FOR UPDATE SKIP LOCKED
     )
    RETURNING sender_id
  )
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  SELECT sender_id,
         'interest_expired',
         'An introduction quietly expired',
         'The introduction you sent fourteen days ago has closed on its own. You are free to send it again if you would still like to connect.',
         '/connections'
    FROM expired;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

REVOKE EXECUTE ON FUNCTION public.expire_my_stale_interests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_my_stale_interests() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sweep_my_stale_calls()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _closed int := 0;
  _n int := 0;
  _row record;
BEGIN
  IF _uid IS NULL THEN
    RETURN 0;
  END IF;

  FOR _row IN
    SELECT id, callee_id
      FROM public.calls
     WHERE (caller_id = _uid OR callee_id = _uid)
       AND status = 'ringing'
       AND started_at < now() - interval '90 seconds'
     FOR UPDATE SKIP LOCKED
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
   WHERE (caller_id = _uid OR callee_id = _uid)
     AND status <> 'ended'
     AND started_at < now() - interval '2 hours';

  GET DIAGNOSTICS _n := ROW_COUNT;
  _closed := _closed + _n;

  RETURN _closed;
END; $$;

REVOKE EXECUTE ON FUNCTION public.sweep_my_stale_calls() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_my_stale_calls() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.expire_stale_interests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_interests() TO service_role;

REVOKE EXECUTE ON FUNCTION public.sweep_stale_calls() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stale_calls() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not available; expire-stale-interests and sweep-stale-calls not scheduled.';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'expire-stale-interests';
  PERFORM cron.schedule(
    'expire-stale-interests',
    '*/5 * * * *',
    $job$SELECT public.expire_stale_interests()$job$
  );

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sweep-stale-calls';
  PERFORM cron.schedule(
    'sweep-stale-calls',
    '*/5 * * * *',
    $job$SELECT public.sweep_stale_calls()$job$
  );
END $$;

-- ---------------------------------------------------------------------------
-- 7. [MEDIUM] get_or_create_conversation must never re-point a thread.
-- ---------------------------------------------------------------------------
-- The function did ON CONFLICT ... DO UPDATE SET interest_id =
-- EXCLUDED.interest_id. Because every messaging and call policy gates on
-- conversations.interest_id -> interests.status = 'accepted', that rewrite
-- could swap the gate of an existing thread to a different (pending or
-- blocked) interest, silently closing or reopening messages that already
-- existed. The correct behaviour is to return the existing conversation
-- unchanged.
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(_interest_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _a uuid;
  _b uuid;
  _part_a uuid;
  _part_b uuid;
  _conv uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT sender_id, recipient_id INTO _a, _b
  FROM public.interests
  WHERE id = _interest_id AND status = 'accepted' AND (sender_id = _uid OR recipient_id = _uid);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_requires_accepted_interest' USING ERRCODE = 'P0001';
  END IF;

  _part_a := LEAST(_a, _b);
  _part_b := GREATEST(_a, _b);

  -- The canonical unique index on (participant_a, participant_b) makes this
  -- race-safe: a concurrent insert either wins or conflicts, and the
  -- conflicting case re-reads the row that won.
  INSERT INTO public.conversations (interest_id, participant_a, participant_b)
  VALUES (_interest_id, _part_a, _part_b)
  ON CONFLICT (participant_a, participant_b) DO NOTHING
  RETURNING id INTO _conv;

  IF _conv IS NULL THEN
    SELECT id INTO _conv
      FROM public.conversations
     WHERE participant_a = _part_a AND participant_b = _part_b;
  END IF;

  IF _conv IS NULL THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = 'P0001';
  END IF;

  RETURN _conv;
END; $$;

-- ---------------------------------------------------------------------------
-- 8. [MEDIUM] The permissive directory policy is removed everywhere.
-- ---------------------------------------------------------------------------
-- "Members read visible onboarded" used USING (onboarded AND is_visible),
-- which lets any authenticated member read every onboarded profile including
-- unverified ones. Postgres ORs multiple permissive SELECT policies on the
-- same table together, so while it coexists with the verified-only policy it
-- silently wins. It was created by the legacy teardown (20260928055910) and
-- never dropped afterwards.
DROP POLICY IF EXISTS "Members read visible onboarded" ON public.profiles;

-- Re-assert the intended directory gate so the end state is explicit.
DROP POLICY IF EXISTS "Verified members and copilots read the directory" ON public.profiles;
CREATE POLICY "Verified members and copilots read the directory" ON public.profiles FOR SELECT TO authenticated
  USING (
    onboarded
    AND is_visible
    AND verification_status = 'verified'
    AND (private.is_verified(auth.uid()) OR private.is_active_copilot(auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 9. [MEDIUM] The co-pilot cap and the storage caps were unlocked races.
-- ---------------------------------------------------------------------------
-- enforce_copilot_cap counted without taking a lock, so two concurrent
-- invitations both saw zero and both were admitted — the third co-pilot.
-- guard_storage_object_caps had the same shape for the per-folder object
-- cap. Both now serialise on an advisory transaction lock, the idiom the
-- chain already uses for the introduction allowance.
CREATE OR REPLACE FUNCTION public.enforce_copilot_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'revoked' THEN
    -- Serialise every insert for this candidate, so the count below cannot
    -- miss a concurrent row.
    PERFORM pg_advisory_xact_lock(hashtext('copilots:' || NEW.candidate_id::text));

    IF (SELECT count(*) FROM public.copilots
        WHERE candidate_id = NEW.candidate_id AND status <> 'revoked' AND id <> NEW.id) >= 2 THEN
      RAISE EXCEPTION 'At most two active co-pilots per candidate';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_storage_object_caps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count int;
  _owner_folder text;
BEGIN
  _owner_folder := split_part(NEW.name, '/', 1);

  IF NEW.bucket_id = 'profile-photos' THEN
    PERFORM pg_advisory_xact_lock(hashtext('storage:profile-photos:' || _owner_folder));

    SELECT count(*) INTO _count
    FROM storage.objects
    WHERE bucket_id = 'profile-photos'
      AND split_part(name, '/', 1) = _owner_folder;

    IF _count >= 10 THEN
      RAISE EXCEPTION 'Profile photograph storage limit reached (max 10 objects)'
        USING ERRCODE = '54000';
    END IF;

  ELSIF NEW.bucket_id = 'verification-docs' THEN
    PERFORM pg_advisory_xact_lock(hashtext('storage:verification-docs:' || _owner_folder));

    SELECT count(*) INTO _count
    FROM storage.objects
    WHERE bucket_id = 'verification-docs'
      AND split_part(name, '/', 1) = _owner_folder;

    IF _count >= 5 THEN
      RAISE EXCEPTION 'Verification document storage limit reached (max 5 objects)'
        USING ERRCODE = '54000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. [MEDIUM] notify_counterparty must fail loud on an unknown event.
-- ---------------------------------------------------------------------------
-- The previous definition (20261010000000) raised on an unrecognised event.
-- 20261101000000 replaced it with a silent return, so a client typo or a
-- future event name produced no notification and no error, and the broken
-- alert path was invisible in production.
CREATE OR REPLACE FUNCTION public.notify_counterparty(_user uuid, _event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _sender_name text;
BEGIN
  IF _uid IS NULL OR _user IS NULL OR _user = _uid THEN
    RETURN;
  END IF;

  SELECT full_name INTO _sender_name FROM public.profiles WHERE id = _uid;

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
    PERFORM public.enqueue_notification(
      _user,
      'interest_received',
      jsonb_build_object('from_name', coalesce(_sender_name, 'A member'))
    );

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
      RAISE EXCEPTION 'Messages require an accepted introduction'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_user, 'message_received', 'New message',
            'You have a new message from an accepted introduction.', '/connections');

  ELSIF _event = 'call_missed' THEN
    IF NOT private.has_accepted_interest(_uid, _user) THEN
      RAISE EXCEPTION 'Calls require an accepted introduction'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_user, 'call_missed', 'Missed video call',
            'A video call was not answered.', '/connections');

  ELSIF _event = 'call_invite' THEN
    IF NOT private.has_accepted_interest(_uid, _user) THEN
      RAISE EXCEPTION 'Calls require an accepted introduction'
        USING ERRCODE = '42501';
    END IF;
    PERFORM public.enqueue_notification(
      _user,
      'call_invite',
      jsonb_build_object('from_name', coalesce(_sender_name, 'A member'))
    );

  ELSE
    RAISE EXCEPTION 'Unknown notification event: %', _event USING ERRCODE = '22023';
  END IF;
END; $$;

-- ---------------------------------------------------------------------------
-- 11. [MEDIUM] A block must not abort its own transaction, and must not
--               notify twice.
-- ---------------------------------------------------------------------------
-- The bidirectional cascade updated the reciprocal row with status <>
-- 'blocked'. enforce_interest_transition only allows 'blocked' from
-- 'accepted' (for either party), so a reciprocal row in 'pending' — or in
-- 'declined', 'withdrawn' or 'expired' — raised 42501 from inside this
-- AFTER UPDATE trigger and aborted the whole block. The member saw the block
-- fail with no explanation.
--
-- The cascade is now restricted to the reciprocal ACCEPTED row, which is the
-- only one that needs to close: the approach-eligibility guard (20261106000400)
-- already refuses a new introduction between a blocked pair in either
-- direction, so a pending reciprocal row needs no status change.
--
-- The cascade flag stops the nested trigger invocation from writing a second,
-- duplicate inbox row for the same counterparty.
CREATE OR REPLACE FUNCTION public.notify_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _other uuid;
  _from_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- A cascaded block re-enters this trigger. It must not write a second
  -- inbox row for the same counterparty.
  IF coalesce(current_setting('app.block_cascade', true), '0') = '1' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT full_name INTO _from_name FROM public.profiles WHERE id = NEW.recipient_id;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (OLD.sender_id, 'interest_accepted', 'Introduction accepted',
            'Contact details are now visible to both of you.', '/connections');
    PERFORM public.enqueue_notification(
      OLD.sender_id,
      'interest_accepted',
      jsonb_build_object('from_name', coalesce(_from_name, 'A member'))
    );

  ELSIF OLD.status = 'pending' AND NEW.status = 'declined' THEN
    SELECT full_name INTO _from_name FROM public.profiles WHERE id = NEW.recipient_id;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (OLD.sender_id, 'interest_declined', 'Introduction declined',
            'This introduction was declined. No contact was shared.', '/connections');
    PERFORM public.enqueue_notification(
      OLD.sender_id,
      'interest_declined',
      jsonb_build_object('from_name', coalesce(_from_name, 'A member'))
    );

  ELSIF NEW.status = 'blocked' AND OLD.status <> 'blocked' THEN
    _other := CASE WHEN auth.uid() = OLD.sender_id THEN OLD.recipient_id ELSE OLD.sender_id END;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_other, 'interest_declined', 'Introduction declined',
            'This introduction was declined. No contact was shared.', '/connections');

    -- Cascade the block to the reciprocal ACCEPTED row so an accepted
    -- introduction cannot stay open after one side blocks it.
    PERFORM set_config('app.block_cascade', '1', true);
    UPDATE public.interests
    SET status = 'blocked', updated_at = now()
    WHERE sender_id = OLD.recipient_id
      AND recipient_id = OLD.sender_id
      AND status = 'accepted';
    PERFORM set_config('app.block_cascade', '0', true);
  END IF;

  RETURN NEW;
END; $$;

-- ---------------------------------------------------------------------------
-- 12. [MEDIUM] The partner age band must not fabricate a birthday.
-- ---------------------------------------------------------------------------
-- The predicate computed age(current_date, make_date(birth_year, 1, 1)),
-- which is the age of someone whose birthday is 1 January. It overstated a
-- member's age by up to a year: a member born in December was computed a
-- year older than they are, so a 30-year-old could fall outside a "max age
-- 30" band and a 31-year-old could fall inside it.
--
-- Only the birth YEAR is stored, so the honest test is whether the member's
-- age COULD be inside the band: they are at most (this year - birth_year)
-- and at least (this year - birth_year - 1) years old.
CREATE OR REPLACE FUNCTION private.profile_satisfies_preferences(
  _prefs public.partner_preferences,
  _candidate public.profiles
)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT _prefs.user_id IS NULL OR (
    (_prefs.min_age IS NULL OR (
      _candidate.birth_year IS NOT NULL
      AND (EXTRACT(YEAR FROM current_date))::int - _candidate.birth_year >= _prefs.min_age
    ))
    AND (_prefs.max_age IS NULL OR (
      _candidate.birth_year IS NOT NULL
      AND (EXTRACT(YEAR FROM current_date))::int - _candidate.birth_year - 1 <= _prefs.max_age
    ))
    AND (_prefs.min_height_cm IS NULL OR (_candidate.height_cm IS NOT NULL AND _candidate.height_cm >= _prefs.min_height_cm))
    AND (_prefs.max_height_cm IS NULL OR (_candidate.height_cm IS NOT NULL AND _candidate.height_cm <= _prefs.max_height_cm))
    AND (cardinality(coalesce(_prefs.genders, '{}'::text[])) = 0 OR (_candidate.gender IS NOT NULL AND _candidate.gender = ANY(_prefs.genders)))
    AND (cardinality(coalesce(_prefs.marital_statuses, '{}'::text[])) = 0 OR (_candidate.marital_status IS NOT NULL AND _candidate.marital_status = ANY(_prefs.marital_statuses)))
    AND (cardinality(coalesce(_prefs.diets, '{}'::text[])) = 0 OR (_candidate.diet IS NOT NULL AND _candidate.diet = ANY(_prefs.diets)))
    AND (cardinality(coalesce(_prefs.religions, '{}'::text[])) = 0 OR (_candidate.religion IS NOT NULL AND _candidate.religion = ANY(_prefs.religions)))
    AND (nullif(_prefs.caste_preference, '') IS NULL OR _prefs.caste_preference = 'Open to all / No caste bar' OR (_candidate.caste IS NOT NULL AND _candidate.caste = _prefs.caste_preference))
    AND (nullif(_prefs.manglik_preference, '') IS NULL OR (_candidate.manglik IS NOT NULL AND _candidate.manglik = _prefs.manglik_preference))
    AND (cardinality(coalesce(_prefs.institutions, '{}'::text[])) = 0 OR (_candidate.institution IS NOT NULL AND _candidate.institution = ANY(_prefs.institutions)))
    AND (cardinality(coalesce(_prefs.cities, '{}'::text[])) = 0 OR (_candidate.city IS NOT NULL AND _candidate.city = ANY(_prefs.cities)))
    AND (cardinality(coalesce(_prefs.relocations, '{}'::text[])) = 0 OR (_candidate.relocation IS NOT NULL AND _candidate.relocation = ANY(_prefs.relocations)))
  )
$$;

-- ---------------------------------------------------------------------------
-- 13. [CRITICAL] An atomic checkout claim.
-- ---------------------------------------------------------------------------
-- razorpay-checkout used to read the member's open subscriptions, call
-- Razorpay, and then insert a 'created' row. The read and the insert were not
-- in one transaction, so two concurrent checkouts (a double click, two tabs)
-- both saw no open row, both created a Razorpay subscription object, and both
-- inserted a 'created' row.
--
-- The partial unique index cannot catch that: idx_subscriptions_one_live
-- deliberately excludes 'created', because an abandoned checkout must not
-- block a new one. The consequence was two live auto-debit mandates and two
-- monthly debits for one paid tier — supersedeOtherOpenRows in the webhook
-- rewrote the losing LOCAL row but never cancelled the losing mandate at the
-- provider.
--
-- This function is the single atomic decision point. It holds an advisory
-- transaction lock for the member, so concurrent checkouts serialise, and it
-- returns a verdict the caller MUST obey:
--
--   'claimed'        the caller owns the new 'created' row; proceed.
--   'reuse'          another checkout is already in flight for this plan. The
--                    caller must cancel the provider object it just created
--                    and return the existing subscription id.
--   'already_active' | 'already_pending' | 'other_plan' | 'too_soon'
--                    the caller must cancel the provider object it just
--                    created and surface the matching message.
CREATE OR REPLACE FUNCTION public.claim_checkout_slot(
  _user uuid,
  _plan_code text,
  _rzp_subscription_id text
)
RETURNS TABLE (verdict text, existing_subscription_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _open public.subscriptions;
  _age interval;
BEGIN
  IF _user IS NULL OR _rzp_subscription_id IS NULL OR _plan_code IS NULL THEN
    RETURN QUERY SELECT 'invalid', NULL::text;
    RETURN;
  END IF;

  -- Serialise every checkout for this member.
  PERFORM pg_advisory_xact_lock(hashtext('checkout:' || _user::text));

  -- Ordered by billing significance first (the same order the entitlement
  -- lookup uses), so an older 'active' row is never missed behind a newer
  -- 'created' one.
  SELECT * INTO _open
    FROM public.subscriptions
   WHERE user_id = _user
     AND status IN ('active', 'authenticated', 'pending', 'created')
   ORDER BY array_position(ARRAY['active', 'authenticated', 'pending', 'created'], status),
            created_at DESC
   LIMIT 1;

  IF FOUND THEN
    IF _open.status IN ('active', 'authenticated') THEN
      RETURN QUERY SELECT 'already_active', _open.razorpay_subscription_id;
      RETURN;
    END IF;

    IF _open.status = 'pending' THEN
      -- A failed renewal leaves the mandate ALIVE at the provider — Razorpay
      -- does not cancel a subscription because one invoice failed. The existing
      -- row is the one to retry, never a second subscription.
      RETURN QUERY SELECT 'already_pending', _open.razorpay_subscription_id;
      RETURN;
    END IF;

    -- status = 'created': an in-flight or abandoned checkout.
    IF _open.plan_code <> _plan_code THEN
      RETURN QUERY SELECT 'other_plan', _open.razorpay_subscription_id;
      RETURN;
    END IF;

    _age := now() - _open.created_at;
    IF _age < interval '10 seconds' THEN
      RETURN QUERY SELECT 'too_soon', _open.razorpay_subscription_id;
      RETURN;
    END IF;

    IF _age < interval '15 minutes' THEN
      RETURN QUERY SELECT 'reuse', _open.razorpay_subscription_id;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.subscriptions (user_id, plan_code, razorpay_subscription_id, status)
  VALUES (_user, _plan_code, _rzp_subscription_id, 'created');

  RETURN QUERY SELECT 'claimed', _rzp_subscription_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.claim_checkout_slot(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_checkout_slot(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 14. [HIGH] Entitlement requires recorded payment evidence.
-- ---------------------------------------------------------------------------
-- The webhook's `subscription.activated` branch wrote status = 'active'
-- unconditionally, with no record that any money had moved: the columns that
-- prove a payment (razorpay_payment_id, amount_paid_paise) are written only
-- by the `invoice.paid` branch. `private.subscription_is_live` treats
-- 'active' and 'authenticated' as live, so a row could hold a full paid
-- allowance with amount_paid_paise still NULL.
--
-- The fix is at the row-selection level, because that is where the payment
-- columns exist: every entitling path in this schema already resolves the
-- member's row through private.live_subscription() — entitlement(),
-- count_intro_usage(), mirror_intro_usage(), record_intro_usage() and
-- enforce_intro_allowance() — so gating there gates all of them at once.
-- private.subscription_is_live keeps its signature and its meaning (an
-- entitling status inside an unexpired window); the new requirement is that
-- the row also carries evidence of a payment.
--
-- SAFE DEFAULT — grandfathering: a payer who bought a tier before this change
-- has no recorded payment id, because nothing recorded one. Their live row is
-- backfilled from the plan price rather than left without evidence, because
-- deploying this must never lock out a member who has already paid. The
-- backfill is an inference ("you are active, so you paid"), not a claim about
-- a specific transaction, and it only touches rows that are already live.
UPDATE public.subscriptions s
   SET amount_paid_paise = pl.amount_paise
  FROM public.subscription_plans pl
 WHERE pl.code = s.plan_code
   AND pl.amount_paise > 0
   AND s.status IN ('active', 'authenticated')
   AND s.amount_paid_paise IS NULL;

CREATE OR REPLACE FUNCTION private.live_subscription(_user uuid)
RETURNS SETOF public.subscriptions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.*
  FROM public.subscriptions s
  WHERE s.user_id = _user
    AND private.subscription_is_live(s.status, s.period_end)
    -- Payment evidence: an entitling status alone is not enough. The webhook
    -- records razorpay_payment_id and amount_paid_paise on `invoice.paid`, so
    -- a row without them has no recorded payment behind it.
    AND s.amount_paid_paise IS NOT NULL
  ORDER BY
    array_position(ARRAY['active', 'authenticated'], s.status),
    s.created_at DESC
  LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- 15. Fail-loud regression assertions.
-- ---------------------------------------------------------------------------
-- These abort the migration if any of the fixes above is silently undone.
DO $$
DECLARE
  _body text;
  _qual text;
BEGIN
  -- 2. interests: the INSERT grant must be column-scoped, not table-scoped.
  -- has_table_privilege reports whole-table privileges only, so a table-level
  -- grant is what trips this check.
  IF has_table_privilege('authenticated', 'public.interests', 'INSERT') THEN
    RAISE EXCEPTION 'REGRESSION: public.interests has a table-level INSERT grant for authenticated';
  END IF;

  -- 3. copilots: the INSERT grant must be column-scoped.
  IF has_table_privilege('authenticated', 'public.copilots', 'INSERT') THEN
    RAISE EXCEPTION 'REGRESSION: public.copilots has a table-level INSERT grant for authenticated';
  END IF;

  -- 4. consent_events: no member write path outside record_consent().
  IF has_table_privilege('authenticated', 'public.consent_events', 'INSERT') THEN
    RAISE EXCEPTION 'REGRESSION: public.consent_events has a member INSERT grant';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'consent_events' AND cmd = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: public.consent_events has a member INSERT policy';
  END IF;

  -- 5. calls and profile_views: the UPDATE grants must be column-scoped.
  IF has_table_privilege('authenticated', 'public.calls', 'UPDATE') THEN
    RAISE EXCEPTION 'REGRESSION: public.calls has a table-level UPDATE grant for authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.profile_views', 'UPDATE') THEN
    RAISE EXCEPTION 'REGRESSION: public.profile_views has a table-level UPDATE grant for authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.profile_views', 'INSERT') THEN
    RAISE EXCEPTION 'REGRESSION: public.profile_views has a table-level INSERT grant for authenticated';
  END IF;

  -- 6. the global sweeps must not be member-callable.
  IF has_function_privilege('authenticated', 'public.expire_stale_interests()', 'EXECUTE') THEN
    RAISE EXCEPTION 'REGRESSION: authenticated can still call public.expire_stale_interests()';
  END IF;
  IF has_function_privilege('authenticated', 'public.sweep_stale_calls()', 'EXECUTE') THEN
    RAISE EXCEPTION 'REGRESSION: authenticated can still call public.sweep_stale_calls()';
  END IF;

  -- 8. the permissive directory policy must be gone.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Members read visible onboarded'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: the permissive "Members read visible onboarded" policy exists';
  END IF;

  -- 8. the verified-only directory policy must be the one that is present.
  SELECT qual INTO _qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'
     AND policyname = 'Verified members and copilots read the directory';
  IF _qual IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: the verified-only directory policy is missing';
  END IF;
  IF _qual NOT ILIKE '%verification_status%'
     OR _qual NOT ILIKE '%is_verified%'
     OR _qual NOT ILIKE '%is_active_copilot%' THEN
    RAISE EXCEPTION 'REGRESSION: the directory policy no longer gates on verification';
  END IF;

  -- 10. notify_counterparty must reject an unknown event.
  SELECT pg_get_functiondef(oid) INTO _body
    FROM pg_proc
   WHERE proname = 'notify_counterparty' AND pronamespace = 'public'::regnamespace;
  IF _body IS NULL OR _body NOT ILIKE '%Unknown notification event%' THEN
    RAISE EXCEPTION 'REGRESSION: notify_counterparty no longer fails loud on an unknown event';
  END IF;

  -- 7. get_or_create_conversation must not re-point the governing interest.
  SELECT pg_get_functiondef(oid) INTO _body
    FROM pg_proc
   WHERE proname = 'get_or_create_conversation' AND pronamespace = 'public'::regnamespace;
  IF _body IS NULL OR _body ILIKE '%SET interest_id = EXCLUDED%' THEN
    RAISE EXCEPTION 'REGRESSION: get_or_create_conversation re-points the governing interest';
  END IF;

  -- 12. the age band must not fabricate a 1-January birthday.
  SELECT pg_get_functiondef(oid) INTO _body
    FROM pg_proc
   WHERE proname = 'profile_satisfies_preferences'
     AND pronamespace = 'private'::regnamespace;
  IF _body IS NULL OR _body ILIKE '%make_date(%' THEN
    RAISE EXCEPTION 'REGRESSION: the age band still fabricates a 1-January birthday';
  END IF;

  -- 13. the checkout claim must be atomic and must be the only write path.
  SELECT pg_get_functiondef(oid) INTO _body
    FROM pg_proc
   WHERE proname = 'claim_checkout_slot' AND pronamespace = 'public'::regnamespace;
  IF _body IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: public.claim_checkout_slot is missing';
  END IF;
  IF _body NOT ILIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'REGRESSION: public.claim_checkout_slot does not serialise concurrent checkouts';
  END IF;
  IF _body NOT ILIKE '%already_active%'
     OR _body NOT ILIKE '%reuse%'
     OR _body NOT ILIKE '%claimed%' THEN
    RAISE EXCEPTION 'REGRESSION: public.claim_checkout_slot is missing a verdict';
  END IF;

  -- 14. entitlement must require recorded payment evidence.
  SELECT pg_get_functiondef(oid) INTO _body
    FROM pg_proc
   WHERE proname = 'live_subscription' AND pronamespace = 'private'::regnamespace;
  IF _body IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: private.live_subscription is missing';
  END IF;
  IF _body NOT ILIKE '%amount_paid_paise IS NOT NULL%' THEN
    RAISE EXCEPTION 'REGRESSION: private.live_subscription no longer requires recorded payment evidence';
  END IF;

  -- 14. every existing live payer must still be live after the change.
  IF EXISTS (
    SELECT 1 FROM public.subscriptions s
     WHERE s.status IN ('active', 'authenticated')
       AND s.amount_paid_paise IS NULL
  ) THEN
    RAISE EXCEPTION
      'REGRESSION: % live subscription row(s) carry no recorded payment — entitlement would be withdrawn from a paying member',
      (SELECT count(*) FROM public.subscriptions
        WHERE status IN ('active', 'authenticated') AND amount_paid_paise IS NULL);
  END IF;
END $$;
