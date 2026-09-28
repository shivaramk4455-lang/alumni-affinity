ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS sellable boolean NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS service_note text;
UPDATE public.subscription_plans SET service_note = 'Desk-curated shortlist each month, photo/credential pre-check, priority desk replies.', sellable = true, active = true WHERE code = 'concierge';
UPDATE public.subscription_plans SET label = 'Founder (grandfathered)', service_note = 'Legacy tier: kept only for members who already pay for it. No longer sold.', sellable = false, active = true, intro_requests = greatest(coalesce(intro_requests, 0), 60) WHERE code = 'founder';
ALTER TABLE public.interests ADD COLUMN IF NOT EXISTS decided_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_interests_decided ON public.interests(recipient_id, decided_at) WHERE decided_at IS NOT NULL;
CREATE OR REPLACE FUNCTION public.enforce_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean := false;
BEGIN
  IF current_setting('app.pacing_job', true) = '1' AND NEW.status = 'expired' THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
      NEW.expires_at := now() + interval '14 days';
      NEW.reminder_sent_at := NULL;
      NEW.decided_at := NULL;
    ELSIF NEW.status IN ('accepted', 'declined', 'blocked') THEN
      NEW.decided_at := now();
    END IF;
  END IF;
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
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.response_rate(_user uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _rate numeric;
BEGIN
  IF _user IS NULL OR (_user IS DISTINCT FROM auth.uid() AND NOT private.is_admin()) THEN
    RAISE EXCEPTION 'Response rate is personal to the member or the desk' USING ERRCODE = '42501';
  END IF;
  SELECT CASE WHEN count(*) < 5 THEN 0.500
    ELSE round(count(*) FILTER (WHERE i.status IN ('accepted', 'declined', 'blocked') AND i.decided_at IS NOT NULL AND i.decided_at <= i.created_at + interval '7 days')::numeric / greatest(count(*), 1), 3) END
  INTO _rate
  FROM public.interests i
  WHERE i.recipient_id = _user AND (i.status IN ('accepted', 'declined', 'blocked', 'expired') OR (i.status = 'pending' AND i.expires_at < now()));
  RETURN coalesce(_rate, 0.500);
END; $$;
REVOKE EXECUTE ON FUNCTION public.response_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.response_rate(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.reciprocity_multiplier(_user uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.response_rate(_user) >= 0.800 THEN 1.500 WHEN public.response_rate(_user) >= 0.500 THEN 1.000 ELSE 0.500 END
$$;
REVOKE EXECUTE ON FUNCTION public.reciprocity_multiplier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reciprocity_multiplier(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.enforce_intro_allowance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _plan text;
  _allowance int;
  _used int;
  _cap int;
BEGIN
  IF _uid IS NULL THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' AND NEW.status = 'pending') OR (TG_OP = 'UPDATE' AND OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending') THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.verification_status = 'verified' AND p.verification_decided_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Verification required before you may send introductions' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'pending' THEN RETURN NEW; END IF;
  SELECT e.plan_code, e.intro_requests INTO _plan, _allowance FROM public.entitlement(NEW.sender_id) e;
  IF _plan IS NULL OR _plan = 'free' THEN RETURN NEW; END IF;
  IF _allowance IS NULL THEN RETURN NEW; END IF;
  _cap := least(greatest(round(_allowance * public.reciprocity_multiplier(NEW.sender_id)), 5), round(_allowance * 1.5));
  SELECT count(*) INTO _used
  FROM public.interests i
  JOIN public.subscriptions s ON s.user_id = NEW.sender_id AND s.status IN ('authenticated', 'active', 'pending')
  WHERE i.sender_id = NEW.sender_id AND i.status <> 'declined'
    AND i.created_at >= coalesce(s.period_start, now() - interval '30 days')
    AND (TG_OP = 'INSERT' OR i.id <> NEW.id);
  IF _used >= _cap THEN
    RAISE EXCEPTION 'Monthly introduction allowance used (% of % this period) — answer more introductions to earn reach, or upgrade', _used, _cap USING ERRCODE = '45000';
  END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.enforce_interest_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _outstanding int;
  _cap int;
BEGIN
  IF auth.uid() IS NULL OR NEW.status <> 'pending' THEN RETURN NEW; END IF;
  _cap := least(greatest(round(5 * public.reciprocity_multiplier(NEW.sender_id))::int, 3), 7);
  SELECT count(*) INTO _outstanding FROM public.interests WHERE sender_id = NEW.sender_id AND status = 'pending' AND id <> NEW.id;
  IF _outstanding >= _cap THEN
    RAISE EXCEPTION 'At most % outstanding introductions — answer what you have or withdraw one', _cap USING ERRCODE = '45000';
  END IF;
  RETURN NEW;
END; $$;
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS handled_by uuid,
  ADD COLUMN IF NOT EXISTS handled_at timestamptz;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_status_valid;
ALTER TABLE public.reports ADD CONSTRAINT reports_status_valid CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed'));
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_outcome_valid;
ALTER TABLE public.reports ADD CONSTRAINT reports_outcome_valid CHECK (outcome IS NULL OR outcome IN ('no_action', 'warning_sent', 'profile_hidden', 'account_suspended', 'referred_to_desk'));
CREATE OR REPLACE FUNCTION public.desk_update_report(_id uuid, _status text, _outcome text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.reports;
BEGIN
  IF _uid IS NULL OR NOT private.is_admin() THEN
    RAISE EXCEPTION 'Membership desk only' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('open', 'in_review', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Unknown report status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.reports
     SET status = _status, outcome = CASE WHEN _status IN ('resolved', 'dismissed') THEN _outcome END,
         resolution_note = _note, handled_by = _uid, handled_at = now()
   WHERE id = _id RETURNING * INTO _row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002'; END IF;
  IF _status = 'resolved' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_row.reporter_id, 'report_resolved', 'Your report was actioned', 'The membership desk reviewed your report and took action. Thank you for making the Circle safer.', '/dashboard');
  ELSIF _status = 'dismissed' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_row.reporter_id, 'report_resolved', 'Your report was reviewed', 'The membership desk reviewed your report. No further action was needed.', '/dashboard');
  END IF;
END; $$;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid CHECK (kind IN (
  'interest_received', 'interest_accepted', 'interest_declined', 'interest_expired', 'interest_reminder', 'copilot_invite_accepted', 'verification_approved',
  'verification_resubmission', 'verification_rejected', 'suggestion_received', 'message_received', 'call_missed', 'report_resolved'));
DROP FUNCTION IF EXISTS public.desk_reports(int);
CREATE FUNCTION public.desk_reports(_limit int DEFAULT 200)
RETURNS TABLE (id uuid, reason text, created_at timestamptz, reporter_id uuid, reporter_name text, reported_profile_id uuid, reported_name text, reported_visible boolean, status text, outcome text, resolution_note text, handled_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Membership desk only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT r.id, r.reason, r.created_at, r.reporter_id, coalesce(rp.full_name, 'Member'),
           r.reported_profile_id, coalesce(tp.full_name, 'Member'), coalesce(tp.is_visible, false),
           r.status, r.outcome, r.resolution_note, r.handled_at
    FROM public.reports r
    LEFT JOIN public.profiles rp ON rp.id = r.reporter_id
    LEFT JOIN public.profiles tp ON tp.id = r.reported_profile_id
    ORDER BY (r.status = 'open') DESC, r.created_at DESC
    LIMIT greatest(1, least(coalesce(_limit, 200), 500));
END; $$;
REVOKE EXECUTE ON FUNCTION public.desk_reports(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desk_reports(int) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.desk_network_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _result jsonb;
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Membership desk only' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'generated_at', now(),
    'verified_by_status', (SELECT coalesce(jsonb_object_agg(verification_status, n), '{}'::jsonb) FROM (SELECT verification_status, count(*) n FROM public.profiles GROUP BY 1) s),
    'verified_gender_split', (SELECT coalesce(jsonb_object_agg(coalesce(gender, 'unstated'), n), '{}'::jsonb) FROM (SELECT gender, count(*) n FROM public.profiles WHERE verification_status='verified' GROUP BY 1) s),
    'verified_last_7d', (SELECT count(*) FROM public.profiles WHERE verification_status='verified' AND created_at > now() - interval '7 days'),
    'reply_rate', (SELECT round(avg(CASE WHEN status IN ('accepted','declined','blocked') THEN 1.0 ELSE 0 END)::numeric, 3) FROM public.interests WHERE created_at > now() - interval '30 days' AND (status <> 'pending' OR expires_at < now())),
    'median_hours_to_reply', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (decided_at - created_at))) / 3600)::numeric, 1) FROM public.interests WHERE status IN ('accepted','declined','blocked') AND decided_at IS NOT NULL AND decided_at > now() - interval '30 days'),
    'open_reports', (SELECT count(*) FROM public.reports WHERE status IN ('open','in_review')),
    'unanswered_pending_interests', (SELECT count(*) FROM public.interests WHERE status='pending' AND expires_at < now() + interval '3 days')
  ) INTO _result;
  RETURN _result;
END; $$;
REVOKE EXECUTE ON FUNCTION public.desk_network_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desk_network_health() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.desk_update_report(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desk_update_report(uuid, text, text, text) TO authenticated, service_role;
DROP POLICY IF EXISTS "Desk updates reports" ON public.reports;
CREATE POLICY "Desk updates reports" ON public.reports FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());