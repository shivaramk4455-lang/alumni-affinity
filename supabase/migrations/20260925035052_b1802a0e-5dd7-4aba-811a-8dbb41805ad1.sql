ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS alumni_email text,
  ADD COLUMN IF NOT EXISTS alumni_email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_doc_path text,
  ADD COLUMN IF NOT EXISTS verification_note text,
  ADD COLUMN IF NOT EXISTS photo_path text,
  ADD COLUMN IF NOT EXISTS photo_visibility text NOT NULL DEFAULT 'accepted_only',
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS linkedin_url text;

CREATE TABLE public.interests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interests_not_self CHECK (sender_id <> recipient_id),
  CONSTRAINT interests_status_valid CHECK (status IN ('pending','accepted','declined','withdrawn')),
  CONSTRAINT interests_unique_pair UNIQUE (sender_id, recipient_id)
);

GRANT SELECT, INSERT, UPDATE ON public.interests TO authenticated;
GRANT ALL ON public.interests TO service_role;
ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.copilots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id uuid NOT NULL,
  copilot_user_id uuid,
  copilot_email text NOT NULL,
  copilot_name text,
  relation text,
  invite_code text NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  status text NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilots_status_valid CHECK (status IN ('invited','active','revoked')),
  CONSTRAINT copilots_unique_invite UNIQUE (invite_code),
  CONSTRAINT copilots_unique_email UNIQUE (candidate_id, copilot_email)
);

GRANT SELECT, INSERT, UPDATE ON public.copilots TO authenticated;
GRANT ALL ON public.copilots TO service_role;
ALTER TABLE public.copilots ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.copilot_recommendations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id uuid NOT NULL,
  copilot_id uuid NOT NULL REFERENCES public.copilots(id) ON DELETE CASCADE,
  recommended_profile_id uuid NOT NULL,
  family_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_rec_unique UNIQUE (copilot_id, recommended_profile_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_recommendations TO authenticated;
GRANT ALL ON public.copilot_recommendations TO service_role;
ALTER TABLE public.copilot_recommendations ENABLE ROW LEVEL SECURITY;

-- helper: is the viewer an active co-pilot of this candidate?
CREATE OR REPLACE FUNCTION public.is_copilot_of(_candidate uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.copilots c
    WHERE c.candidate_id = _candidate AND c.copilot_user_id = _user AND c.status = 'active'
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_copilot_of(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_copilot_of(uuid, uuid) TO authenticated, service_role;

-- helper: do two members have a mutually accepted introduction?
CREATE OR REPLACE FUNCTION public.has_accepted_interest(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.interests i
    WHERE i.status = 'accepted'
      AND ((i.sender_id = _a AND i.recipient_id = _b) OR (i.sender_id = _b AND i.recipient_id = _a))
  )
$$;
REVOKE EXECUTE ON FUNCTION public.has_accepted_interest(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_accepted_interest(uuid, uuid) TO authenticated, service_role;

-- interests policies: candidate agency only, never co-pilots
CREATE POLICY "Read own interests" ON public.interests FOR SELECT TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id
         OR public.is_copilot_of(sender_id, auth.uid())
         OR public.is_copilot_of(recipient_id, auth.uid()));

CREATE POLICY "Send own interest" ON public.interests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND status = 'pending');

CREATE POLICY "Sender withdraws own interest" ON public.interests FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id) WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Recipient answers interest" ON public.interests FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

-- copilots policies
CREATE POLICY "Candidate manages own copilots" ON public.copilots FOR SELECT TO authenticated
  USING (auth.uid() = candidate_id OR auth.uid() = copilot_user_id);
CREATE POLICY "Candidate invites copilots" ON public.copilots FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = candidate_id);
CREATE POLICY "Candidate updates own copilots" ON public.copilots FOR UPDATE TO authenticated
  USING (auth.uid() = candidate_id) WITH CHECK (auth.uid() = candidate_id);
CREATE POLICY "Copilot accepts own invite" ON public.copilots FOR UPDATE TO authenticated
  USING (auth.uid() = copilot_user_id OR copilot_user_id IS NULL)
  WITH CHECK (auth.uid() = copilot_user_id);

-- recommendation policies
CREATE POLICY "Candidate and copilot read recommendations" ON public.copilot_recommendations FOR SELECT TO authenticated
  USING (auth.uid() = candidate_id OR public.is_copilot_of(candidate_id, auth.uid()));
CREATE POLICY "Copilot adds recommendations" ON public.copilot_recommendations FOR INSERT TO authenticated
  WITH CHECK (public.is_copilot_of(candidate_id, auth.uid())
              AND copilot_id IN (SELECT id FROM public.copilots WHERE copilot_user_id = auth.uid() AND status = 'active'));
CREATE POLICY "Copilot edits own recommendations" ON public.copilot_recommendations FOR UPDATE TO authenticated
  USING (copilot_id IN (SELECT id FROM public.copilots WHERE copilot_user_id = auth.uid()))
  WITH CHECK (copilot_id IN (SELECT id FROM public.copilots WHERE copilot_user_id = auth.uid()));
CREATE POLICY "Candidate or copilot removes recommendation" ON public.copilot_recommendations FOR DELETE TO authenticated
  USING (auth.uid() = candidate_id OR copilot_id IN (SELECT id FROM public.copilots WHERE copilot_user_id = auth.uid()));

-- co-pilot read access to their candidate's profile
CREATE POLICY "Copilot reads candidate profile" ON public.profiles FOR SELECT TO authenticated
  USING (public.is_copilot_of(id, auth.uid()));

CREATE TRIGGER interests_touch BEFORE UPDATE ON public.interests FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER copilots_touch BEFORE UPDATE ON public.copilots FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER copilot_rec_touch BEFORE UPDATE ON public.copilot_recommendations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_interests_recipient ON public.interests(recipient_id, status);
CREATE INDEX idx_interests_sender ON public.interests(sender_id, status);
CREATE INDEX idx_copilots_candidate ON public.copilots(candidate_id);
CREATE INDEX idx_copilots_user ON public.copilots(copilot_user_id);
CREATE INDEX idx_copilot_rec_candidate ON public.copilot_recommendations(candidate_id);