-- ===========================================================================
-- 20261101: Production-Readiness Security, Integrity & Reliability Hardening.
--
-- Covers:
--  1. [CRIT-01] Privilege escalation hardening:
--     - Restrict public.profiles INSERT privileges to safe registration columns
--     - Add BEFORE INSERT trigger enforcing is_admin = false and unverified defaults
--  2. [HIGH-02] Co-pilot integrity:
--     - Update guard_copilot_columns() trigger to prevent candidate forgery of
--       copilot_user_id or unilateral promotion of status to 'active'.
--  3. [HIGH-03] Conversation & Blocking Integrity:
--     - Enforce canonical unique index on public.conversations (participant_a, participant_b)
--     - Update get_or_create_conversation() to query canonical participants symmetrically
--     - Update notify_interest_transition() to cascade blocks bidirectionally
--  4. [HIGH-01] Notification Outbox Pipeline:
--     - Wire notify_interest_transition() and notify_counterparty() to call
--       public.enqueue_notification(...) so transactional emails, SMS, and WhatsApp alerts
--       are persisted to notification_outbox and dispatched.
--  5. [MED-01] Product Truth - Paid Tier Discovery Placement:
--     - Update discover_members() to honor placement_weight from active subscription plans.
--  6. [MED-03 & LOW-03] Concurrency & Stale Cleanup Fixes:
--     - Add SKIP LOCKED to expire_stale_interests() loop
--     - Fix sweep_stale_calls() so _closed accumulator is not overwritten
--  7. [MED-04] pg_cron Schedule Day-of-Week Correction:
--     - Fix weekly-digest pg_cron schedule from '30 6 * * 2' (Tuesday) to '30 6 * * 1' (Monday)
--  8. [LOW-02] Storage Mime Types:
--     - Add image/webp to profile-photos bucket allowed_mime_types
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. [CRIT-01] Profiles INSERT Privilege Escalation Guard
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.profiles FROM authenticated;
GRANT INSERT (id, full_name, adult_attested_at) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_profiles_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Defense-in-depth: regardless of caller role or payload, always force
  -- unprivileged, unverified baseline state on creation.
  NEW.is_admin := false;
  NEW.verification_status := 'unverified';
  NEW.alumni_email_verified := false;
  NEW.verification_decided_at := NULL;
  NEW.verification_decided_by := NULL;
  NEW.verification_note := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profiles_insert ON public.profiles;
CREATE TRIGGER trg_guard_profiles_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profiles_insert();

-- ---------------------------------------------------------------------------
-- 2. [HIGH-02] Co-Pilot Columns & Status Guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_copilot_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    -- If caller is the candidate, guard immutable invite coordinates and status
    IF auth.uid() = OLD.candidate_id THEN
      IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
         OR NEW.invite_code IS DISTINCT FROM OLD.invite_code
         OR NEW.copilot_email IS DISTINCT FROM OLD.copilot_email THEN
        RAISE EXCEPTION 'A co-pilot invitation cannot be reassigned' USING ERRCODE = '42501';
      END IF;

      -- Candidate cannot unilaterally bind arbitrary user IDs without invite redemption
      IF NEW.copilot_user_id IS DISTINCT FROM OLD.copilot_user_id THEN
        RAISE EXCEPTION 'Only invite acceptance can bind a co-pilot user' USING ERRCODE = '42501';
      END IF;

      -- Candidate cannot activate directly; activation happens strictly via accept_copilot_invite()
      IF NEW.status = 'active' AND OLD.status <> 'active' THEN
        RAISE EXCEPTION 'Only invite acceptance can activate a co-pilot relationship' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- ---------------------------------------------------------------------------
-- 3. [HIGH-03] Conversation Canonical Constraint & Symmetric Lookup
-- ---------------------------------------------------------------------------
-- Deduplicate any legacy multiple conversations for the same pair keeping the one with messages/activity
DO $$
BEGIN
  DELETE FROM public.conversations c1
  USING public.conversations c2
  WHERE c1.id <> c2.id
    AND c1.participant_a = c2.participant_a
    AND c1.participant_b = c2.participant_b
    AND (
      c1.last_message_at < c2.last_message_at
      OR (c1.last_message_at IS NULL AND c2.last_message_at IS NOT NULL)
      OR (c1.last_message_at IS NOT DISTINCT FROM c2.last_message_at AND c1.created_at < c2.created_at)
    );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_canonical_participants
  ON public.conversations (participant_a, participant_b);

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

  -- First, check if a canonical conversation already exists between this pair
  SELECT id INTO _conv
  FROM public.conversations
  WHERE participant_a = _part_a AND participant_b = _part_b
  LIMIT 1;

  IF _conv IS NOT NULL THEN
    RETURN _conv;
  END IF;

  INSERT INTO public.conversations (interest_id, participant_a, participant_b)
  VALUES (_interest_id, _part_a, _part_b)
  ON CONFLICT (participant_a, participant_b) DO UPDATE
    SET updated_at = now()
  RETURNING id INTO _conv;

  RETURN _conv;
