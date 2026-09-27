-- ===========================================================================
-- 20261004: DPDP / data-governance layer.
--
-- India's Digital Personal Data Protection Act 2023 asks for three things
-- this schema now delivers:
--
--   1. A demonstrable consent trail. `consent_events` is an append-only ledger
--      (no UPDATE/DELETE policy for members) recording what a member consented
--      to, when, and under which version of the notice.
--   2. A right to be fulfilled through the grievance desk: account deletion
--      that purges storage before removing the row, so credentials do not
--      outlive the account.
--   3. A right to restrict processing — "sabbatical" pauses discovery for a
--      chosen period without deleting the member's history.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Consent ledger (append-only for the owner).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consent_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  granted boolean NOT NULL DEFAULT true,
  policy_version text NOT NULL,
  note text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_events_purpose_valid CHECK (purpose IN (
    'terms_and_privacy',
    'partnership_criteria',
    'document_review',
    'photo_watermarking',
    'contact_disclosure',
    'sabbatical_visibility',
    'profile_views_display',
    'account_deletion'
  ))
);

CREATE INDEX IF NOT EXISTS idx_consent_events_user
  ON public.consent_events(user_id, recorded_at DESC);

GRANT SELECT, INSERT ON public.consent_events TO authenticated;
GRANT ALL ON public.consent_events TO service_role;
ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own consent events read" ON public.consent_events;
CREATE POLICY "Own consent events read" ON public.consent_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own consent events insert" ON public.consent_events;
CREATE POLICY "Own consent events insert" ON public.consent_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
-- Deliberately no UPDATE/DELETE policy: consent evidence is not editable by
-- the person it is evidence about. Only the service role may correct it.

-- Consent history is append-only: a member changing their mind writes a new
-- row (granted = false); readers take the newest row per purpose.
CREATE OR REPLACE FUNCTION public.record_consent(
  _purpose text, _granted boolean, _policy_version text, _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to record consent' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.consent_events (user_id, purpose, granted, policy_version, note)
  VALUES (_uid, _purpose, _granted, _policy_version, _note)
  RETURNING id INTO _id;

  RETURN _id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.record_consent(text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_consent(text, boolean, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Sabbatical / courtship pause. Distinct from withdrawal: nothing is
--    deleted, the profile simply stops being discoverable for the period.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS paused_reason text;

-- A pause always belongs to the row it is on and cannot be pushed beyond a
-- year — a forgotten "paused forever" is indistinguishable from a deleted
-- account for the desk.
CREATE OR REPLACE FUNCTION public.guard_pause_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.paused_until IS DISTINCT FROM OLD.paused_until
     AND NEW.paused_until IS NOT NULL
     AND NEW.paused_until > now() + interval '1 year' THEN
    RAISE EXCEPTION 'A pause cannot exceed one year' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_guard_pause ON public.profiles;
CREATE TRIGGER profiles_guard_pause BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_pause_columns();

-- Writable by the owner (column-level grant). Not SELECTable: the pause reason
-- would otherwise be visible on every directory row, so it is exposed only
-- through the my_profile view below.
GRANT UPDATE (paused_until, paused_reason) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Directory policies gain the pause check. A paused member vanishes from
--    search while keeping saved lists, introductions and history; existing
--    counterparts keep access so pausing never silently kills a live
--    introduction.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Verified members read the directory" ON public.profiles;
CREATE POLICY "Verified members read the directory" ON public.profiles FOR SELECT TO authenticated
  USING (
    onboarded
    AND is_visible
    AND verification_status = 'verified'
    AND private.is_verified(auth.uid())
    AND (paused_until IS NULL OR paused_until <= now())
  );


-- ---------------------------------------------------------------------------
-- 4. Surface the pause to its owner only. `CREATE OR REPLACE VIEW` may only
--    append columns, so the new ones go last and every existing column keeps
--    its position (the client reads this view by name, not position).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.my_profile WITH (security_invoker = false) AS
  SELECT
    p.id, p.full_name, p.gender, p.birth_year, p.city, p.institution, p.degree,
    p.grad_year, p.profession, p.employer, p.relocation, p.values_statement, p.bio,
    p.is_visible, p.onboarded, p.created_at, p.updated_at,
    p.photo_path, p.photo_visibility, p.verification_status,
    p.alumni_email, p.alumni_email_verified, p.verification_doc_path, p.verification_note,
    p.verification_decided_at, p.verification_decided_by,
    p.contact_phone, p.linkedin_url, p.is_admin,
    p.paused_until, p.paused_reason
  FROM public.profiles p
  WHERE p.id = auth.uid();

REVOKE ALL ON public.my_profile FROM PUBLIC, anon;
GRANT SELECT ON public.my_profile TO authenticated, service_role;

