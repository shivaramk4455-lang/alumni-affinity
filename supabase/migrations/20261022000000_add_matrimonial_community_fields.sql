-- ===========================================================================
-- 20261022: Add matrimonial community fields: religion, caste, gotra.
--
-- Supports standard Indian matrimonial background preferences (Religion,
-- Caste/Community, Gotra) across directory search and member profiles.
-- All columns are nullable/optional to accommodate all communities.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS religion text,
  ADD COLUMN IF NOT EXISTS caste text,
  ADD COLUMN IF NOT EXISTS gotra text;

GRANT SELECT (religion, caste, gotra) ON public.profiles TO authenticated;
GRANT UPDATE (religion, caste, gotra) ON public.profiles TO authenticated;

-- Refresh public.my_profile view with the new columns
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
    p.show_profile_views
  FROM public.profiles p
  WHERE p.id = auth.uid();

REVOKE ALL ON public.my_profile FROM PUBLIC, anon;
GRANT SELECT ON public.my_profile TO authenticated, service_role;
