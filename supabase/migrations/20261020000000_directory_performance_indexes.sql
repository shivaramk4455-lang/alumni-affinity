-- ===========================================================================
-- 20261020: Performance indexing for professional matrimony directory search.
--
-- Directory searches query public.profiles with:
--   WHERE onboarded = true AND is_visible = true AND verification_status = 'verified'
-- and filter by gender, birth_year, institution, city, updated_at.
--
-- A partial composite index covers all active verified profiles so search queries
-- run in sub-millisecond B-Tree index scans without reading unverified/ghost rows.
-- ===========================================================================

-- 1. Primary partial index for the verified members directory
CREATE INDEX IF NOT EXISTS idx_profiles_directory_search
  ON public.profiles (gender, birth_year, updated_at DESC)
  WHERE onboarded = true AND is_visible = true AND verification_status = 'verified';

-- 2. Institutional and geographic search indexes
CREATE INDEX IF NOT EXISTS idx_profiles_institution
  ON public.profiles (institution)
  WHERE onboarded = true AND is_visible = true AND verification_status = 'verified';

CREATE INDEX IF NOT EXISTS idx_profiles_city
  ON public.profiles (city)
  WHERE onboarded = true AND is_visible = true AND verification_status = 'verified';

-- 3. Shortlist lookup optimization
CREATE INDEX IF NOT EXISTS idx_saved_profiles_lookup
  ON public.saved_profiles (user_id, profile_id);
