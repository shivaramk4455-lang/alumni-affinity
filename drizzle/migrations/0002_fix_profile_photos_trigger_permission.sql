CREATE OR REPLACE FUNCTION public.sync_primary_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _promoted text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_primary THEN
      SELECT path INTO _promoted FROM public.profile_photos
      WHERE user_id = OLD.user_id AND id <> OLD.id
      ORDER BY position, created_at LIMIT 1;
      IF _promoted IS NOT NULL THEN
        UPDATE public.profile_photos SET is_primary = true
        WHERE user_id = OLD.user_id AND path = _promoted;
      END IF;
      UPDATE public.profiles SET photo_path = _promoted, updated_at = now() WHERE id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.is_primary THEN
    UPDATE public.profile_photos SET is_primary = false
    WHERE user_id = NEW.user_id AND id <> NEW.id AND is_primary;
    UPDATE public.profiles SET photo_path = NEW.path, updated_at = now() WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $$;
GRANT EXECUTE ON FUNCTION public.sync_primary_photo() TO authenticated, service_role;