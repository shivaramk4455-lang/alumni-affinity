-- ===========================================================================
-- 20261103: Server-side Moon sign (Rashi) and Manglik search filters.
--
-- discover_members gains two optional filters so members can narrow the
-- directory the way matrimony sites do — by Rashi and by Manglik — server-side,
-- inside the same SECURITY DEFINER function that already enforces verified
-- visibility, dismissal and blocking rules. The new filters therefore inherit
-- every existing privacy guarantee instead of pushing horoscope columns into a
-- client-side query path.
--
-- The function's signature changes (two new params), and CREATE OR REPLACE on a
-- changed signature creates an overload rather than replacing the old one,
-- which would make parameterless-arg resolution ambiguous. Drop the exact old
-- signature first.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.discover_members(
  text,int,int,text,text,boolean,text,text,text,text,text,text,text,text,text,int,int,int,text
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

