-- ===========================================================================
-- 20261104: Expert Audit Remediation — Runtime, Security & Schema Fixes.
--
-- Remediates all P0/P1/P2 database and RPC findings:
--  1. [P0] Fix public.get_or_create_conversation(_interest_id):
--     - Remove reference to non-existent conversations.updated_at column
--     - Refresh conversations.interest_id to the active accepted _interest_id
--       so message/call RLS policies joining c.interest_id always pass
--  2. [P0] Fix public.sweep_stale_calls():
--     - Replace non-existent calls.created_at with calls.started_at
--  3. [P0] Fix public.expire_stale_interests():
--     - Replace non-existent interests.reminder_sent boolean with actual
--       interests.reminder_sent_at timestamptz and 'interest_reminder' kind
--  4. [P1] Lock down public.messages UPDATE privileges and immutable columns:
--     - Restrict UPDATE grant on public.messages to (read_at) only
--     - Add BEFORE UPDATE trigger guard_message_columns() freezing id,
--       conversation_id, sender_id, body, and created_at
--  5. [P1] Lock down public.interests UPDATE privileges and immutable columns:
--     - Restrict UPDATE grant on public.interests to (status, message)
--     - Harden enforce_interest_transition() so members cannot mutate
--       sender_id, recipient_id, created_at, or post-decision message
--  6. [P2] Wire manglik_preference into partner preference matching & RPCs:
--     - Update private.preferences_have_criteria()
--     - Update private.profile_satisfies_preferences()
--     - Update public.get_profile_partner_preferences(_profile)
--  7. [P2] Include created_by and nakshatra_pada in public.discover_members()
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. [P0] Fix public.get_or_create_conversation(_interest_id uuid)
-- ---------------------------------------------------------------------------
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

  INSERT INTO public.conversations (interest_id, participant_a, participant_b)
  VALUES (_interest_id, _part_a, _part_b)
  ON CONFLICT (participant_a, participant_b) DO UPDATE
    SET interest_id = EXCLUDED.interest_id
  RETURNING id INTO _conv;

  RETURN _conv;
END; $$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. [P0] Fix public.sweep_stale_calls() (started_at instead of created_at)
-- ---------------------------------------------------------------------------
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
  WHERE status <> 'ended'
    AND started_at < now() - interval '2 hours';

  GET DIAGNOSTICS _extra = ROW_COUNT;
  _closed := _closed + _extra;

  RETURN _closed;
END; $$;

REVOKE EXECUTE ON FUNCTION public.sweep_stale_calls() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_stale_calls() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. [P0] Fix public.expire_stale_interests() (reminder_sent_at column)
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
       AND reminder_sent_at IS NULL
       AND expires_at IS NOT NULL
       AND expires_at - interval '7 days' <= now()
       AND expires_at >= now()
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.interests
       SET reminder_sent_at = now(), updated_at = now()
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_interests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_interests() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. [P1] Lock down public.messages UPDATE privileges & immutable columns
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT UPDATE (read_at) ON public.messages TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_message_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Messages can only be marked as read' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS messages_guard_columns ON public.messages;
CREATE TRIGGER messages_guard_columns
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_columns();

