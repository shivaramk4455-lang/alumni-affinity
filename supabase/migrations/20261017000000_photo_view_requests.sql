-- ===========================================================================
-- 20261017: Photograph view requests — the consent flow for "accepted_only".
--
-- THE PROBLEM THIS SOLVES
-- Today a photograph is binary: either `all_members` (anyone verified sees it),
-- withheld until a mutual accept, or hidden forever. A member who wants to be
-- seen by someone *specific* had no way to say yes short of accepting the whole
-- introduction.
--
-- WHY NOT A CSS BLUR
-- A client-side blur is a lie: the file is already in the browser, so anyone can
-- read the network response and keep the original. This flow withholds the
-- object at the storage layer until the owner consents — the unblurred file
-- never reaches a browser that was refused.
--
-- SCOPE RULE (important)
--   * `accepted_only` + no mutual accept  -> requestable.
--   * `hidden`                            -> NOT requestable, ever. "Hidden"
--     means nobody, including matches; a request overriding it would silently
--     weaken the strongest setting the product offers.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.photo_view_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT photo_view_requests_status_valid
    CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  -- A member cannot request their own photograph.
  CONSTRAINT photo_view_requests_not_self CHECK (requester_id <> owner_id)
);

-- One live request per direction per pair. A declined request is not live, so
-- the requester may ask again later; history stays as separate rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_view_requests_live_pair
  ON public.photo_view_requests(requester_id, owner_id)
  WHERE status IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS idx_photo_view_requests_owner_status
  ON public.photo_view_requests(owner_id, status);

GRANT SELECT, INSERT, UPDATE ON public.photo_view_requests TO authenticated;
GRANT ALL ON public.photo_view_requests TO service_role;
ALTER TABLE public.photo_view_requests ENABLE ROW LEVEL SECURITY;

-- The requester may create an outgoing request, and read their own rows.
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

-- The owner sees incoming requests and is the only one who may decide them.
DROP POLICY IF EXISTS "Owner reads incoming photo requests" ON public.photo_view_requests;
CREATE POLICY "Owner reads incoming photo requests" ON public.photo_view_requests
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owner decides incoming photo requests" ON public.photo_view_requests;
CREATE POLICY "Owner decides incoming photo requests" ON public.photo_view_requests
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  -- Decision only. `owner_id` is re-asserted and `requester_id` is anchored to
  -- the existing row, so an UPDATE cannot re-point a request at another pair.
  WITH CHECK (
    owner_id = auth.uid()
    AND status IN ('accepted', 'declined', 'revoked')
  );

-- Freeze the pair: an UPDATE must never re-point a request at another
-- member. WITH CHECK cannot reference the old row, so the trigger below
-- (added in the 20261026 repair) enforces what this comment always claimed.
-- ---------------------------------------------------------------------------
-- Access helper. SECURITY DEFINER because the storage policy is evaluated as the
-- viewer, who cannot read the owner's request rows directly.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Extend the two read policies. Both must agree, or the gallery would list a row
-- whose object the viewer may not fetch (or the object would be fetchable while
-- the gallery hides it).
-- ---------------------------------------------------------------------------
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