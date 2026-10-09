-- ===========================================================================
-- 20261026: Repair photo_view_requests chain (follow-up to 20261017).
--
-- 20261017 shipped with two syntax breaks: the "Owner decides incoming
-- photo requests" WITH CHECK was never closed (the next CREATE FUNCTION
-- started inside the policy body), and the file ended with a stray `);`.
-- A fresh `supabase db reset` cannot apply that chain, which blocks every
-- later migration and every security fix behind it.
--
-- This migration is additive and idempotent: every statement re-asserts the
-- intended end state, so it heals databases where 20261017 partially applied
-- AND is a no-op on fresh databases where the corrected 20261017 already
-- applied. No rows are touched; existing requests keep their status.
--
-- It also closes the hole the 20261017 comment claimed was closed: "an
-- UPDATE cannot re-point a request at another pair". WITH CHECK cannot
-- compare OLD vs NEW, so the comment was aspirational — the trigger below
-- makes it real. Service role (NULL uid) stays exempt for desk tooling.
-- ===========================================================================

-- 1. Pair freeze: requester_id / owner_id are immutable once written.
CREATE OR REPLACE FUNCTION public.guard_photo_request_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.requester_id IS DISTINCT FROM OLD.requester_id
          OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
    RAISE EXCEPTION 'A photograph request cannot be re-pointed at another pair'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS photo_view_requests_freeze_pair ON public.photo_view_requests;
CREATE TRIGGER photo_view_requests_freeze_pair
  BEFORE UPDATE ON public.photo_view_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_photo_request_pair();

-- 2. Re-assert the four row policies in their intended (syntactically
-- complete) form. Each DROP is paired with the CREATE that supersedes it,
-- so a partial apply cannot widen access.
DROP POLICY IF EXISTS "Requester creates own photo request" ON public.photo_view_requests;
CREATE POLICY "Requester creates own photo request" ON public.photo_view_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND status = 'pending'
    AND private.is_verified(auth.uid())
  );

DROP POLICY IF EXISTS "Requester reads own photo requests" ON public.photo_view_requests;
CREATE POLICY "Requester reads own photo requests" ON public.photo_view_requests
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid());

DROP POLICY IF EXISTS "Owner reads incoming photo requests" ON public.photo_view_requests;
CREATE POLICY "Owner reads incoming photo requests" ON public.photo_view_requests
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owner decides incoming photo requests" ON public.photo_view_requests;
CREATE POLICY "Owner decides incoming photo requests" ON public.photo_view_requests
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND status IN ('accepted', 'declined', 'revoked')
  );

-- 3. Re-assert the access helper (idempotent OR REPLACE).
CREATE OR REPLACE FUNCTION private.has_photo_access(_owner uuid, _viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.photo_view_requests r
    WHERE r.owner_id = _owner
      AND r.requester_id = _viewer
      AND r.status = 'accepted'
  );
$$;

REVOKE EXECUTE ON FUNCTION private.has_photo_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_photo_access(uuid, uuid) TO authenticated, service_role;

-- 4. Re-assert the two extended read policies (storage object + gallery
-- row must agree, else the gallery lists rows the viewer cannot fetch).
DROP POLICY IF EXISTS "Photo read by permitted members" ON storage.objects;
CREATE POLICY "Photo read by permitted members" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-photos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id::text = (storage.foldername(name))[1]
          AND p.onboarded AND p.is_visible
          AND (
            p.photo_visibility = 'all_members'
            OR private.has_accepted_interest(p.id, auth.uid())
            OR (
              p.photo_visibility = 'accepted_only'
              AND private.has_photo_access(p.id, auth.uid())
            )
            -- 'hidden' is intentionally absent: never requestable, never served.
          )
      )
    )
  );

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
          AND (
            p.photo_visibility = 'all_members'
            OR private.has_accepted_interest(p.id, auth.uid())
            OR (
              p.photo_visibility = 'accepted_only'
              AND private.has_photo_access(p.id, auth.uid())
            )
          )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Regression assertions. Fail at migrate time, not in production.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'photo_view_requests_freeze_pair'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: photo_view_requests pair-freeze trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'photo_view_requests'
      AND policyname = 'Owner decides incoming photo requests'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: Owner-decides policy on photo_view_requests is missing';
  END IF;
END $$;