-- ---------------------------------------------------------------------------
-- 5. [P1] Lock down public.interests UPDATE privileges & immutable columns
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.interests FROM authenticated;
GRANT UPDATE (status, message) ON public.interests TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean := false;
BEGIN
  IF current_setting('app.pacing_job', true) = '1' AND NEW.status = 'expired' THEN
    RETURN NEW;
  END IF;

  -- Immutable identity & creation timestamp for member writes
  IF _uid IS NOT NULL THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
       OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Introduction identity and creation timestamp are immutable'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.message IS DISTINCT FROM OLD.message
       AND NOT (_uid = OLD.sender_id AND NEW.status = 'pending') THEN
      RAISE EXCEPTION 'Introduction note can only be edited by the sender while pending'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Stamp/clear decision and expiry timestamps on status transitions
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
      NEW.expires_at := now() + interval '14 days';
      NEW.reminder_sent_at := NULL;
      NEW.decided_at := NULL;
    ELSIF NEW.status IN ('accepted', 'declined', 'blocked') THEN
      NEW.decided_at := now();
    END IF;
  END IF;

  IF _uid IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF _uid = OLD.sender_id AND _uid <> OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status = 'withdrawn')
             OR (OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending')
             OR (OLD.status = 'accepted' AND NEW.status = 'blocked');
  ELSIF _uid = OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined'))
             OR (OLD.status = 'accepted' AND NEW.status = 'blocked');
  END IF;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Only the recipient may accept an introduction, and only while it is pending'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END; $$;

-- ---------------------------------------------------------------------------
-- 6. [P2] Wire manglik_preference into partner preference matching & RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.preferences_have_criteria(_prefs public.partner_preferences)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _prefs.user_id IS NOT NULL AND (
    _prefs.min_age IS NOT NULL OR _prefs.max_age IS NOT NULL
    OR _prefs.min_height_cm IS NOT NULL OR _prefs.max_height_cm IS NOT NULL
    OR cardinality(coalesce(_prefs.genders, '{}'::text[])) > 0
    OR cardinality(coalesce(_prefs.marital_statuses, '{}'::text[])) > 0
    OR cardinality(coalesce(_prefs.diets, '{}'::text[])) > 0
    OR cardinality(coalesce(_prefs.religions, '{}'::text[])) > 0
    OR nullif(_prefs.caste_preference, '') IS NOT NULL
    OR nullif(_prefs.manglik_preference, '') IS NOT NULL
    OR cardinality(coalesce(_prefs.institutions, '{}'::text[])) > 0
    OR cardinality(coalesce(_prefs.cities, '{}'::text[])) > 0
    OR cardinality(coalesce(_prefs.relocations, '{}'::text[])) > 0
  )
$$;

REVOKE EXECUTE ON FUNCTION private.preferences_have_criteria(public.partner_preferences) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.preferences_have_criteria(public.partner_preferences) TO service_role;

CREATE OR REPLACE FUNCTION private.profile_satisfies_preferences(
  _prefs public.partner_preferences,
  _candidate public.profiles
)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT _prefs.user_id IS NULL OR (
    (_prefs.min_age IS NULL OR (_candidate.birth_year IS NOT NULL AND date_part('year', age(current_date, make_date(_candidate.birth_year, 1, 1))) BETWEEN _prefs.min_age AND coalesce(_prefs.max_age, 130)))
    AND (_prefs.max_age IS NULL OR (_candidate.birth_year IS NOT NULL AND date_part('year', age(current_date, make_date(_candidate.birth_year, 1, 1))) BETWEEN coalesce(_prefs.min_age, 0) AND _prefs.max_age))
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

REVOKE EXECUTE ON FUNCTION private.profile_satisfies_preferences(public.partner_preferences, public.profiles) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.profile_satisfies_preferences(public.partner_preferences, public.profiles) TO service_role;

DROP FUNCTION IF EXISTS public.get_profile_partner_preferences(uuid);

CREATE FUNCTION public.get_profile_partner_preferences(_profile uuid)
RETURNS TABLE (
  min_age int, max_age int, min_height_cm int, max_height_cm int,
  genders text[], marital_statuses text[], diets text[], religions text[],
  caste_preference text, manglik_preference text,
  institutions text[], cities text[], relocations text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT pp.min_age, pp.max_age, pp.min_height_cm, pp.max_height_cm,
         pp.genders, pp.marital_statuses, pp.diets, pp.religions,
         pp.caste_preference, pp.manglik_preference,
         pp.institutions, pp.cities, pp.relocations
  FROM public.partner_preferences pp
  JOIN public.profiles p ON p.id = pp.user_id
  WHERE pp.user_id = _profile
    AND auth.uid() IS NOT NULL
    AND (
      pp.user_id = auth.uid()
      OR (
        private.is_verified(auth.uid())
        AND p.is_visible AND p.onboarded AND p.verification_status = 'verified'
        AND (p.paused_until IS NULL OR p.paused_until <= now())
        AND NOT private.same_shielded_employer(p.employer, auth.uid())
      )
    )
$$;

REVOKE EXECUTE ON FUNCTION public.get_profile_partner_preferences(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_partner_preferences(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. [P2] Update public.discover_members() to return created_by & nakshatra_pada
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.discover_members(
  text,int,int,text,text,boolean,text,text,text,text,text,text,text,text,text,text,text,int,int,int,text
);

CREATE FUNCTION public.discover_members(
  _feed text DEFAULT 'all',
  _page int DEFAULT 0,
  _page_size int DEFAULT 24,
  _city text DEFAULT NULL,
  _profession text DEFAULT NULL,
  _with_photo boolean DEFAULT false,
  _sort text DEFAULT 'joined',
  _institution text DEFAULT NULL,
  _relocation text DEFAULT NULL,
  _gender text DEFAULT NULL,
  _diet text DEFAULT NULL,
  _marital_status text DEFAULT NULL,
  _residency text DEFAULT NULL,
  _mother_tongue text DEFAULT NULL,
  _religion text DEFAULT NULL,
  _rashi text DEFAULT NULL,
  _manglik text DEFAULT NULL,
  _min_height int DEFAULT NULL,
  _min_birth_year int DEFAULT NULL,
  _max_birth_year int DEFAULT NULL,
  _search text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, full_name text, city text, institution text, degree text, grad_year int,
  profession text, relocation text, birth_year int, gender text, height_cm int,
  marital_status text, diet text, mother_tongue text, residency_status text,
  photo_path text, photo_visibility text, religion text, caste text, gotra text,
  created_by text, rashi text, nakshatra text, nakshatra_pada int, manglik text,
  created_at timestamptz, total_count bigint, matches_your_preferences boolean,
  matches_their_preferences boolean, mutual_match boolean, activity_bucket text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT private.is_verified(_uid) THEN
    RAISE EXCEPTION 'Verified membership required' USING ERRCODE = '42501';
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
      AND (_rashi IS NULL OR c.rashi = _rashi)
      AND (_manglik IS NULL OR c.manglik = _manglik)
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
    f.created_by, f.rashi, f.nakshatra, f.nakshatra_pada, f.manglik,
    f.created_at, f.total_count, f.you_fit, f.they_fit,
    (f.you_fit AND f.they_fit),
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

REVOKE EXECUTE ON FUNCTION public.discover_members(text,int,int,text,text,boolean,text,text,text,text,text,text,text,text,text,text,text,int,int,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discover_members(text,int,int,text,text,boolean,text,text,text,text,text,text,text,text,text,text,text,int,int,int,text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Fail-loud regression assertions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _sweep_body text;
  _expire_body text;
  _conv_body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _sweep_body
  FROM pg_proc WHERE proname = 'sweep_stale_calls' AND pronamespace = 'public'::regnamespace;
  IF _sweep_body LIKE '%created_at%' THEN
    RAISE EXCEPTION 'REGRESSION: sweep_stale_calls() still references non-existent calls.created_at';
  END IF;

  SELECT pg_get_functiondef(oid) INTO _expire_body
  FROM pg_proc WHERE proname = 'expire_stale_interests' AND pronamespace = 'public'::regnamespace;
  IF _expire_body NOT LIKE '%reminder_sent_at%' THEN
    RAISE EXCEPTION 'REGRESSION: expire_stale_interests() must use interests.reminder_sent_at';
  END IF;

  SELECT pg_get_functiondef(oid) INTO _conv_body
  FROM pg_proc WHERE proname = 'get_or_create_conversation' AND pronamespace = 'public'::regnamespace;
  IF _conv_body LIKE '%updated_at%' THEN
    RAISE EXCEPTION 'REGRESSION: get_or_create_conversation() still references non-existent conversations.updated_at';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'messages_guard_columns'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: messages_guard_columns trigger is missing';
  END IF;
END $$;
