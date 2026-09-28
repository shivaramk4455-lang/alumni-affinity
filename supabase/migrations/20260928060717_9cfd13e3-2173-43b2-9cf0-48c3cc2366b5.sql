CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_alerts boolean NOT NULL DEFAULT true,
  sms_alerts boolean NOT NULL DEFAULT false,
  whatsapp_alerts boolean NOT NULL DEFAULT false,
  email_digest boolean NOT NULL DEFAULT false,
  digest_skip_when_empty boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own notification preferences" ON public.notification_preferences;
CREATE POLICY "Own notification preferences" ON public.notification_preferences FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  channel text NOT NULL,
  template text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_channel_valid CHECK (channel IN ('email','sms','whatsapp')),
  CONSTRAINT notification_outbox_status_valid CHECK (status IN ('queued','sending','sent','failed')),
  CONSTRAINT notification_outbox_attempts_valid CHECK (attempts >= 0 AND attempts <= 10),
  CONSTRAINT notification_outbox_one_per_key UNIQUE (idempotency_key, channel)
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_due ON public.notification_outbox(status, scheduled_for) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_notification_outbox_user ON public.notification_outbox(user_id, created_at DESC);
GRANT SELECT ON public.notification_outbox TO authenticated;
GRANT ALL ON public.notification_outbox TO service_role;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own outbox read" ON public.notification_outbox;
CREATE POLICY "Own outbox read" ON public.notification_outbox FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE OR REPLACE FUNCTION public.notification_channels_for(_user uuid, _template text)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(c.channel ORDER BY c.channel), '{}'::text[])
  FROM (VALUES ('email'), ('sms'), ('whatsapp')) AS c(channel)
  LEFT JOIN public.notification_preferences p ON p.user_id = _user
  WHERE CASE c.channel
    WHEN 'email' THEN CASE WHEN _template = 'weekly_digest' THEN coalesce(p.email_digest, false) ELSE coalesce(p.email_alerts, true) END
    WHEN 'sms' THEN _template <> 'weekly_digest' AND coalesce(p.sms_alerts, false)
    WHEN 'whatsapp' THEN _template <> 'weekly_digest' AND coalesce(p.whatsapp_alerts, false)
  END
$$;
REVOKE EXECUTE ON FUNCTION public.notification_channels_for(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_channels_for(uuid, text) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.enqueue_notification(_user uuid, _template text, _payload jsonb DEFAULT '{}'::jsonb, _idempotency_key text DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _key text;
  _queued int := 0;
  _channel text;
BEGIN
  IF _user IS NULL OR _template IS NULL THEN RETURN 0; END IF;
  _key := coalesce(_idempotency_key, _template || ':' || md5(_user::text || _payload::text || current_date::text));
  FOR _channel IN SELECT unnest(public.notification_channels_for(_user, _template)) LOOP
    INSERT INTO public.notification_outbox (user_id, idempotency_key, channel, template, payload)
    VALUES (_user, _key, _channel, _template, _payload)
    ON CONFLICT (idempotency_key, channel) DO NOTHING;
    IF FOUND THEN _queued := _queued + 1; END IF;
  END LOOP;
  RETURN _queued;
END; $$;
REVOKE EXECUTE ON FUNCTION public.enqueue_notification(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(uuid, text, jsonb, text) TO service_role;
CREATE OR REPLACE FUNCTION public.claim_due_notifications(_limit int DEFAULT 25)
RETURNS SETOF public.notification_outbox LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH due AS (
    SELECT id FROM public.notification_outbox
    WHERE status = 'queued' AND scheduled_for <= now()
    ORDER BY scheduled_for
    LIMIT greatest(1, least(_limit, 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_outbox o SET status = 'sending', attempts = o.attempts + 1
  FROM due WHERE o.id = due.id RETURNING o.*;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_due_notifications(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_notifications(int) TO service_role;
CREATE OR REPLACE FUNCTION public.finish_notification(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.notification_outbox
  SET status = CASE WHEN _ok THEN 'sent' WHEN attempts >= 10 THEN 'failed' ELSE 'queued' END,
      sent_at = CASE WHEN _ok THEN now() ELSE NULL END,
      last_error = CASE WHEN _ok THEN NULL ELSE left(_error, 500) END,
      scheduled_for = CASE WHEN _ok THEN scheduled_for ELSE now() + make_interval(secs => least(3600, 30 * power(2, greatest(attempts - 1, 0))::int)) END
  WHERE id = _id AND status = 'sending';
END; $$;
REVOKE EXECUTE ON FUNCTION public.finish_notification(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_notification(uuid, boolean, text) TO service_role;