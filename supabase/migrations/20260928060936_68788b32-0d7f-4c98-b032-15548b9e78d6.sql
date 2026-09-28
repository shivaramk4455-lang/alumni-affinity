DROP VIEW IF EXISTS public.my_profile;
CREATE VIEW public.my_profile WITH (security_invoker = false) AS
  SELECT p.id, p.full_name, p.gender, p.birth_year, p.city, p.institution, p.degree,
    p.grad_year, p.profession, p.employer, p.relocation, p.values_statement, p.bio,
    p.is_visible, p.onboarded, p.created_at, p.updated_at,
    p.photo_path, p.photo_visibility, p.verification_status,
    p.alumni_email, p.alumni_email_verified, p.verification_doc_path, p.verification_note,
    p.verification_decided_at, p.verification_decided_by,
    p.contact_phone, p.linkedin_url, p.is_admin,
    p.height_cm, p.marital_status, p.diet, p.mother_tongue, p.residency_status,
    p.paused_until, p.paused_reason, p.show_profile_views
  FROM public.profiles p WHERE p.id = auth.uid();
REVOKE ALL ON public.my_profile FROM PUBLIC, anon;
GRANT SELECT ON public.my_profile TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.entitlement(_user uuid)
RETURNS TABLE (plan_code text, placement_weight integer, intro_requests integer, requests_used integer, requests_remaining integer, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH live AS (
    SELECT s.*, pl.code AS plan, pl.placement_weight AS weight, pl.intro_requests AS allowance
    FROM public.subscriptions s
    JOIN public.subscription_plans pl ON pl.code = s.plan_code AND pl.active
    WHERE s.user_id = _user AND s.status IN ('authenticated', 'active', 'pending')
    ORDER BY array_position(ARRAY['active', 'authenticated', 'pending'], s.status), s.created_at DESC
    LIMIT 1
  )
  SELECT coalesce(live.plan, 'free'), coalesce(live.weight, 0), live.allowance, coalesce(live.requests_used, 0),
    CASE WHEN live.allowance IS NULL AND live.id IS NOT NULL THEN NULL ELSE greatest(0, coalesce(live.allowance, 0) - coalesce(live.requests_used, 0)) END,
    live.id IS NOT NULL
  FROM (SELECT 1) AS _ LEFT JOIN live ON true
$$;
DROP INDEX IF EXISTS public.idx_subscriptions_one_live;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_live ON public.subscriptions(user_id) WHERE status IN ('authenticated', 'active', 'pending');
CREATE OR REPLACE FUNCTION public.enforce_intro_allowance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _plan text;
  _allowance int;
  _used int;
BEGIN
  IF _uid IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT (OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'pending' THEN RETURN NEW; END IF;
  SELECT e.plan_code, e.intro_requests INTO _plan, _allowance FROM public.entitlement(NEW.sender_id) e;
  IF _plan IS NULL OR _plan = 'free' THEN RETURN NEW; END IF;
  IF _allowance IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO _used
  FROM public.interests i
  JOIN public.subscriptions s ON s.user_id = NEW.sender_id AND s.status IN ('authenticated', 'active', 'pending')
  WHERE i.sender_id = NEW.sender_id AND i.status <> 'declined'
    AND i.created_at >= coalesce(s.period_start, now() - interval '30 days')
    AND (TG_OP = 'INSERT' OR i.id <> NEW.id);
  IF _used >= _allowance THEN
    RAISE EXCEPTION 'Monthly introduction allowance used — upgrade or wait for the next billing period' USING ERRCODE = '45000';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS interests_allowance ON public.interests;
CREATE TRIGGER interests_allowance BEFORE INSERT OR UPDATE ON public.interests FOR EACH ROW EXECUTE FUNCTION public.enforce_intro_allowance();
CREATE OR REPLACE FUNCTION public.record_intro_usage(_user uuid DEFAULT auth.uid())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sub uuid;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;
  SELECT id INTO _sub FROM public.subscriptions
  WHERE user_id = _user AND status IN ('authenticated', 'active', 'pending')
  ORDER BY array_position(ARRAY['active', 'authenticated', 'pending'], status), created_at DESC LIMIT 1;
  IF _sub IS NULL THEN RETURN; END IF;
  UPDATE public.subscriptions SET requests_used = requests_used + 1, updated_at = now() WHERE id = _sub;
END; $$;
ALTER TABLE public.interests DROP CONSTRAINT IF EXISTS interests_status_valid;
ALTER TABLE public.interests ADD CONSTRAINT interests_status_valid CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired', 'blocked'));
CREATE OR REPLACE FUNCTION public.enforce_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean := false;
BEGIN
  IF current_setting('app.pacing_job', true) = '1' AND NEW.status = 'expired' THEN RETURN NEW; END IF;
  IF _uid IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF _uid = OLD.sender_id AND _uid <> OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status = 'withdrawn')
             OR (OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending')
             OR (OLD.status = 'accepted' AND NEW.status = 'blocked');
  ELSIF _uid = OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined'))
             OR (OLD.status = 'accepted' AND NEW.status = 'blocked');
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
  USING (auth.uid() = sender_id AND status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired'))
  WITH CHECK (auth.uid() = sender_id AND status IN ('pending', 'withdrawn', 'blocked'));
DROP POLICY IF EXISTS "Recipient answers interest" ON public.interests;
CREATE POLICY "Recipient answers interest" ON public.interests FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id AND status IN ('pending', 'accepted'))
  WITH CHECK (auth.uid() = recipient_id AND status IN ('pending', 'accepted', 'declined', 'blocked'));
DROP POLICY IF EXISTS "Notify other members" ON public.notifications;
CREATE OR REPLACE FUNCTION public.notify_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _other uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (OLD.sender_id, 'interest_accepted', 'Introduction accepted', 'Contact details are now visible to both of you.', '/connections');
  ELSIF OLD.status = 'pending' AND NEW.status = 'declined' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (OLD.sender_id, 'interest_declined', 'Introduction declined', 'This introduction was declined. No contact was shared.', '/connections');
  ELSIF NEW.status = 'blocked' AND OLD.status <> 'blocked' THEN
    _other := CASE WHEN auth.uid() = OLD.sender_id THEN OLD.recipient_id ELSE OLD.sender_id END;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_other, 'interest_declined', 'Introduction declined', 'This introduction was declined. No contact was shared.', '/connections');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS interests_notify_counterparty ON public.interests;
CREATE TRIGGER interests_notify_counterparty AFTER UPDATE ON public.interests FOR EACH ROW EXECUTE FUNCTION public.notify_interest_transition();
CREATE OR REPLACE FUNCTION public.notify_counterparty(_user uuid, _event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _user IS NULL OR _user = _uid THEN RETURN; END IF;
  IF _event = 'interest_received' THEN
    IF NOT EXISTS (SELECT 1 FROM public.interests i WHERE i.sender_id = _uid AND i.recipient_id = _user AND i.status = 'pending') THEN
      RAISE EXCEPTION 'No pending introduction justifies this notification' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_user, 'interest_received', 'New introduction', 'A member expressed interest in connecting.', '/connections');
  ELSIF _event = 'suggestion_received' THEN
    IF NOT private.is_copilot_of(_user, _uid) THEN
      RAISE EXCEPTION 'Only an active co-pilot may notify this candidate' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_user, 'suggestion_received', 'New family suggestion', 'Your co-pilot suggested a profile for you to consider.', '/copilots');
  ELSIF _event = 'message_received' THEN
    IF NOT private.has_accepted_interest(_uid, _user) THEN
      RAISE EXCEPTION 'No accepted introduction justifies this notification' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_user, 'message_received', 'New message', 'You have a new message in an accepted introduction.', '/connections');
  ELSIF _event = 'call_missed' THEN
    IF NOT private.has_accepted_interest(_uid, _user) THEN
      RAISE EXCEPTION 'No accepted introduction justifies this notification' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_user, 'call_missed', 'Missed video call', 'A video call from an accepted introduction was not answered.', '/connections');
  ELSE
    RAISE EXCEPTION 'Unknown notification event' USING ERRCODE = '22023';
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.notify_counterparty(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_counterparty(uuid, text) TO authenticated, service_role;
DROP POLICY IF EXISTS "Copilot accepts own invite" ON public.copilots;
CREATE OR REPLACE FUNCTION public.sweep_stale_calls()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _closed int := 0;
  _row public.calls;
BEGIN
  FOR _row IN SELECT * FROM public.calls WHERE status = 'ringing' AND started_at < now() - interval '60 seconds' FOR UPDATE
  LOOP
    UPDATE public.calls SET status = 'ended', ended_at = now(), decline_reason = coalesce(decline_reason, 'missed') WHERE id = _row.id;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_row.callee_id, 'call_missed', 'Missed video call', 'A video call from an accepted introduction was not answered.', '/connections');
    _closed := _closed + 1;
  END LOOP;
  UPDATE public.calls SET status = 'ended', ended_at = now(), decline_reason = coalesce(decline_reason, 'ended')
  WHERE status <> 'ended' AND started_at < now() - interval '2 hours';
  GET DIAGNOSTICS _closed = ROW_COUNT;
  RETURN _closed;
END; $$;
REVOKE EXECUTE ON FUNCTION public.sweep_stale_calls() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_stale_calls() TO authenticated, service_role;