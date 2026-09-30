CREATE TABLE IF NOT EXISTS public.profile_photos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  path text NOT NULL,
  position int NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_photos_position_valid CHECK (position >= 0 AND position < 24),
  CONSTRAINT profile_photos_path_nonempty CHECK (char_length(path) BETWEEN 1 AND 1024)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_photos_owner_path ON public.profile_photos(user_id, path);
CREATE INDEX IF NOT EXISTS idx_profile_photos_owner ON public.profile_photos(user_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_photos_one_primary ON public.profile_photos(user_id) WHERE is_primary;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_photos TO authenticated;
GRANT ALL ON public.profile_photos TO service_role;
ALTER TABLE public.profile_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own gallery rows" ON public.profile_photos;
CREATE POLICY "Own gallery rows" ON public.profile_photos FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Permitted members read gallery" ON public.profile_photos;
CREATE POLICY "Permitted members read gallery" ON public.profile_photos FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      (private.is_verified(auth.uid()) OR private.is_active_copilot(auth.uid()))
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = profile_photos.user_id
          AND p.onboarded AND p.is_visible
          AND (p.photo_visibility = 'all_members' OR private.has_accepted_interest(p.id, auth.uid()))
      )
    )
  );
INSERT INTO public.profile_photos (user_id, path, position, is_primary)
SELECT p.id, p.photo_path, 0, true FROM public.profiles p WHERE p.photo_path IS NOT NULL
ON CONFLICT (user_id, path) DO NOTHING;
CREATE OR REPLACE FUNCTION public.sync_primary_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _promoted text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_primary THEN
      SELECT path INTO _promoted FROM public.profile_photos WHERE user_id = OLD.user_id ORDER BY position, created_at LIMIT 1;
      IF _promoted IS NOT NULL THEN
        UPDATE public.profile_photos SET is_primary = true WHERE user_id = OLD.user_id AND path = _promoted;
      END IF;
      UPDATE public.profiles SET photo_path = _promoted, updated_at = now() WHERE id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.is_primary THEN
    UPDATE public.profile_photos SET is_primary = false WHERE user_id = NEW.user_id AND id <> NEW.id AND is_primary;
    UPDATE public.profiles SET photo_path = NEW.path, updated_at = now() WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.sync_primary_photo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_primary_photo() TO service_role;
DROP TRIGGER IF EXISTS profile_photos_sync_primary ON public.profile_photos;
CREATE TRIGGER profile_photos_sync_primary AFTER INSERT OR UPDATE OR DELETE ON public.profile_photos
  FOR EACH ROW EXECUTE FUNCTION public.sync_primary_photo();