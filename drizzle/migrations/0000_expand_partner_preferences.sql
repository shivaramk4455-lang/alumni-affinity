ALTER TABLE public.partner_preferences
  ADD COLUMN IF NOT EXISTS min_height_cm int,
  ADD COLUMN IF NOT EXISTS max_height_cm int,
  ADD COLUMN IF NOT EXISTS marital_statuses text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS diets text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS religions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS caste_preference text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_preferences_height_order') THEN
    ALTER TABLE public.partner_preferences
      ADD CONSTRAINT partner_preferences_height_order CHECK (
        min_height_cm IS NULL OR max_height_cm IS NULL OR min_height_cm <= max_height_cm);
  END IF;
END $$;
DROP POLICY IF EXISTS "Own preferences read" ON public.partner_preferences;
DROP POLICY IF EXISTS "Partner preferences read" ON public.partner_preferences;
CREATE POLICY "Partner preferences read" ON public.partner_preferences
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.profiles p
      WHERE p.id = partner_preferences.user_id AND p.is_visible = true AND p.verification_status = 'verified'));
GRANT SELECT, INSERT, UPDATE ON public.partner_preferences TO authenticated;