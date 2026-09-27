-- ===========================================================================
-- 20261006: Outbound notifications — transactional alerts + weekly digest.
--
-- Design notes
-- ------------
-- Nothing is sent synchronously from a user action. An action writes an
-- outbox row; a single dispatcher drains it. That keeps a provider outage
-- (WhatsApp down at 3am) from silently losing an alert, and it means a send
-- happens exactly once per row rather than once per retry of the action that
-- produced it.
--
-- Two tables, deliberately separate:
--   * notification_preferences — what the member WANTS sent. DPDP requires the
--     purpose and the channel to be a recorded, revocable choice.
--   * notification_outbox     — what still has to GO OUT. A delivery ledger.
--
-- Channel selection is preference-driven, and a member can be quiet on every
-- channel: transactional rows then fall back to in-app only, which already
-- exists and needs no consent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Preferences.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Transactional alerts (interest received/answered, verification decided,
  -- co-pilot accepted, call invite). Digests are governed separately.
  email_alerts boolean NOT NULL DEFAULT true,
  sms_alerts boolean NOT NULL DEFAULT false,
  whatsapp_alerts boolean NOT NULL DEFAULT false,
  -- The weekly digest is opt-in: promotional-shaped traffic, not an alert, so
  -- it must never be switched on implicitly.
  email_digest boolean NOT NULL DEFAULT false,
  -- A digest with nothing in it is a wasted send and an unsubscribe trigger.
  digest_skip_when_empty boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own notification preferences" ON public.notification_preferences;
CREATE POLICY "Own notification preferences" ON public.notification_preferences FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Every member gets a preference row, so the dispatcher never has to treat a
-- missing row as "opted out". Defaults come from the column defaults, so an
-- absent row is the same as the row we would have inserted.
INSERT INTO public.notification_preferences (user_id)
SELECT p.id FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Outbox.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Dedupe key: re-running the triggering action (a retried request, a
  -- replayed webhook) must not produce a second alert.
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
  -- A row that exhausts its retries is parked as 'failed' for the desk rather
  -- than retried forever.
  CONSTRAINT notification_outbox_attempts_valid CHECK (attempts >= 0 AND attempts <= 10),
  CONSTRAINT notification_outbox_one_per_key UNIQUE (idempotency_key, channel)
);

-- The dispatcher's hot path is "queued rows that are due", oldest first.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
  ON public.notification_outbox(status, scheduled_for)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_notification_outbox_user
  ON public.notification_outbox(user_id, created_at DESC);

GRANT SELECT ON public.notification_outbox TO authenticated;
GRANT ALL ON public.notification_outbox TO service_role;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- A member may see what was sent to them (it is their data) but must never be
-- able to write, reschedule or retry it.
DROP POLICY IF EXISTS "Own outbox read" ON public.notification_outbox;
CREATE POLICY "Own outbox read" ON public.notification_outbox FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Channel resolution. Preferences decide; the outbox just executes.
-- ---------------------------------------------------------------------------
-- 'in_app' is deliberately NOT returned: the in-app row is written by the
-- caller at the same time, and in-app needs no consent because it lands in
-- the member's own authenticated session.
--
-- SECURITY DEFINER so the preference table is readable even though it is
-- not exposed to anon, and so this can be called from the enqueue function.
CREATE OR REPLACE FUNCTION public.notification_channels_for(_user uuid, _template text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.channel
  FROM (VALUES ('email'), ('sms'), ('whatsapp')) AS c(channel)
  LEFT JOIN public.notification_preferences p ON p.user_id = _user
  WHERE CASE c.channel
    WHEN 'email' THEN
      -- Digests are opt-in; alerts are opt-out.
      CASE WHEN _template = 'weekly_digest'
        THEN coalesce(p.email_digest, false)
        ELSE coalesce(p.email_alerts, true)
      END
    WHEN 'sms' THEN _template <> 'weekly_digest' AND coalesce(p.sms_alerts, false)
    WHEN 'whatsapp' THEN _template <> 'weekly_digest' AND coalesce(p.whatsapp_alerts, false)
  END
$$;

REVOKE EXECUTE ON FUNCTION public.notification_channels_for(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_channels_for(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Enqueue. The single write path into the outbox.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so a workflow can queue a message to a recipient without a
-- service key. The recipient is passed explicitly, but the function is only
-- ever invoked from server-side code (edge functions / service role), never
-- from the browser: an authenticated member calling this directly would
-- otherwise be able to queue mail for an arbitrary user_id.
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  _user uuid,
  _template text,
  _payload jsonb DEFAULT '{}'::jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _key text;
  _queued int := 0;
  _channel text;
BEGIN
  IF _user IS NULL OR _template IS NULL THEN
    RETURN 0;
  END IF;

  -- Without an explicit key, collapse repeats of the same template+payload
  -- within the same day into one alert.
  _key := coalesce(
    _idempotency_key,
    _template || ':' || md5(_user::text || _payload::text || current_date::text)
  );

  FOR _channel IN SELECT unnest(public.notification_channels_for(_user, _template)) LOOP
    INSERT INTO public.notification_outbox (user_id, idempotency_key, channel, template, payload)
    VALUES (_user, _key, _channel, _template, _payload)
    ON CONFLICT (idempotency_key, channel) DO NOTHING;
    IF FOUND THEN
      _queued := _queued + 1;
    END IF;
  END LOOP;

  RETURN _queued;
END; $$;

-- Deliberately NOT granted to `authenticated`: this is a server-side write
-- path. The browser only ever writes in-app notification rows.
REVOKE EXECUTE ON FUNCTION public.enqueue_notification(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(uuid, text, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Due-row claim for the dispatcher.
-- ---------------------------------------------------------------------------
-- SKIP LOCKED is the whole point: several dispatcher invocations can run at
-- once (a cron overlap, a manual retry) without ever handing the same row to
-- two workers.
CREATE OR REPLACE FUNCTION public.claim_due_notifications(_limit int DEFAULT 25)
RETURNS SETOF public.notification_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH due AS (
    SELECT id
    FROM public.notification_outbox
    WHERE status = 'queued' AND scheduled_for <= now()
    ORDER BY scheduled_for
    LIMIT greatest(1, least(_limit, 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_outbox o
  SET status = 'sending', attempts = o.attempts + 1
  FROM due
  WHERE o.id = due.id
  RETURNING o.*;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_due_notifications(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_notifications(int) TO service_role;

-- Resolve a dispatched row to a terminal state. Centralised so the caller
-- cannot accidentally leave a row stuck in 'sending'.
CREATE OR REPLACE FUNCTION public.finish_notification(
  _id uuid,
  _ok boolean,
  _error text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.notification_outbox
  SET status = CASE
        WHEN _ok THEN 'sent'
        -- Give up after the attempt cap; the desk sees the last error.
        WHEN attempts >= 10 THEN 'failed'
        ELSE 'queued'
      END,
      sent_at = CASE WHEN _ok THEN now() ELSE NULL END,
      last_error = CASE WHEN _ok THEN NULL ELSE left(_error, 500) END,
      -- Backoff: 30s, 1m, 2m, 4m ... capped at an hour. A provider outage
      -- therefore does not become a tight retry loop.
      scheduled_for = CASE
        WHEN _ok THEN scheduled_for
        ELSE now() + make_interval(secs => least(3600, 30 * power(2, greatest(attempts - 1, 0))::int))
      END
  WHERE id = _id AND status = 'sending';
END; $$;

REVOKE EXECUTE ON FUNCTION public.finish_notification(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_notification(uuid, boolean, text) TO service_role;