END; $$;

-- ---------------------------------------------------------------------------
-- 4. [HIGH-01 & HIGH-03] Wire Notification Outbox & Bidirectional Blocking Cascade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _other uuid;
  _from_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT full_name INTO _from_name FROM public.profiles WHERE id = NEW.recipient_id;
    -- In-app alert
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (OLD.sender_id, 'interest_accepted', 'Introduction accepted',
            'Contact details are now visible to both of you.', '/connections');
    -- Transactional alert (email / SMS / WhatsApp)
    PERFORM public.enqueue_notification(
      OLD.sender_id,
      'interest_accepted',
      jsonb_build_object('from_name', coalesce(_from_name, 'A member'))
    );

  ELSIF OLD.status = 'pending' AND NEW.status = 'declined' THEN
    SELECT full_name INTO _from_name FROM public.profiles WHERE id = NEW.recipient_id;
    -- In-app alert
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (OLD.sender_id, 'interest_declined', 'Introduction declined',
            'This introduction was declined. No contact was shared.', '/connections');
    -- Transactional alert
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

    -- Cascade block bidirectionally so neither party can circumvent the block
    UPDATE public.interests
    SET status = 'blocked', updated_at = now()
    WHERE sender_id = OLD.recipient_id
      AND recipient_id = OLD.sender_id
      AND status <> 'blocked';
  END IF;

  RETURN NEW;
END; $$;

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
  END IF;
END; $$;

-- Also enqueue alert when copilot invite is accepted
CREATE OR REPLACE FUNCTION public.accept_copilot_invite(_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  _copilot_name text;
  _row public.copilots;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to accept a co-pilot invitation' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR length(_code) < 8 THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO _row FROM public.copilots WHERE invite_code = _code AND status <> 'revoked' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF _row.copilot_user_id IS NOT NULL AND _row.copilot_user_id <> _uid THEN
    RAISE EXCEPTION 'invitation_already_used' USING ERRCODE = 'P0001';
  END IF;
  IF _email = '' OR lower(_row.copilot_email) <> _email THEN
    RAISE EXCEPTION 'This invitation was addressed to %, not %', _row.copilot_email, _email USING ERRCODE = '42501';
  END IF;

  UPDATE public.copilots
  SET copilot_user_id = _uid,
      status = 'active',
      accepted_at = now()
  WHERE id = _row.id;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (_row.candidate_id, 'copilot_invite_accepted', 'Co-pilot accepted',
          _row.copilot_name || ' accepted your co-pilot invitation and can now view matching profiles with you.', '/copilots');

  SELECT full_name INTO _copilot_name FROM public.profiles WHERE id = _uid;
  PERFORM public.enqueue_notification(
    _row.candidate_id,
    'copilot_invite_accepted',
    jsonb_build_object('from_name', coalesce(_row.copilot_name, _copilot_name, 'Your co-pilot'))
  );

  RETURN _row.id;
END; $$;

-- ---------------------------------------------------------------------------
-- 5. [MED-03 & LOW-03] Concurrency & Cleanup Hardening
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

  -- SKIP LOCKED prevents concurrent client visits to /connections from serializing or blocking
  FOR _row IN
    SELECT * FROM public.interests
     WHERE status = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at < now()
     FOR UPDATE SKIP LOCKED
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
       AND expires_at IS NOT NULL
       AND expires_at < now() + interval '3 days'
       AND expires_at >= now()
       AND NOT reminder_sent
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.interests
       SET reminder_sent = true, updated_at = now()
     WHERE id = _row.id;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      _row.recipient_id,
      'interest_received',
      'An introduction will expire soon',
      'An introduction waiting for your response will close in three days.',
      '/connections'
    );

    _reminded := _reminded + 1;
  END LOOP;

  RETURN _expired;
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_stale_calls()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _closed int := 0;
  _extra int := 0;
  _row record;
BEGIN
  FOR _row IN
    SELECT id, callee_id
    FROM public.calls
    WHERE status = 'ringing'
      AND created_at < now() - interval '90 seconds'
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
  WHERE status <> 'ended'
    AND started_at < now() - interval '2 hours';

  GET DIAGNOSTICS _extra = ROW_COUNT;
  _closed := _closed + _extra;

  RETURN _closed;
END; $$;

