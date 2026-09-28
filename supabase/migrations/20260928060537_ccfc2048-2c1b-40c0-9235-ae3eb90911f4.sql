CREATE TABLE IF NOT EXISTS public.partner_preferences (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  min_age int CHECK (min_age IS NULL OR (min_age BETWEEN 21 AND 80)),
  max_age int CHECK (max_age IS NULL OR (max_age BETWEEN 21 AND 80)),
  genders text[] NOT NULL DEFAULT '{}',
  institutions text[] NOT NULL DEFAULT '{}',
  cities text[] NOT NULL DEFAULT '{}',
  relocations text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_preferences_age_order CHECK (min_age IS NULL OR max_age IS NULL OR min_age <= max_age),
  CONSTRAINT partner_preferences_list_sizes CHECK (
    coalesce(array_length(genders, 1), 0) <= 5
    AND coalesce(array_length(institutions, 1), 0) <= 20
    AND coalesce(array_length(cities, 1), 0) <= 20
    AND coalesce(array_length(relocations, 1), 0) <= 5)
);
GRANT SELECT, INSERT, UPDATE ON public.partner_preferences TO authenticated;
GRANT ALL ON public.partner_preferences TO service_role;
ALTER TABLE public.partner_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own preferences read" ON public.partner_preferences;
CREATE POLICY "Own preferences read" ON public.partner_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Own preferences write" ON public.partner_preferences;
CREATE POLICY "Own preferences write" ON public.partner_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Own preferences update" ON public.partner_preferences;
CREATE POLICY "Own preferences update" ON public.partner_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS partner_preferences_touch ON public.partner_preferences;
CREATE TRIGGER partner_preferences_touch BEFORE UPDATE ON public.partner_preferences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.interests
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
ALTER TABLE public.interests DROP CONSTRAINT IF EXISTS interests_status_valid;
ALTER TABLE public.interests ADD CONSTRAINT interests_status_valid
  CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired'));
CREATE INDEX IF NOT EXISTS idx_interests_expiry ON public.interests(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_interests_reminder ON public.interests(expires_at) WHERE status = 'pending' AND reminder_sent_at IS NULL;
CREATE OR REPLACE FUNCTION public.enforce_interest_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _outstanding int;
BEGIN
  IF auth.uid() IS NULL OR NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _outstanding FROM public.interests
  WHERE sender_id = NEW.sender_id AND status = 'pending' AND id <> NEW.id;
  IF _outstanding >= 5 THEN
    RAISE EXCEPTION 'At most five outstanding introductions — withdraw one before sending another' USING ERRCODE = '45000';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS interests_quota ON public.interests;
CREATE TRIGGER interests_quota BEFORE INSERT OR UPDATE ON public.interests FOR EACH ROW EXECUTE FUNCTION public.enforce_interest_quota();
CREATE OR REPLACE FUNCTION public.expire_stale_interests()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _expired int := 0;
  _reminded int := 0;
  _row public.interests;
BEGIN
  PERFORM set_config('app.pacing_job', '1', true);
  FOR _row IN SELECT * FROM public.interests WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now() FOR UPDATE
  LOOP
    UPDATE public.interests SET status = 'expired', updated_at = now() WHERE id = _row.id;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_row.sender_id, 'interest_expired', 'An introduction quietly expired',
      'The introduction you sent fourteen days ago has closed on its own. You are free to send it again if you would still like to connect.', '/connections');
    _expired := _expired + 1;
  END LOOP;
  FOR _row IN SELECT * FROM public.interests WHERE status = 'pending' AND reminder_sent_at IS NULL AND expires_at IS NOT NULL AND expires_at - interval '7 days' <= now() FOR UPDATE
  LOOP
    UPDATE public.interests SET reminder_sent_at = now() WHERE id = _row.id;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_row.recipient_id, 'interest_reminder', 'An introduction is waiting for you',
      'An introduction sent to you will close in seven days. A reply of any kind keeps it alive.', '/connections');
    _reminded := _reminded + 1;
  END LOOP;
  RETURN _expired + _reminded;
END; $$;
REVOKE EXECUTE ON FUNCTION public.expire_stale_interests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_interests() TO authenticated, service_role;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid
  CHECK (kind IN ('interest_received','interest_accepted','interest_declined','interest_expired','interest_reminder','copilot_invite_accepted','verification_approved','verification_resubmission','verification_rejected','suggestion_received','message_received','call_missed'));
CREATE OR REPLACE FUNCTION public.enforce_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean := false;
BEGIN
  IF current_setting('app.pacing_job', true) = '1' AND NEW.status = 'expired' THEN
    RETURN NEW;
  END IF;
  IF _uid IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF _uid = OLD.sender_id AND _uid <> OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status = 'withdrawn')
             OR (OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending');
  ELSIF _uid = OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined'));
  END IF;
  IF NOT _allowed THEN
    RAISE EXCEPTION 'Only the recipient may accept an introduction, and only while it is pending' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
    NEW.expires_at := now() + interval '14 days';
    NEW.reminder_sent_at := NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP POLICY IF EXISTS "Sender withdraws own interest" ON public.interests;
CREATE POLICY "Sender withdraws own interest" ON public.interests FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id AND status IN ('pending', 'declined', 'withdrawn', 'expired'))
  WITH CHECK (auth.uid() = sender_id AND status IN ('pending', 'withdrawn'));