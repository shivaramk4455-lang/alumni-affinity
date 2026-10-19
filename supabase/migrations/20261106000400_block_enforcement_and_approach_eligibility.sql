-- ===========================================================================
-- 20261106000400: Block enforcement, approach eligibility, and storage caps.
--
-- 1. APPROACH-ELIGIBILITY & MUTUAL BLOCK ENFORCEMENT:
--    Previously, if User A blocked User B, the interests table recorded:
--    (sender_id=A, recipient_id=B, status='blocked') or vice-versa.
--    Because the unique index was direction-ordered (sender_id, recipient_id),
--    User B could still insert (sender_id=B, recipient_id=A), completely
--    bypassing the block and re-approaching the user who blocked them.
--
--    Now, a BEFORE INSERT trigger enforces that:
--    - No interest with status='blocked' exists between the pair in EITHER direction.
--    - No active introduction ('pending' or 'accepted') exists in the reverse direction.
--    - Once in 'blocked' state, an interest can NEVER be transitioned back.
--
-- 2. STORAGE OBJECT CAPS:
--    Prevents unbounded object creation in 'profile-photos' and 'verification-docs'
--    buckets. Caps each member folder to prevent storage exhaustion attacks.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Interests approach eligibility guard trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_interest_approach_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _blocked boolean;
  _active_reverse boolean;
BEGIN
  -- A blocked row is strictly terminal — no member and no trigger may resurrect it.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'blocked' AND NEW.status <> 'blocked' THEN
      RAISE EXCEPTION 'A blocked introduction cannot be reopened' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'INSERT'
  -- Check if either party has blocked the other
  SELECT EXISTS (
    SELECT 1 FROM public.interests
    WHERE status = 'blocked'
      AND (
        (sender_id = NEW.sender_id AND recipient_id = NEW.recipient_id)
        OR (sender_id = NEW.recipient_id AND recipient_id = NEW.sender_id)
      )
  ) INTO _blocked;

  IF _blocked THEN
    RAISE EXCEPTION 'Cannot approach a member with an active block' USING ERRCODE = '42501';
  END IF;

  -- Check if an active introduction already exists in the reverse direction
  SELECT EXISTS (
    SELECT 1 FROM public.interests
    WHERE status IN ('pending', 'accepted')
      AND sender_id = NEW.recipient_id
      AND recipient_id = NEW.sender_id
  ) INTO _active_reverse;

  IF _active_reverse THEN
    RAISE EXCEPTION 'An introduction already exists with this member in the reverse direction'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS interests_guard_approach_eligibility ON public.interests;
CREATE TRIGGER interests_guard_approach_eligibility
  BEFORE INSERT OR UPDATE OF status ON public.interests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_interest_approach_eligibility();

-- ---------------------------------------------------------------------------
-- 2. Storage object caps guard trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_storage_object_caps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count int;
  _owner_folder text;
BEGIN
  _owner_folder := split_part(NEW.name, '/', 1);

  IF NEW.bucket_id = 'profile-photos' THEN
    SELECT count(*) INTO _count
    FROM storage.objects
    WHERE bucket_id = 'profile-photos'
      AND split_part(name, '/', 1) = _owner_folder;

    IF _count >= 10 THEN
      RAISE EXCEPTION 'Profile photograph storage limit reached (max 10 objects)'
        USING ERRCODE = '54000';
    END IF;

  ELSIF NEW.bucket_id = 'verification-docs' THEN
    SELECT count(*) INTO _count
    FROM storage.objects
    WHERE bucket_id = 'verification-docs'
      AND split_part(name, '/', 1) = _owner_folder;

    IF _count >= 5 THEN
      RAISE EXCEPTION 'Verification document storage limit reached (max 5 objects)'
        USING ERRCODE = '54000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS storage_objects_guard_caps ON storage.objects;
CREATE TRIGGER storage_objects_guard_caps
  BEFORE INSERT ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_storage_object_caps();
