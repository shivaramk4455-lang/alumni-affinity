-- Phase B: privacy-safe member discovery and mutual preference signals.
-- Existing profiles/preferences/history remain intact; activity tracking is opt-in.

-- Partner preference rows may be read directly only by their owner. Cross-member
-- display and matching use scoped security-definer projections below.
DROP POLICY IF EXISTS "Partner preferences read" ON public.partner_preferences;
DROP POLICY IF EXISTS "Own preferences read" ON public.partner_preferences;
CREATE POLICY "Own preferences read" ON public.partner_preferences FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.member_activity (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  last_active_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_activity_disabled_has_no_timestamp
    CHECK (enabled OR last_active_at IS NULL)
);

REVOKE ALL ON public.member_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.member_activity TO authenticated;
GRANT ALL ON public.member_activity TO service_role;
ALTER TABLE public.member_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own activity setting read" ON public.member_activity;
CREATE POLICY "Own activity setting read" ON public.member_activity FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE public.consent_events DROP CONSTRAINT IF EXISTS consent_events_purpose_valid;
ALTER TABLE public.consent_events
  ADD CONSTRAINT consent_events_purpose_valid CHECK (purpose IN (
    'terms_and_privacy', 'partnership_criteria', 'document_review',
    'photo_watermarking', 'contact_disclosure', 'sabbatical_visibility',
    'profile_views_display', 'activity_tracking', 'account_deletion',
    'subscription_cancellation', 'rate_limit_admin_review',
    'rate_limit_turn_credentials', 'rate_limit_subscription_cancel'
  ));

-- Preference data for other members is returned without shield_employer and
-- only for an otherwise directory-visible verified profile.
CREATE OR REPLACE FUNCTION public.get_profile_partner_preferences(_profile uuid)
RETURNS TABLE (
  min_age int, max_age int, min_height_cm int, max_height_cm int,
  genders text[], marital_statuses text[], diets text[], religions text[],
  caste_preference text, institutions text[], cities text[], relocations text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT pp.min_age, pp.max_age, pp.min_height_cm, pp.max_height_cm,
         pp.genders, pp.marital_statuses, pp.diets, pp.religions,
         pp.caste_preference, pp.institutions, pp.cities, pp.relocations
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
    AND (nullif(_prefs.caste_preference, '') IS NULL OR (_candidate.caste IS NOT NULL AND _candidate.caste = _prefs.caste_preference))
    AND (cardinality(coalesce(_prefs.institutions, '{}'::text[])) = 0 OR (_candidate.institution IS NOT NULL AND _candidate.institution = ANY(_prefs.institutions)))
    AND (cardinality(coalesce(_prefs.cities, '{}'::text[])) = 0 OR (_candidate.city IS NOT NULL AND _candidate.city = ANY(_prefs.cities)))
    AND (cardinality(coalesce(_prefs.relocations, '{}'::text[])) = 0 OR (_candidate.relocation IS NOT NULL AND _candidate.relocation = ANY(_prefs.relocations)))
  )
$$;
REVOKE EXECUTE ON FUNCTION private.profile_satisfies_preferences(public.partner_preferences, public.profiles) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.profile_satisfies_preferences(public.partner_preferences, public.profiles) TO service_role;

-- Only derived booleans and broad activity buckets leave the database. No raw
-- preferences, employer shield, or exact last-active timestamp is returned.
CREATE OR REPLACE FUNCTION public.directory_match_signals(_candidate_ids uuid[])
RETURNS TABLE (
  candidate_id uuid,
  matches_your_preferences boolean,
  matches_their_preferences boolean,
  mutual_match boolean,
  activity_bucket text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  _uid uuid := auth.uid();
  _mine public.partner_preferences;
  _viewer public.profiles;
BEGIN
  IF _uid IS NULL OR NOT private.is_verified(_uid) THEN
    RAISE EXCEPTION 'Verified membership required' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(_candidate_ids), 0) > 100 THEN
    RAISE EXCEPTION 'At most 100 candidates per request' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO _viewer FROM public.profiles p WHERE p.id = _uid;
  SELECT pp.* INTO _mine FROM public.partner_preferences pp WHERE pp.user_id = _uid;

  RETURN QUERY
  SELECT c.id,
    private.preferences_have_criteria(_mine)
      AND private.profile_satisfies_preferences(_mine, c),
    cp.user_id IS NOT NULL
      AND private.preferences_have_criteria(cp)
      AND private.profile_satisfies_preferences(cp, _viewer),
    private.preferences_have_criteria(_mine)
      AND cp.user_id IS NOT NULL
      AND private.preferences_have_criteria(cp)
      AND private.profile_satisfies_preferences(_mine, c)
      AND private.profile_satisfies_preferences(cp, _viewer),
    CASE WHEN coalesce(ma.enabled, false) AND ma.last_active_at >= now() - interval '24 hours'
      THEN 'recently'
      WHEN coalesce(ma.enabled, false) AND ma.last_active_at >= now() - interval '7 days'
      THEN 'this_week'
      ELSE NULL END
  FROM public.profiles c
  LEFT JOIN public.partner_preferences cp ON cp.user_id = c.id
  LEFT JOIN public.member_activity ma ON ma.user_id = c.id
  WHERE c.id = ANY(coalesce(_candidate_ids, '{}'::uuid[]))
    AND c.id <> _uid
    AND c.is_visible AND c.onboarded AND c.verification_status = 'verified'
    AND (c.paused_until IS NULL OR c.paused_until <= now())
    AND NOT private.same_shielded_employer(c.employer, _uid)
    AND NOT EXISTS (
      SELECT 1 FROM public.profile_dismissals d
      WHERE d.dismisser_id = _uid AND d.dismissed_id = c.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.interests i
      WHERE i.status = 'blocked'
        AND ((i.sender_id = _uid AND i.recipient_id = c.id)
          OR (i.sender_id = c.id AND i.recipient_id = _uid))
    );
