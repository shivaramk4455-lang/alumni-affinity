CREATE TABLE IF NOT EXISTS public.consent_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  granted boolean NOT NULL DEFAULT true,
  policy_version text NOT NULL,
  note text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_events_purpose_valid CHECK (purpose IN ('terms_and_privacy','partnership_criteria','document_review','photo_watermarking','contact_disclosure','sabbatical_visibility','profile_views_display','account_deletion'))
);
CREATE INDEX IF NOT EXISTS idx_consent_events_user ON public.consent_events(user_id, recorded_at DESC);
GRANT SELECT, INSERT ON public.consent_events TO authenticated;
GRANT ALL ON public.consent_events TO service_role;
ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own consent events read" ON public.consent_events;
CREATE POLICY "Own consent events read" ON public.consent_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Own consent events insert" ON public.consent_events;
CREATE POLICY "Own consent events insert" ON public.consent_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE OR REPLACE FUNCTION public.record_consent(_purpose text, _granted boolean, _policy_version text, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to record consent' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.consent_events (user_id, purpose, granted, policy_version, note)
  VALUES (_uid, _purpose, _granted, _policy_version, _note) RETURNING id INTO _id;
  RETURN _id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_consent(text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_consent(text, boolean, text, text) TO authenticated, service_role;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paused_until timestamptz, ADD COLUMN IF NOT EXISTS paused_reason text;
CREATE OR REPLACE FUNCTION public.guard_pause_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.paused_until IS DISTINCT FROM OLD.paused_until AND NEW.paused_until IS NOT NULL AND NEW.paused_until > now() + interval '1 year' THEN
    RAISE EXCEPTION 'A pause cannot exceed one year' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS profiles_guard_pause ON public.profiles;
CREATE TRIGGER profiles_guard_pause BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_pause_columns();
GRANT UPDATE (paused_until, paused_reason) ON public.profiles TO authenticated;
CREATE OR REPLACE VIEW public.my_profile WITH (security_invoker = false) AS
  SELECT p.id, p.full_name, p.gender, p.birth_year, p.city, p.institution, p.degree,
    p.grad_year, p.profession, p.employer, p.relocation, p.values_statement, p.bio,
    p.is_visible, p.onboarded, p.created_at, p.updated_at,
    p.photo_path, p.photo_visibility, p.verification_status,
    p.alumni_email, p.alumni_email_verified, p.verification_doc_path, p.verification_note,
    p.verification_decided_at, p.verification_decided_by,
    p.contact_phone, p.linkedin_url, p.is_admin, p.paused_until, p.paused_reason
  FROM public.profiles p WHERE p.id = auth.uid();
REVOKE ALL ON public.my_profile FROM PUBLIC, anon;
GRANT SELECT ON public.my_profile TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.profile_views (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  viewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_views_not_self CHECK (viewer_id <> viewed_id),
  CONSTRAINT profile_views_one_per_pair UNIQUE (viewer_id, viewed_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_views_viewed ON public.profile_views(viewed_id, viewed_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.profile_views TO authenticated;
GRANT ALL ON public.profile_views TO service_role;
ALTER TABLE public.profile_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Viewed member reads their visitors" ON public.profile_views;
CREATE POLICY "Viewed member reads their visitors" ON public.profile_views FOR SELECT TO authenticated USING (auth.uid() = viewed_id OR private.is_admin());
DROP POLICY IF EXISTS "Record own visit" ON public.profile_views;
CREATE POLICY "Record own visit" ON public.profile_views FOR INSERT TO authenticated WITH CHECK (auth.uid() = viewer_id);
DROP POLICY IF EXISTS "Bump own visit timestamp" ON public.profile_views;
CREATE POLICY "Bump own visit timestamp" ON public.profile_views FOR UPDATE TO authenticated
  USING (auth.uid() = viewer_id AND viewed_id <> auth.uid()) WITH CHECK (auth.uid() = viewer_id AND viewed_id <> auth.uid());
CREATE OR REPLACE FUNCTION public.record_profile_view(_viewed uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _viewed IS NULL OR _uid = _viewed THEN
    RETURN;
  END IF;
  BEGIN
    INSERT INTO public.profile_views (viewer_id, viewed_id) VALUES (_uid, _viewed)
    ON CONFLICT (viewer_id, viewed_id) DO UPDATE SET viewed_at = now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'profile_view log skipped: %', SQLERRM;
  END;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_profile_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_profile_view(uuid) TO authenticated, service_role;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_profile_views boolean NOT NULL DEFAULT false;
GRANT UPDATE (show_profile_views) ON public.profiles TO authenticated;
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
CREATE INDEX IF NOT EXISTS idx_contact_reveals_revealed ON public.contact_reveals(revealed_id, last_revealed_at DESC);
GRANT SELECT ON public.contact_reveals TO authenticated;
GRANT ALL ON public.contact_reveals TO service_role;
ALTER TABLE public.contact_reveals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Contact reveal log readable" ON public.contact_reveals;
CREATE POLICY "Contact reveal log readable" ON public.contact_reveals FOR SELECT TO authenticated
  USING (auth.uid() = revealed_id OR auth.uid() = viewer_id OR private.is_admin());
DROP FUNCTION IF EXISTS public.reveal_contact(uuid);
DROP FUNCTION IF EXISTS public.reveal_contacts(uuid[]);
CREATE OR REPLACE FUNCTION public.reveal_contact(_profile uuid)
RETURNS TABLE (profile_id uuid, contact_phone text, linkedin_url text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _profile = _uid THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _profile AND private.has_accepted_interest(p.id, _uid)) THEN
    BEGIN
      INSERT INTO public.contact_reveals (viewer_id, revealed_id) VALUES (_uid, _profile)
      ON CONFLICT (viewer_id, revealed_id) DO UPDATE SET last_revealed_at = now(), access_count = contact_reveals.access_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'contact_reveal log skipped: %', SQLERRM;
    END;
    RETURN QUERY SELECT p.id, p.contact_phone, p.linkedin_url FROM public.profiles p WHERE p.id = _profile;
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
  IF _uid IS NULL THEN RETURN; END IF;
  FOREACH _id IN ARRAY COALESCE(_profiles, '{}'::uuid[]) LOOP
    EXIT WHEN _count >= 50;
    IF _id = _uid THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _id AND private.has_accepted_interest(p.id, _uid)) THEN
      BEGIN
        INSERT INTO public.contact_reveals (viewer_id, revealed_id) VALUES (_uid, _id)
        ON CONFLICT (viewer_id, revealed_id) DO UPDATE SET last_revealed_at = now(), access_count = contact_reveals.access_count + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'contact_reveal log skipped: %', SQLERRM;
      END;
      RETURN QUERY SELECT p.id, p.contact_phone, p.linkedin_url FROM public.profiles p WHERE p.id = _id;
      _count := _count + 1;
    END IF;
  END LOOP;
  RETURN;
END; $$;
REVOKE EXECUTE ON FUNCTION public.reveal_contact(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reveal_contacts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_contact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reveal_contacts(uuid[]) TO authenticated, service_role;
ALTER TABLE public.partner_preferences ADD COLUMN IF NOT EXISTS shield_employer boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION private.same_shielded_employer(_candidate_employer text, _viewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles m
    WHERE m.id = _viewer AND m.employer IS NOT NULL AND lower(m.employer) = lower(_candidate_employer)
      AND EXISTS (SELECT 1 FROM public.partner_preferences p WHERE p.user_id = _viewer AND p.shield_employer))
$$;
REVOKE EXECUTE ON FUNCTION private.same_shielded_employer(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.same_shielded_employer(text, uuid) TO authenticated, service_role;
DROP POLICY IF EXISTS "Verified members read the directory" ON public.profiles;
CREATE POLICY "Verified members read the directory" ON public.profiles FOR SELECT TO authenticated
  USING (onboarded AND is_visible AND verification_status = 'verified' AND private.is_verified(auth.uid())
    AND (paused_until IS NULL OR paused_until <= now())
    AND NOT private.same_shielded_employer(employer, auth.uid()));