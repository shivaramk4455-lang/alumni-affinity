CREATE TABLE IF NOT EXISTS public.saved_profiles (
  user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_profiles_pkey PRIMARY KEY (user_id, profile_id),
  CONSTRAINT saved_profiles_not_self CHECK (user_id <> profile_id)
);
GRANT SELECT, INSERT, DELETE ON public.saved_profiles TO authenticated;
GRANT ALL ON public.saved_profiles TO service_role;
ALTER TABLE public.saved_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own saves read" ON public.saved_profiles;
CREATE POLICY "Own saves read" ON public.saved_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Own saves insert" ON public.saved_profiles;
CREATE POLICY "Own saves insert" ON public.saved_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Own saves delete" ON public.saved_profiles;
CREATE POLICY "Own saves delete" ON public.saved_profiles FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_saved_profiles_user ON public.saved_profiles(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION private.is_verified(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user AND p.verification_status = 'verified')
$$;
REVOKE EXECUTE ON FUNCTION private.is_verified(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_verified(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean := false;
BEGIN
  IF _uid IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF _uid = OLD.sender_id AND _uid <> OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status = 'withdrawn')
             OR (OLD.status IN ('declined', 'withdrawn') AND NEW.status = 'pending');
  ELSIF _uid = OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined'));
  END IF;
  IF NOT _allowed THEN
    RAISE EXCEPTION 'Only the recipient may accept an introduction, and only while it is pending'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS interests_transition ON public.interests;
CREATE TRIGGER interests_transition BEFORE UPDATE ON public.interests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_interest_transition();

DROP POLICY IF EXISTS "Sender withdraws own interest" ON public.interests;
CREATE POLICY "Sender withdraws own interest" ON public.interests FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id AND status IN ('pending', 'declined', 'withdrawn'))
  WITH CHECK (auth.uid() = sender_id AND status IN ('pending', 'withdrawn'));
DROP POLICY IF EXISTS "Recipient answers interest" ON public.interests;
CREATE POLICY "Recipient answers interest" ON public.interests FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id AND status = 'pending')
  WITH CHECK (auth.uid() = recipient_id AND status IN ('accepted', 'declined'));
DROP POLICY IF EXISTS "Read own interests" ON public.interests;
CREATE POLICY "Read own interests" ON public.interests FOR SELECT TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
DROP POLICY IF EXISTS "Send own interest" ON public.interests;
CREATE POLICY "Send own interest" ON public.interests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND status = 'pending' AND private.is_verified(auth.uid()));

DROP POLICY IF EXISTS "Notify other members" ON public.notifications;
CREATE POLICY "Notify other members" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() <> user_id
    AND kind IN ('interest_received','interest_accepted','interest_declined','copilot_invite_accepted','suggestion_received')
    AND coalesce(link, '') IN ('/connections', '/copilots', '/notifications', '/dashboard')
  );

CREATE OR REPLACE FUNCTION public.guard_notification_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.title IS DISTINCT FROM OLD.title
          OR NEW.body IS DISTINCT FROM OLD.body
          OR NEW.link IS DISTINCT FROM OLD.link
          OR NEW.kind IS DISTINCT FROM OLD.kind
          OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'Notifications can only be marked as read' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notifications_guard_columns ON public.notifications;
CREATE TRIGGER notifications_guard_columns BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_notification_columns();

DROP POLICY IF EXISTS "Copilot accepts own invite" ON public.copilots;
DROP POLICY IF EXISTS "Candidate updates own copilots" ON public.copilots;
CREATE POLICY "Candidate updates own copilots" ON public.copilots FOR UPDATE TO authenticated
  USING (auth.uid() = candidate_id) WITH CHECK (auth.uid() = candidate_id);

CREATE OR REPLACE FUNCTION public.guard_copilot_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
          OR NEW.invite_code IS DISTINCT FROM OLD.invite_code
          OR NEW.copilot_email IS DISTINCT FROM OLD.copilot_email) THEN
    RAISE EXCEPTION 'A co-pilot invitation cannot be reassigned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS copilots_guard_columns ON public.copilots;
CREATE TRIGGER copilots_guard_columns BEFORE UPDATE ON public.copilots
  FOR EACH ROW EXECUTE FUNCTION public.guard_copilot_columns();

CREATE OR REPLACE FUNCTION public.accept_copilot_invite(_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  _row public.copilots;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to accept a co-pilot invitation' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR length(_code) < 8 THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO _row FROM public.copilots WHERE invite_code = _code AND status <> 'revoked' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF _row.copilot_user_id IS NOT NULL AND _row.copilot_user_id <> _uid THEN
    RAISE EXCEPTION 'invitation_already_used' USING ERRCODE = 'P0001';
  END IF;
  IF _email = '' OR lower(_row.copilot_email) <> _email THEN
    RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.copilots SET copilot_user_id = _uid, status = 'active' WHERE id = _row.id RETURNING * INTO _row;
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (_row.candidate_id, 'copilot_invite_accepted', 'Co-pilot joined', 'Your family co-pilot accepted the invitation.', '/copilots');
  RETURN _row.candidate_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.accept_copilot_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_copilot_invite(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Members read visible onboarded" ON public.profiles;
CREATE POLICY "Verified members read the directory" ON public.profiles FOR SELECT TO authenticated
  USING (onboarded AND is_visible AND verification_status = 'verified' AND private.is_verified(auth.uid()));
DROP POLICY IF EXISTS "Introductions see the other side" ON public.profiles;
CREATE POLICY "Introductions see the other side" ON public.profiles FOR SELECT TO authenticated
  USING (
    private.is_copilot_of(id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.interests i
      WHERE (i.sender_id = profiles.id AND i.recipient_id = auth.uid())
         OR (i.recipient_id = profiles.id AND i.sender_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "Desk reads reports" ON public.reports;
CREATE POLICY "Desk reads reports" ON public.reports FOR SELECT TO authenticated USING (private.is_admin());
DROP POLICY IF EXISTS "File own report" ON public.reports;
CREATE POLICY "File own report" ON public.reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = reported_profile_id));