END; $$;
REVOKE EXECUTE ON FUNCTION public.directory_match_signals(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.directory_match_signals(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_member_activity_tracking(_enabled boolean, _policy_version text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sign in to change activity visibility' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.consent_events (user_id, purpose, granted, policy_version, note)
    VALUES (_uid, 'activity_tracking', _enabled, _policy_version,
      CASE WHEN _enabled THEN 'Coarse activity display enabled' ELSE 'Coarse activity display disabled' END);
  INSERT INTO public.member_activity (user_id, enabled, last_active_at, updated_at)
    VALUES (_uid, _enabled, NULL, now())
    ON CONFLICT (user_id) DO UPDATE
      SET enabled = EXCLUDED.enabled,
          last_active_at = CASE WHEN EXCLUDED.enabled THEN public.member_activity.last_active_at ELSE NULL END,
          updated_at = now();
END; $$;
REVOKE EXECUTE ON FUNCTION public.set_member_activity_tracking(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_activity_tracking(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_member_activity()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  UPDATE public.member_activity
     SET last_active_at = now(), updated_at = now()
   WHERE user_id = _uid AND enabled
     AND (last_active_at IS NULL OR last_active_at < now() - interval '15 minutes');
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_member_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_member_activity() TO authenticated;

-- A viewed member may see visitors only after opting in. A visitor may see only
-- their own visit history. Desk audit access remains intact.
DROP POLICY IF EXISTS "Viewed member reads their visitors" ON public.profile_views;
CREATE POLICY "Viewed member reads opted-in visitors" ON public.profile_views FOR SELECT TO authenticated
  USING (
    auth.uid() = viewer_id
    OR private.is_admin()
    OR (auth.uid() = viewed_id AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.show_profile_views
    ))
  );

CREATE OR REPLACE FUNCTION public.discover_members(
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
  created_at timestamptz, total_count bigint, matches_your_preferences boolean,
  matches_their_preferences boolean, mutual_match boolean, activity_bucket text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, private AS $$
DECLARE _uid uuid := auth.uid();
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
      coalesce(ma.enabled, false) AND ma.last_active_at >= now() - interval '7 days' AS active_this_week
    FROM public.profiles c CROSS JOIN viewer
    LEFT JOIN mine ON true
    LEFT JOIN public.partner_preferences cp ON cp.user_id = c.id
    LEFT JOIN public.member_activity ma ON ma.user_id = c.id
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
    SELECT c.*, s.you_fit, s.they_fit, s.active_recently, s.active_this_week
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
    CASE WHEN _sort = 'youngest' THEN f.birth_year END DESC NULLS LAST,
    CASE WHEN _sort = 'active' THEN f.active_recently::int END DESC NULLS LAST,
    CASE WHEN _sort = 'active' THEN f.active_this_week::int END DESC NULLS LAST,
    CASE WHEN _sort IN ('joined', 'youngest', 'active') THEN f.created_at END DESC,
    f.id
  OFFSET _page * _page_size LIMIT _page_size;
END; $$;
REVOKE EXECUTE ON FUNCTION public.discover_members(text,int,int,text,text,boolean,text,text,text,text,text,text,text,text,text,int,int,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discover_members(text,int,int,text,text,boolean,text,text,text,text,text,text,text,text,text,int,int,int,text) TO authenticated, service_role;

-- Regression assertions for the privacy boundaries and public RPC signatures.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profile_views'
      AND policyname = 'Viewed member reads opted-in visitors'
      AND qual LIKE '%show_profile_views%'
  ) THEN RAISE EXCEPTION 'REGRESSION: visitor opt-in is not enforced by RLS'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_preferences'
      AND policyname = 'Own preferences read' AND qual LIKE '%auth.uid()%'
  ) THEN RAISE EXCEPTION 'REGRESSION: raw partner preferences are not owner-only'; END IF;
  IF to_regprocedure('public.directory_match_signals(uuid[])') IS NULL
    OR to_regprocedure('public.get_profile_partner_preferences(uuid)') IS NULL
    OR to_regprocedure('public.discover_members(text,int,int,text,text,boolean,text,text,text,text,text,text,text,text,text,int,int,int,text)') IS NULL
    OR to_regprocedure('public.set_member_activity_tracking(boolean,text)') IS NULL
    OR to_regprocedure('public.record_member_activity()') IS NULL
  THEN RAISE EXCEPTION 'REGRESSION: Phase B discovery RPC missing'; END IF;
END $$;
