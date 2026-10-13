-- ===========================================================================
-- 20261102: Horoscope / Astrology (Jyotish) fields + Guna Milan matching.
--
-- Supports the standard Indian matrimonial horoscope data point: birth time
-- and place, Moon sign (Rashi), birth star (Nakshatra) with its quarter
-- (Pada / Charan), and Manglik (Mangal Dosha) status. Every column is
-- nullable/optional to accommodate members and communities that do not use
-- horoscope matching. Guna Milan (Ashtakoota) compatibility is derived
-- deterministically from Nakshatra + Pada in the client (see
-- src/lib/guna-milan.ts), so nothing further is stored for scoring.
--
-- These columns follow the same privacy posture as religion/caste/gotra:
-- readable and self-updatable by any authenticated (verified) member.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birth_time text,
  ADD COLUMN IF NOT EXISTS birth_place text,
  ADD COLUMN IF NOT EXISTS rashi text,
  ADD COLUMN IF NOT EXISTS nakshatra text,
  ADD COLUMN IF NOT EXISTS nakshatra_pada int,
  ADD COLUMN IF NOT EXISTS manglik text;

-- Pada (Charan) is always 1..4 when present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_nakshatra_pada_range'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_nakshatra_pada_range
      CHECK (nakshatra_pada IS NULL OR nakshatra_pada BETWEEN 1 AND 4);
  END IF;
END $$;

-- Column-level grants: profiles uses column privileges, so without these the
-- onboarding/settings UPDATE would silently drop the new columns (Postgres
-- ignores non-granted columns in a column-privilege UPDATE rather than
-- erroring), exactly as noted for created_by in 20261031.
GRANT SELECT (birth_time, birth_place, rashi, nakshatra, nakshatra_pada, manglik)
  ON public.profiles TO authenticated;
GRANT UPDATE (birth_time, birth_place, rashi, nakshatra, nakshatra_pada, manglik)
  ON public.profiles TO authenticated;

-- A single free-text Manglik preference for the "Looking for" panel.
ALTER TABLE public.partner_preferences
  ADD COLUMN IF NOT EXISTS manglik_preference text;

-- Refresh public.my_profile view with the new columns. This mirrors the full
-- column list carried through 20261031 so nothing is silently dropped.
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
    p.created_by
  FROM public.profiles p
  WHERE p.id = auth.uid();

REVOKE ALL ON public.my_profile FROM PUBLIC, anon;
GRANT SELECT ON public.my_profile TO authenticated, service_role;
