-- ===========================================================================
-- 20261002: Partner preferences + compatibility scoring inputs.
--
-- Candidates state what they are looking for; the app never stores what they
-- are looking *at*. One row per member (PK = user_id), owner-only reads and
-- writes — a member's criteria are as private as their contact coordinates.
-- Compatibility is computed client-side from directory-visible fields, so no
-- server-side score (and no score table to leak) is needed.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.partner_preferences (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  min_age int CHECK (min_age IS NULL OR (min_age BETWEEN 21 AND 80)),
  max_age int CHECK (max_age IS NULL OR (max_age BETWEEN 21 AND 80)),
  genders text[] NOT NULL DEFAULT '{}',
  institutions text[] NOT NULL DEFAULT '{}',
  cities text[] NOT NULL DEFAULT '{}',
  relocations text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_preferences_age_order CHECK (
    min_age IS NULL OR max_age IS NULL OR min_age <= max_age
  ),
  -- Keep preference lists bounded so a row can never turn into bulk data.
  CONSTRAINT partner_preferences_list_sizes CHECK (
    coalesce(array_length(genders, 1), 0) <= 5
    AND coalesce(array_length(institutions, 1), 0) <= 20
    AND coalesce(array_length(cities, 1), 0) <= 20
    AND coalesce(array_length(relocations, 1), 0) <= 5
  )
);

GRANT SELECT, INSERT, UPDATE ON public.partner_preferences TO authenticated;
GRANT ALL ON public.partner_preferences TO service_role;
ALTER TABLE public.partner_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own preferences read" ON public.partner_preferences;
CREATE POLICY "Own preferences read" ON public.partner_preferences FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own preferences write" ON public.partner_preferences;
CREATE POLICY "Own preferences write" ON public.partner_preferences FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own preferences update" ON public.partner_preferences;
CREATE POLICY "Own preferences update" ON public.partner_preferences FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS partner_preferences_touch ON public.partner_preferences;
CREATE TRIGGER partner_preferences_touch BEFORE UPDATE ON public.partner_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();