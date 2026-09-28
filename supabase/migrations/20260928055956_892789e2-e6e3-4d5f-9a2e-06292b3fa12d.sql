ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id uuid NOT NULL,
  reported_profile_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_not_self CHECK (reporter_id <> reported_profile_id),
  CONSTRAINT reports_unique_pair UNIQUE (reporter_id, reported_profile_id)
);

GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own reports read" ON public.reports;
CREATE POLICY "Own reports read" ON public.reports FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id);
DROP POLICY IF EXISTS "File own report" ON public.reports;
CREATE POLICY "File own report" ON public.reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_kind_valid CHECK (kind IN ('interest_received','interest_accepted','interest_declined','copilot_invite_accepted','verification_approved','verification_resubmission','suggestion_received'))
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own notifications read" ON public.notifications;
CREATE POLICY "Own notifications read" ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Own notifications mark read" ON public.notifications;
CREATE POLICY "Own notifications mark read" ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON public.reports(reported_profile_id);

CREATE OR REPLACE FUNCTION public.enforce_copilot_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'revoked' THEN
    IF (SELECT count(*) FROM public.copilots
        WHERE candidate_id = NEW.candidate_id AND status <> 'revoked' AND id <> NEW.id) >= 2 THEN
      RAISE EXCEPTION 'At most two active co-pilots per candidate';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS copilots_cap ON public.copilots;
CREATE TRIGGER copilots_cap BEFORE INSERT OR UPDATE ON public.copilots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_copilot_cap();

CREATE OR REPLACE FUNCTION public.guard_verified_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF _uid = OLD.id THEN
    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
      IF NOT (OLD.verification_status IN ('unverified', 'needs_resubmission')
              AND NEW.verification_status = 'pending_review') THEN
        RAISE EXCEPTION 'Verification decisions are made by the membership desk';
      END IF;
    END IF;
    IF NEW.alumni_email_verified IS DISTINCT FROM OLD.alumni_email_verified
       OR NEW.verification_note IS DISTINCT FROM OLD.verification_note
       OR NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Verification fields can only be set by the membership desk';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_guard_verified ON public.profiles;
CREATE TRIGGER profiles_guard_verified BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_columns();

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
$$;
REVOKE EXECUTE ON FUNCTION private.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated, service_role;

DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT TO authenticated
  USING (private.is_admin());

DROP POLICY IF EXISTS "Admin reads documents" ON storage.objects;
CREATE POLICY "Admin reads documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'verification-docs' AND private.is_admin());

DROP POLICY IF EXISTS "Admin reads photos" ON storage.objects;
CREATE POLICY "Admin reads photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'profile-photos' AND private.is_admin());

DROP POLICY IF EXISTS "Notify other members" ON public.notifications;
CREATE POLICY "Notify other members" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() <> user_id);