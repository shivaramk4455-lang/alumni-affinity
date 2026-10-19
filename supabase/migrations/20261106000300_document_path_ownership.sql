-- ===========================================================================
-- 20261106 (4/4): A storage pointer must point at the member's OWN folder.
--
-- TWO FINDINGS, one root cause.
--
-- 1. `profiles.photo_path` was directly readable by every verified member (it is
--    part of the directory projection) AND freely writable by its owner
--    (20260928000100:31 grants UPDATE on it). Nothing checked that the path
--    pointed inside the owner's folder. The storage policies DO enforce
--    `<auth.uid()>/...` — but for writes, which means the object lives in the
--    victim's folder and the attacker's profile simply references it.
--
--    So any verified member could read a visible member's path from the
--    directory, set it as their own portrait, and appear in search, messaging
--    and the navbar as that person. Members who chose `accepted_only` or
--    `hidden` were not exposed this way (the read policy keys on the *owner's*
--    flags, so the object resolves as the victim's), which bounds the damage to
--    likeness hijack with photographs the victim had already opened to verified
--    members — bad enough.
--
-- 2. `profiles.verification_doc_path` was the same shape with a worse edge. The
--    desk signs and opens whatever string is in that column
--    (admin.tsx:706-711), so a member could point it at another member's
--    `verification-docs` object and have the desk adjudicate someone else's
--    identity document under their name. And the 90-day retention job
--    (20261011000000:450-462) DELETES by that same string, so the crafted path
--    turned a retention sweep into a cross-member destructive write.
--
-- THE FIX is one invariant, enforced where it cannot be bypassed: a trigger on
-- the pointer columns themselves. A client fix would be a suggestion; the
-- database is what the storage policy already trusts, so the pointer is now
-- held to the same rule.
--
-- SAFE DEFAULT (flagged): rows that ALREADY point outside their owner's folder
-- cannot be attributed safely — either the owner is impersonating someone, or
-- the row is stale — so they are cleared rather than re-pointed. The counts are
-- raised as a NOTICE in the deploy log. Pre-launch this is expected to touch
-- nothing; on a populated database it is the only way to remove a live hijack.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles.photo_path / profiles.verification_doc_path
--    Scoped with `UPDATE OF` so a profile save that touches no path pays
--    nothing for this check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_document_paths()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Storage objects are keyed "<auth uid>/<file>", and every bucket policy
  -- enforces that prefix on write. The pointer columns were the hole: the row
  -- could name an object in someone else's folder.
  IF NEW.photo_path IS NOT NULL
     AND split_part(NEW.photo_path, '/', 1) IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'A profile photograph must live in your own storage folder'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.verification_doc_path IS NOT NULL
     AND split_part(NEW.verification_doc_path, '/', 1) IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'A verification document must live in your own storage folder'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_guard_document_paths ON public.profiles;
CREATE TRIGGER profiles_guard_document_paths
  BEFORE INSERT OR UPDATE OF photo_path, verification_doc_path ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_paths();

-- ---------------------------------------------------------------------------
-- 2. profile_photos.path — the gallery rows. `sync_primary_photo` mirrors one of
--    these onto profiles.photo_path, so guarding only the profile would leave
--    the same hijack reachable one table over.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_photo_row_path()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.path IS NULL
     OR split_part(NEW.path, '/', 1) IS DISTINCT FROM NEW.user_id::text THEN
    RAISE EXCEPTION 'A gallery photograph must live in your own storage folder'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profile_photos_guard_path ON public.profile_photos;
CREATE TRIGGER profile_photos_guard_path
  BEFORE INSERT OR UPDATE OF path ON public.profile_photos
  FOR EACH ROW EXECUTE FUNCTION public.guard_photo_row_path();

-- ---------------------------------------------------------------------------
-- 3. Repair. Anything that already points outside its owner's folder is a live
--    hijack or a stale row; neither is safe to keep, and neither can be
--    attributed to a legitimate object, so the pointer is cleared.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _bad_photo int := 0;
  _bad_doc int := 0;
  _bad_gallery int := 0;
BEGIN
  UPDATE public.profiles p
  SET photo_path = NULL,
      updated_at = now()
  WHERE p.photo_path IS NOT NULL
    AND split_part(p.photo_path, '/', 1) IS DISTINCT FROM p.id::text;
  GET DIAGNOSTICS _bad_photo = ROW_COUNT;

  UPDATE public.profiles p
  SET verification_doc_path = NULL,
      updated_at = now()
  WHERE p.verification_doc_path IS NOT NULL
    AND split_part(p.verification_doc_path, '/', 1) IS DISTINCT FROM p.id::text;
  GET DIAGNOSTICS _bad_doc = ROW_COUNT;

  DELETE FROM public.profile_photos ph
  WHERE split_part(ph.path, '/', 1) IS DISTINCT FROM ph.user_id::text;
  GET DIAGNOSTICS _bad_gallery = ROW_COUNT;

  RAISE NOTICE
    'document path repair: cleared % profile photo(s), % verification doc(s) and % gallery row(s) that pointed outside their owner''s folder',
    _bad_photo, _bad_doc, _bad_gallery;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Fail-loud assertions. Structural rather than behavioural: a migration
--    cannot fabricate a member (profiles -> auth.users) to write a hostile path
--    against, and doing so inside the deploy transaction would be worse than the
--    risk it removes. Each clause is an invariant a future rewrite must keep.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _guard text;
  _gallery_guard text;
  _offenders int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'profiles_guard_document_paths' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'REGRESSION: profiles has no document-path guard, so photo_path and verification_doc_path can point at another member''s storage objects';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'profile_photos_guard_path' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'REGRESSION: profile_photos has no path guard, so a gallery row can reference another member''s object';
  END IF;

  SELECT pg_get_functiondef(oid) INTO _guard
  FROM pg_proc WHERE proname = 'guard_document_paths' AND pronamespace = 'public'::regnamespace;

  IF _guard IS NULL OR _guard NOT LIKE '%photo_path%' OR _guard NOT LIKE '%verification_doc_path%' THEN
    RAISE EXCEPTION 'REGRESSION: guard_document_paths must cover both pointer columns';
  END IF;
  -- Both guards must compare against the row's own owner, not a parameter.
  IF _guard NOT LIKE '%42501%' THEN
    RAISE EXCEPTION 'REGRESSION: the path guard must refuse, not silently rewrite';
  END IF;

  SELECT pg_get_functiondef(oid) INTO _gallery_guard
  FROM pg_proc WHERE proname = 'guard_photo_row_path' AND pronamespace = 'public'::regnamespace;

  IF _gallery_guard IS NULL OR _gallery_guard NOT LIKE '%user_id%' THEN
    RAISE EXCEPTION 'REGRESSION: guard_photo_row_path must compare the path against the row user_id';
  END IF;

  -- The repair must have left nothing behind.
  SELECT count(*) INTO _offenders
  FROM public.profiles p
  WHERE (p.photo_path IS NOT NULL AND split_part(p.photo_path, '/', 1) IS DISTINCT FROM p.id::text)
     OR (p.verification_doc_path IS NOT NULL
         AND split_part(p.verification_doc_path, '/', 1) IS DISTINCT FROM p.id::text);

  IF _offenders > 0 THEN
    RAISE EXCEPTION 'REGRESSION: % profile(s) still point outside their own storage folder', _offenders;
  END IF;
END $$;
