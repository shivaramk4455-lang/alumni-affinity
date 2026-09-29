-- ===========================================================================
-- 20261015: Scope entitlement() and placement_weight() to self or the desk.
--
-- Both functions are SECURITY DEFINER and were granted to `authenticated`
-- with no caller check, so any signed-in member could call
--   select * from entitlement('<another member''s uuid>')
-- and read that member's plan code, monthly allowance and usage — a
-- subscription-privacy leak, and a way to enumerate who pays for what.
-- Neither function needs cross-member reads: the browser never calls them
-- (it reads its own subscriptions row under RLS and the public plan
-- catalogue), and the internal callers are the allowance trigger, which
-- passes the sender's own id, and can_send_introduction, which defaults to
-- auth.uid().
--
-- The guard follows the same idiom as response_rate/reciprocity_multiplier:
-- allow self, allow the desk (private.is_admin()), and allow a NULL caller
-- (service role / background job — no browser session involved, exactly as
-- enforce_intro_allowance already treats a NULL uid).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.entitlement(_user uuid)
RETURNS TABLE (
  plan_code text,
  placement_weight integer,
  intro_requests integer,
  requests_used integer,
  requests_remaining integer,
  active boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only the member themselves, or the desk, may read an entitlement.
  IF auth.uid() IS NOT NULL
     AND _user IS NOT NULL
     AND _user IS DISTINCT FROM auth.uid()
     AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Entitlement is personal to the member or available to the desk'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
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
      -- Only a genuinely unlimited plan reports NULL; a free member reports 0.
      WHEN live.allowance IS NULL AND live.id IS NOT NULL THEN NULL
      ELSE greatest(0, coalesce(live.allowance, 0) - coalesce(live.requests_used, 0))
    END,
    live.id IS NOT NULL
  FROM (SELECT 1) AS _
  LEFT JOIN live ON true;
END; $$;

REVOKE EXECUTE ON FUNCTION public.entitlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entitlement(uuid) TO authenticated, service_role;

-- Directory ranking weight: same personal-data boundary, own error message.
CREATE OR REPLACE FUNCTION public.placement_weight(_user uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND _user IS NOT NULL
     AND _user IS DISTINCT FROM auth.uid()
     AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Placement weight is personal to the member or available to the desk'
      USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((SELECT e.placement_weight FROM public.entitlement(_user) e), 0);
END; $$;

REVOKE EXECUTE ON FUNCTION public.placement_weight(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.placement_weight(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Regression assertions. Both guards must remain in the shipped bodies; a
-- future rewrite that drops them fails at migrate time.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _entitlement text;
  _weight text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _entitlement
  FROM pg_proc WHERE proname = 'entitlement' AND pronamespace = 'public'::regnamespace;

  IF _entitlement IS NULL OR _entitlement NOT LIKE '%private.is_admin()%' THEN
    RAISE EXCEPTION 'REGRESSION: entitlement() lost its self-or-desk guard';
  END IF;
  IF _entitlement NOT LIKE '%42501%' THEN
    RAISE EXCEPTION 'REGRESSION: entitlement() must refuse cross-member reads';
  END IF;

  SELECT pg_get_functiondef(oid) INTO _weight
  FROM pg_proc WHERE proname = 'placement_weight' AND pronamespace = 'public'::regnamespace;

  IF _weight IS NULL OR _weight NOT LIKE '%private.is_admin()%' THEN
    RAISE EXCEPTION 'REGRESSION: placement_weight() lost its self-or-desk guard';
  END IF;
END $$;

-- Neither function may be reachable without a signed-in session.
DO $$
DECLARE
  _open text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO _open
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('entitlement', 'placement_weight')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF _open IS NOT NULL THEN
    RAISE EXCEPTION 'REGRESSION: anon may execute %', _open;
  END IF;
END $$;