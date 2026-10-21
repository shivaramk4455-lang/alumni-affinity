-- ===========================================================================
-- 20261107: Private helper scoping and column-scoped plan reads.
--
-- 1. [HIGH] The private.* helpers were a relationship oracle.
-- 2. [MEDIUM] subscription_plans exposed the provider plan id to anon.
-- 3. [LOW] public.my_profile did not expose the adult attestation timestamp.
-- 4. Fail-loud regression assertions.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. [HIGH] The private.* helpers were a relationship oracle.
-- ---------------------------------------------------------------------------
-- These functions are SECURITY DEFINER and are granted EXECUTE to
-- `authenticated`, because RLS policy expressions are evaluated as the
-- querying user and need EXECUTE on the functions they call.
--
-- That made them directly callable with ARBITRARY arguments:
--
--   select private.has_accepted_interest('<a>', '<b>');
--   select private.has_verified('<c>');            -- (is_verified)
--   select private.has_photo_access('<owner>', '<viewer>');
--
-- so any signed-in member could read the relationship graph of the whole
-- member base: who is verified, who is mutually introduced (including
-- introductions the caller is not part of), and who holds photo consent.
-- In a matrimonial product that is exactly the information the product
-- promises not to expose — "zero public directory".
--
-- The fix is a SCOPE guard, not a privilege change: revoking EXECUTE would
-- break every policy that calls them. Each helper now answers only when the
-- caller is a party to the question:
--
--   * `auth.uid() IS NULL`  -> a service-role / cron caller, which is
--     trusted and keeps its previous behaviour exactly.
--   * otherwise              -> the caller must be one of the subjects, or
--     (for is_verified) the desk.
--
-- Every call site in the chain already passes the caller's own id:
-- policies use `private.is_verified(auth.uid())`,
-- `private.has_accepted_interest(p.id, auth.uid())`,
-- `private.has_photo_access(p.id, auth.uid())`,
-- `private.is_copilot_of(candidate_id, auth.uid())`,
-- `private.is_active_copilot(auth.uid())`; and the SECURITY DEFINER
-- functions pass their own `_uid := auth.uid()`. So the guard is invisible
-- to the application and closes the oracle.

CREATE OR REPLACE FUNCTION private.is_verified(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (auth.uid() IS NULL OR auth.uid() = _user OR private.is_admin())
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user AND p.verification_status = 'verified')
$$;

