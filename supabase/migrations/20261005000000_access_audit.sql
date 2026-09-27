-- ===========================================================================
-- 20261005: Access audit + employer shield.
--
-- Three DPDP obligations in one place:
--   * Record access — who looked at a profile, and who actually received
--     contact coordinates. The reveal log is written inside the SECURITY
--     DEFINER RPC, so it cannot be skipped by the client that benefits from it.
--   * Let the member see that log, opt in/out of showing view tracking.
--   * Employer shield — the one piece of filtering that must live in RLS:
--     hiding the same-employer rows in PostgREST would corrupt the page count,
--     so it is a clause on the directory policy and every other query inherits
--     it for free.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Profile view tracking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_views (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  viewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_views_not_self CHECK (viewer_id <> viewed_id),
  CONSTRAINT profile_views_one_per_pair UNIQUE (viewer_id, viewed_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_views_viewed
  ON public.profile_views(viewed_id, viewed_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.profile_views TO authenticated;
GRANT ALL ON public.profile_views TO service_role;
ALTER TABLE public.profile_views ENABLE ROW LEVEL SECURITY;

-- You see who visited you; the desk sees everything. The viewer's own log is
-- not exposed — it is a record about the person visited, not the visitor.
DROP POLICY IF EXISTS "Viewed member reads their visitors" ON public.profile_views;
CREATE POLICY "Viewed member reads their visitors" ON public.profile_views FOR SELECT TO authenticated
  USING (auth.uid() = viewed_id OR private.is_admin());

DROP POLICY IF EXISTS "Record own visit" ON public.profile_views;
CREATE POLICY "Record own visit" ON public.profile_views FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = viewer_id);

-- The upsert bumps viewed_at on a repeat visit; identity stays frozen.
DROP POLICY IF EXISTS "Bump own visit timestamp" ON public.profile_views;
CREATE POLICY "Bump own visit timestamp" ON public.profile_views FOR UPDATE TO authenticated
  USING (auth.uid() = viewer_id AND viewed_id <> auth.uid())
  WITH CHECK (auth.uid() = viewer_id AND viewed_id <> auth.uid());

CREATE OR REPLACE FUNCTION public.record_profile_view(_viewed uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _viewed IS NULL OR _uid = _viewed THEN
    RETURN;
  END IF;
  -- Fire and forget: an access log must never fail the page that caused it.
  BEGIN
    INSERT INTO public.profile_views (viewer_id, viewed_id)
    VALUES (_uid, _viewed)
    ON CONFLICT (viewer_id, viewed_id)
      DO UPDATE SET viewed_at = now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'profile_view log skipped: %', SQLERRM;
  END;
END; $$;

REVOKE EXECUTE ON FUNCTION public.record_profile_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_profile_view(uuid) TO authenticated, service_role;

-- View tracking runs regardless (it is an access log), but is only rendered
-- back to the member when they opt in.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_profile_views boolean NOT NULL DEFAULT false;

GRANT UPDATE (show_profile_views) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Contact-detail reveal log. Written from inside the reveal RPCs, so a
--    member cannot read a phone number without leaving a record of it.
--    One row per pair, with a counter: bounded storage, full picture.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_reveals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  viewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  revealed_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_revealed_at timestamptz NOT NULL DEFAULT now(),
  last_revealed_at timestamptz NOT NULL DEFAULT now(),
  access_count bigint NOT NULL DEFAULT 1,
  CONSTRAINT contact_reveals_not_self CHECK (viewer_id <> revealed_id),
  CONSTRAINT contact_reveals_one_per_pair UNIQUE (viewer_id, revealed_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_reveals_revealed
  ON public.contact_reveals(revealed_id, last_revealed_at DESC);

GRANT SELECT ON public.contact_reveals TO authenticated;
GRANT ALL ON public.contact_reveals TO service_role;
ALTER TABLE public.contact_reveals ENABLE ROW LEVEL SECURITY;

-- Read-only for everyone: the desk audits who saw what, and either party can
-- see the access history of their own coordinates. No member writes it
-- directly — the reveal functions run as the owner.
DROP POLICY IF EXISTS "Contact reveal log readable" ON public.contact_reveals;
CREATE POLICY "Contact reveal log readable" ON public.contact_reveals FOR SELECT TO authenticated
  USING (auth.uid() = revealed_id OR auth.uid() = viewer_id OR private.is_admin());

-- Contact coordinates: readable only where a mutual introduction is accepted
-- (replaces the 20260928000100 definitions, adding the audit write).
CREATE OR REPLACE FUNCTION public.reveal_contact(_profile uuid)
RETURNS TABLE (profile_id uuid, contact_phone text, linkedin_url text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _profile = _uid THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _profile AND private.has_accepted_interest(p.id, _uid)
  ) THEN
    BEGIN
      INSERT INTO public.contact_reveals (viewer_id, revealed_id)
      VALUES (_uid, _profile)
      ON CONFLICT (viewer_id, revealed_id)
        DO UPDATE SET last_revealed_at = now(), access_count = contact_reveals.access_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'contact_reveal log skipped: %', SQLERRM;
    END;

    RETURN QUERY
      SELECT p.id, p.contact_phone, p.linkedin_url
      FROM public.profiles p
      WHERE p.id = _profile;
  END IF;

  RETURN;
END; $$;

CREATE OR REPLACE FUNCTION public.reveal_contacts(_profiles uuid[])
RETURNS TABLE (profile_id uuid, contact_phone text, linkedin_url text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _count int := 0;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  FOREACH _id IN ARRAY COALESCE(_profiles, '{}'::uuid[]) LOOP
    EXIT WHEN _count >= 50;          -- a page cannot smuggle a whole directory
    IF _id = _uid THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = _id AND private.has_accepted_interest(p.id, _uid)
    ) THEN
      BEGIN
        INSERT INTO public.contact_reveals (viewer_id, revealed_id)
        VALUES (_uid, _id)
        ON CONFLICT (viewer_id, revealed_id)
          DO UPDATE SET last_revealed_at = now(), access_count = contact_reveals.access_count + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'contact_reveal log skipped: %', SQLERRM;
      END;

      RETURN QUERY
        SELECT p.id, p.contact_phone, p.linkedin_url
        FROM public.profiles p
        WHERE p.id = _id;
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN;
END; $$;

REVOKE EXECUTE ON FUNCTION public.reveal_contact(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reveal_contacts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_contact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reveal_contacts(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Employer shield. Filtering same-employer rows out of the client query
--    would desynchronise the page count, so it is expressed as a clause on the
--    directory RLS policy instead: pagination, counts and every future query
--    get it for free.
-- ---------------------------------------------------------------------------
ALTER TABLE public.partner_preferences
  ADD COLUMN IF NOT EXISTS shield_employer boolean NOT NULL DEFAULT false;

-- SECURITY DEFINER so the profiles policy can consult profiles + preferences
-- without recursing into itself.
CREATE OR REPLACE FUNCTION private.same_shielded_employer(_candidate_employer text, _viewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles m
    WHERE m.id = _viewer
      AND m.employer IS NOT NULL
      AND lower(m.employer) = lower(_candidate_employer)
      AND EXISTS (
        SELECT 1 FROM public.partner_preferences p
        WHERE p.user_id = _viewer AND p.shield_employer
      )
  )
$$;
REVOKE EXECUTE ON FUNCTION private.same_shielded_employer(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.same_shielded_employer(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Verified members read the directory" ON public.profiles;
CREATE POLICY "Verified members read the directory" ON public.profiles FOR SELECT TO authenticated
  USING (
    onboarded
    AND is_visible
    AND verification_status = 'verified'
    AND private.is_verified(auth.uid())
    AND (paused_until IS NULL OR paused_until <= now())
    -- Employer shield: opt-in only, and it only hides the *candidate* rows —
    -- never your own, never an existing introduction.
    AND NOT private.same_shielded_employer(employer, auth.uid())
  );

