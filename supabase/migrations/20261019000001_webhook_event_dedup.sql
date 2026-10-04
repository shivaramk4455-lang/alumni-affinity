-- ===========================================================================
-- 20261019001: F-02 — Webhook event deduplication table.
--
-- Razorpay signs the body but does not include a timestamp or nonce in the
-- signature envelope, so a captured, validly-signed body is replayable
-- indefinitely. The existing row-level idempotence (UPDATE keyed on
-- razorpay_subscription_id) limits blast radius but does not prevent all
-- replay paths.
--
-- This migration adds a lightweight dedup table: the webhook handler checks
-- whether the incoming event.id has already been processed and, if so,
-- returns 200 immediately without touching the subscriptions table.
--
-- The table is intentionally write-only from the Edge Function (service role
-- only); no RLS SELECT policy is needed because no browser reads this table.
-- Rows are pruned to 90 days by a pg_cron job added below; at ~1000 events/
-- day that is ≤90 000 rows, well within normal Postgres range.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Razorpay event id from the envelope (event.id field). Unique prevents the
  -- second of two concurrent deliveries of the same event from proceeding.
  event_id     text        NOT NULL,
  -- The event type (e.g. 'subscription.activated'), for debugging.
  event_type   text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_event_id_key UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed
  ON public.webhook_events(processed_at DESC);

-- Only the service role may read or write. No member-facing policies needed.
GRANT ALL ON public.webhook_events TO service_role;
-- Explicitly revoke from authenticated so the browser cannot enumerate events.
REVOKE ALL ON public.webhook_events FROM authenticated, anon, PUBLIC;

-- Row-level security is enabled but no member policy is added: the table is
-- invisible to all browser sessions, accessible only to the service role.
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Prune rows older than 90 days. At ≤1 000 events/day that keeps the table
-- well under 90 000 rows. Scheduled daily at 03:00 UTC so it never competes
-- with the notify-dispatch cron.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not available; webhook_events pruning must be done manually.';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prune-webhook-events';
  PERFORM cron.schedule(
    'prune-webhook-events',
    '0 3 * * *',
    $$DELETE FROM public.webhook_events WHERE processed_at < now() - interval '90 days'$$
  );
END $$;

-- ---------------------------------------------------------------------------
-- Regression assertion: the unique constraint must be present.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'webhook_events'
      AND constraint_name = 'webhook_events_event_id_key'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: webhook_events unique constraint on event_id is missing';
  END IF;
END $$;