CREATE OR REPLACE FUNCTION private.is_copilot_of(_candidate uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (auth.uid() IS NULL OR coalesce(auth.uid() IN (_candidate, _user), false))
    AND EXISTS (
      SELECT 1 FROM public.copilots c
      WHERE c.candidate_id = _candidate AND c.copilot_user_id = _user AND c.status = 'active'
    )
$$;

CREATE OR REPLACE FUNCTION private.has_accepted_interest(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (auth.uid() IS NULL OR coalesce(auth.uid() IN (_a, _b), false))
    AND EXISTS (
      SELECT 1 FROM public.interests i
      WHERE i.status = 'accepted'
        AND ((i.sender_id = _a AND i.recipient_id = _b) OR (i.sender_id = _b AND i.recipient_id = _a))
    )
$$;

CREATE OR REPLACE FUNCTION private.has_photo_access(_owner uuid, _viewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (auth.uid() IS NULL OR coalesce(auth.uid() IN (_owner, _viewer), false))
    AND EXISTS (
      SELECT 1 FROM public.photo_view_requests r
      WHERE r.owner_id = _owner
        AND r.requester_id = _viewer
        AND r.status = 'accepted'
    )
$$;

CREATE OR REPLACE FUNCTION private.is_active_copilot(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (auth.uid() IS NULL OR auth.uid() = _user)
    AND EXISTS (
      SELECT 1 FROM public.copilots c
      JOIN public.profiles cand ON cand.id = c.candidate_id
      WHERE c.copilot_user_id = _user AND c.status = 'active' AND cand.verification_status = 'verified'
    )
$$;

-- The EXECUTE grants are unchanged: the policies still need them. What
-- changed is that the answer is scoped to the caller.
REVOKE EXECUTE ON FUNCTION private.is_verified(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_verified(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.is_copilot_of(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_copilot_of(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.has_accepted_interest(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_accepted_interest(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.has_photo_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_photo_access(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.is_active_copilot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_active_copilot(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. [MEDIUM] subscription_plans exposed the provider plan id to anon.
-- ---------------------------------------------------------------------------
-- `GRANT SELECT ON public.subscription_plans TO anon, authenticated` is
-- table-scoped, so it covered razorpay_plan_id — our provider's plan
-- identifiers — and the plan list was readable by an anonymous caller.
--
-- The column grant below lists every column the app actually reads
-- (src/lib/subscription.ts selects exactly these) and omits
-- razorpay_plan_id. The service role keeps GRANT ALL, so the checkout
-- function can still read and write it.
REVOKE SELECT ON public.subscription_plans FROM anon, authenticated;
GRANT SELECT (
  code,
  label,
  amount_paise,
  currency,
  intro_requests,
  placement_weight,
  active,
  display_order,
  sellable,
  service_note
) ON public.subscription_plans TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. [LOW] public.my_profile did not expose the adult attestation timestamp.
-- ---------------------------------------------------------------------------
-- public.profiles.adult_attested_at (20261014000000) records when a member
-- attested that they are 21 or older. It was on the table but not on the
-- member's own view, so the member could not see their own attestation.
--
-- DROP-then-CREATE, the pattern every other my_profile rewrite in this chain
-- uses: CREATE OR REPLACE VIEW cannot reorder or drop columns (42P16).
-- Nothing in the schema depends on this view, so the drop is safe.
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
    p.religion, p.caste, p.gotra,
    p.birth_time, p.birth_place, p.rashi, p.nakshatra, p.nakshatra_pada, p.manglik,
    p.paused_until, p.paused_reason,
    p.show_profile_views,
    p.created_by,
    p.adult_attested_at
  FROM public.profiles p
  WHERE p.id = auth.uid();

REVOKE ALL ON public.my_profile FROM PUBLIC, anon;
GRANT SELECT ON public.my_profile TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Fail-loud regression assertions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _fn text;
  _body text;
BEGIN
  -- 1. the helpers must carry a caller-scope guard.
  FOR _fn IN
    SELECT p.proname
      FROM pg_proc p
     WHERE p.pronamespace = 'private'::regnamespace
       AND p.proname IN (
         'is_verified',
         'is_copilot_of',
         'has_accepted_interest',
         'has_photo_access',
         'is_active_copilot'
       )
  LOOP
    SELECT pg_get_functiondef(oid) INTO _body
      FROM pg_proc
     WHERE pronamespace = 'private'::regnamespace
       AND proname = _fn;

    IF _body IS NULL OR _body NOT ILIKE '%auth.uid()%' THEN
      RAISE EXCEPTION 'REGRESSION: private.% is missing its caller-scope guard', _fn;
    END IF;
  END LOOP;

  -- 2. the provider plan id must not be readable by anon or a member.
  IF EXISTS (
    SELECT 1
      FROM information_schema.column_privileges cp
     WHERE cp.grantee IN ('anon', 'authenticated')
       AND cp.table_schema = 'public'
       AND cp.table_name = 'subscription_plans'
       AND cp.column_name = 'razorpay_plan_id'
       AND cp.privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: public.subscription_plans.razorpay_plan_id is readable by anon or authenticated';
  END IF;

  IF has_table_privilege('anon', 'public.subscription_plans', 'SELECT') THEN
    RAISE EXCEPTION 'REGRESSION: public.subscription_plans still has a table-level SELECT grant for anon';
  END IF;

  -- 3. the member's own attestation must be readable.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'my_profile' AND column_name = 'adult_attested_at'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: public.my_profile does not expose adult_attested_at';
  END IF;
END $$;