-- ---------------------------------------------------------------------------
-- 6. [MED-04] Correct pg_cron weekly-digest schedule
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'weekly-digest';
    -- Vixie cron day of week: 1 = Monday (0/7 = Sunday). Runs Mondays at 06:30 UTC.
    PERFORM cron.schedule(
      'weekly-digest',
      '30 6 * * 1',
      $job$
      SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
                 || '/functions/v1/weekly-digest',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'X-Cron-Secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'), ''),
          'X-Cron-Previous', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret_previous'), '')
        ),
        body    := '{}'::jsonb
      )
      $job$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Safe fallback during environments without pg_cron or vault configured
  RAISE NOTICE 'pg_cron rescheduling skipped: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 7. [MED-01] Paid Tier Placement Weight in discover_members()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.discover_members(
  _feed text DEFAULT 'all',
  _page int DEFAULT 0,
  _page_size int DEFAULT 20,
  _city text DEFAULT NULL,
  _profession text DEFAULT NULL,
  _with_photo boolean DEFAULT false,
  _institution text DEFAULT NULL,
  _relocation text DEFAULT NULL,
  _gender text DEFAULT NULL,
  _diet text DEFAULT NULL,
  _marital_status text DEFAULT NULL,
  _residency text DEFAULT NULL,
  _mother_tongue text DEFAULT NULL,
  _religion text DEFAULT NULL,
  _search text DEFAULT NULL,
  _min_height int DEFAULT NULL,
  _min_birth_year int DEFAULT NULL,
  _max_birth_year int DEFAULT NULL,
  _sort text DEFAULT 'joined'
)
RETURNS TABLE(
  id uuid,
  full_name text,
  city text,
  institution text,
  degree text,
  grad_year int,
  profession text,
  relocation text,
  birth_year int,
  gender text,
  height_cm int,
  marital_status text,
  diet text,
  mother_tongue text,
  residency_status text,
  photo_path text,
  photo_visibility text,
  religion text,
  caste text,
  gotra text,
  created_at timestamptz,
  total_count bigint,
  you_fit boolean,
  they_fit boolean,
  mutual_fit boolean,
  activity_level text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required for directory discovery' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.verification_status = 'verified'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.copilots c WHERE c.copilot_user_id = _uid AND c.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Verified membership required for directory discovery' USING ERRCODE = '42501';
  END IF;
  IF _feed NOT IN ('all', 'mutual', 'looking_for_you', 'new', 'shortlisted', 'viewed_by_you', 'viewed_you') THEN
    RAISE EXCEPTION 'Invalid discovery feed' USING ERRCODE = '22023';
  END IF;
  IF _page < 0 OR _page_size < 1 OR _page_size > 50 THEN
    RAISE EXCEPTION 'Invalid discovery page' USING ERRCODE = '22023';
  END IF;
  _search := nullif(left(regexp_replace(coalesce(_search, ''), '[%_,()]', '', 'g'), 60), '');
  _profession := nullif(left(regexp_replace(coalesce(_profession, ''), '[%_,()]', '', 'g'), 80), '');
  IF _sort NOT IN ('joined', 'youngest', 'active') THEN
    RAISE EXCEPTION 'Invalid discovery sort' USING ERRCODE = '22023';
  END IF;
  IF _sort = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.member_activity ma WHERE ma.user_id = _uid AND ma.enabled
  ) THEN
    RAISE EXCEPTION 'Enable coarse activity sharing before sorting by activity' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH viewer AS (
    SELECT p.*, EXISTS (
      SELECT 1 FROM public.partner_preferences vp
      WHERE vp.user_id = p.id AND private.preferences_have_criteria(vp)
    ) AS has_preferences
    FROM public.profiles p WHERE p.id = _uid
  ), mine AS (
    SELECT pp.* FROM public.partner_preferences pp WHERE pp.user_id = _uid
  ), signals AS (
    SELECT c.id,
      mine.user_id IS NOT NULL AND private.preferences_have_criteria(mine)
        AND private.profile_satisfies_preferences(mine, c) AS you_fit,
      cp.user_id IS NOT NULL AND private.preferences_have_criteria(cp)
        AND private.profile_satisfies_preferences(cp, viewer) AS they_fit,
      coalesce(ma.enabled, false) AND ma.last_active_at >= now() - interval '24 hours' AS active_recently,
      coalesce(ma.enabled, false) AND ma.last_active_at >= now() - interval '7 days' AS active_this_week,
      coalesce(pw.placement_weight, 0) AS placement_weight
    FROM public.profiles c CROSS JOIN viewer
    LEFT JOIN mine ON true
    LEFT JOIN public.partner_preferences cp ON cp.user_id = c.id
    LEFT JOIN public.member_activity ma ON ma.user_id = c.id
    LEFT JOIN LATERAL (
      SELECT coalesce(sp.placement_weight, 0) AS placement_weight
      FROM public.subscriptions sub
      JOIN public.subscription_plans sp ON sp.code = sub.plan_code
      WHERE sub.user_id = c.id
        AND sub.status IN ('active', 'authenticated')
        AND (sub.period_end IS NULL OR sub.period_end > now())
      ORDER BY sp.placement_weight DESC
      LIMIT 1
    ) pw ON true
    WHERE c.id <> _uid
      AND c.is_visible AND c.onboarded AND c.verification_status = 'verified'
      AND (c.paused_until IS NULL OR c.paused_until <= now())
      AND NOT private.same_shielded_employer(c.employer, _uid)
      AND (_feed <> 'new' OR c.created_at >= now() - interval '30 days')
      AND (_city IS NULL OR c.city = _city)
      AND (_profession IS NULL OR c.profession ILIKE '%' || _profession || '%')
      AND (_institution IS NULL OR c.institution = _institution)
      AND (_relocation IS NULL OR c.relocation = _relocation)
      AND (_gender IS NULL OR c.gender = _gender)
      AND (_diet IS NULL OR c.diet = _diet)
      AND (_marital_status IS NULL OR c.marital_status = _marital_status)
      AND (_residency IS NULL OR c.residency_status = _residency)
      AND (_mother_tongue IS NULL OR c.mother_tongue = _mother_tongue)
      AND (_religion IS NULL OR c.religion = _religion)
      AND (_min_height IS NULL OR c.height_cm >= _min_height)
      AND (_min_birth_year IS NULL OR c.birth_year >= _min_birth_year)
      AND (_max_birth_year IS NULL OR c.birth_year <= _max_birth_year)
      AND (_search IS NULL OR c.full_name ILIKE '%' || _search || '%'
        OR c.city ILIKE '%' || _search || '%'
        OR c.profession ILIKE '%' || _search || '%'
        OR c.degree ILIKE '%' || _search || '%'
        OR c.caste ILIKE '%' || _search || '%'
        OR c.gotra ILIKE '%' || _search || '%')
      AND (NOT _with_photo OR c.photo_path IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.profile_dismissals d WHERE d.dismisser_id = _uid AND d.dismissed_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.interests i WHERE i.status='blocked'
        AND ((i.sender_id=_uid AND i.recipient_id=c.id) OR (i.sender_id=c.id AND i.recipient_id=_uid)))
      AND (
        _feed NOT IN ('mutual', 'looking_for_you')
        OR (SELECT v.has_preferences FROM viewer v)
      )
      AND (
        _feed <> 'shortlisted' OR EXISTS (SELECT 1 FROM public.saved_profiles s WHERE s.user_id=_uid AND s.profile_id=c.id)
      )
      AND (
        _feed <> 'viewed_by_you' OR EXISTS (SELECT 1 FROM public.profile_views v WHERE v.viewer_id=_uid AND v.viewed_id=c.id)
      )
      AND (
        _feed <> 'viewed_you' OR ((SELECT p.show_profile_views FROM viewer p)
          AND EXISTS (SELECT 1 FROM public.profile_views v WHERE v.viewer_id=c.id AND v.viewed_id=_uid))
      )
  ), filtered AS (
    SELECT c.*, s.you_fit, s.they_fit, s.active_recently, s.active_this_week, s.placement_weight
    FROM public.profiles c JOIN signals s ON s.id=c.id
    WHERE (_feed <> 'mutual' OR (s.you_fit AND s.they_fit))
      AND (_feed <> 'looking_for_you' OR (s.they_fit AND NOT s.you_fit))
  ), counted AS (
    SELECT filtered.*, count(*) OVER() AS total_count FROM filtered
  )
  SELECT f.id, f.full_name, f.city, f.institution, f.degree, f.grad_year,
    f.profession, f.relocation, f.birth_year, f.gender, f.height_cm,
    f.marital_status, f.diet, f.mother_tongue, f.residency_status,
    f.photo_path, f.photo_visibility, f.religion, f.caste, f.gotra,
    f.created_at, f.total_count, f.you_fit, f.they_fit,
    f.you_fit AND f.they_fit,
    CASE WHEN f.active_recently THEN 'recently' WHEN f.active_this_week THEN 'this_week' ELSE NULL END
  FROM counted f
  ORDER BY
    f.placement_weight DESC,
    CASE WHEN _sort = 'youngest' THEN f.birth_year END DESC NULLS LAST,
    CASE WHEN _sort = 'active' THEN f.active_recently::int END DESC NULLS LAST,
    CASE WHEN _sort = 'active' THEN f.active_this_week::int END DESC NULLS LAST,
    CASE WHEN _sort IN ('joined', 'youngest', 'active') THEN f.created_at END DESC,
    f.id
  OFFSET _page * _page_size LIMIT _page_size;
END; $$;

-- ---------------------------------------------------------------------------
-- 8. [LOW-02] Storage Bucket Mime Types - Allow WebP
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'profile-photos';
