-- ===========================================================================
-- 20261025: Fix profile photo synchronization trigger permissions and behavior
--
-- Migration 20261013000000 revoked EXECUTE on sync_primary_photo() from authenticated:
--   REVOKE EXECUTE ON FUNCTION public.sync_primary_photo() FROM PUBLIC, anon, authenticated;
--
-- Because the trigger profile_photos_sync_primary is an AFTER INSERT/UPDATE/DELETE trigger,
-- regular authenticated users executing INSERT/UPDATE/DELETE on profile_photos failed with:
--   "42501: permission denied for function sync_primary_photo".
--
-- This migration grants EXECUTE on public.sync_primary_photo() to authenticated and service_role,
-- and updates the function to handle primary conflicts cleanly without violating
-- idx_profile_photos_one_primary.
-- ===========================================================================

-- 1. Grant execute privileges so authenticated members can insert/update/delete their gallery photos
GRANT EXECUTE ON FUNCTION public.sync_primary_photo() TO authenticated, service_role;

-- 2. Re-create function with SECURITY DEFINER and robust sync handling
CREATE OR REPLACE FUNCTION public.sync_primary_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _promoted text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_primary THEN
      SELECT path INTO _promoted
      FROM public.profile_photos
      WHERE user_id = OLD.user_id AND id <> OLD.id
      ORDER BY position, created_at
      LIMIT 1;

      IF _promoted IS NOT NULL THEN
        UPDATE public.profile_photos
        SET is_primary = true
        WHERE user_id = OLD.user_id AND path = _promoted;
      END IF;

      UPDATE public.profiles
      SET photo_path = _promoted, updated_at = now()
      WHERE id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;

  -- INSERT / UPDATE: a primary row mirrors its path onto the profile
  IF NEW.is_primary THEN
    -- Demote any other rows marked primary for this member
    UPDATE public.profile_photos
    SET is_primary = false
    WHERE user_id = NEW.user_id AND id <> NEW.id AND is_primary;

    -- Update profile photo_path
    UPDATE public.profiles
    SET photo_path = NEW.path, updated_at = now()
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END; $$;

-- 3. Ensure permissions remain granted
GRANT EXECUTE ON FUNCTION public.sync_primary_photo() TO authenticated, service_role;
