-- ===========================================================================
-- 20261031: "Profile created by" label.
--
-- A cosmetic label recording who filled in the profile (Self, Parent,
-- Sibling, Relative, Friend, Other). It does NOT change ownership: the
-- candidate still owns the account and every decision — this only captures
-- the traditional-matrimony "created by" data point without introducing
-- delegated control. Free text, nullable, defaults to NULL.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS created_by text;

-- profiles uses column-level grants; without these the onboarding UPDATE
-- would silently drop the new column (Postgres ignores non-granted columns
-- in a column-privilege UPDATE rather than erroring).
GRANT SELECT (created_by) ON public.profiles TO authenticated;
GRANT UPDATE (created_by) ON public.profiles TO authenticated;

-- Refresh the my_profile view so the label round-trips through onboarding.
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
    p.paused_until, p.paused_reason,
    p.show_profile_views,
    p.created_by
  FROM public.profiles p
  WHERE p.id = auth.uid();

REVOKE ALL ON public.my_profile FROM PUBLIC, anon;
GRANT SELECT ON public.my_profile TO authenticated, service_role;
