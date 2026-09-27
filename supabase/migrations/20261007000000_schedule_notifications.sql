-- ===========================================================================
-- 20261007: Schedule the outbound notification jobs.
--
-- Two schedules, both deliberately coarse:
--   * the dispatcher runs every five minutes so a queued alert lands quickly;
--   * the digest builder runs once a week, early on Monday, so the email
--     arrives during waking hours in the member's own timezone.
--
-- The digest time is written in UTC. Members in India see it around midday on
-- Monday, which is the intent; an hour-by-hour per-timezone send is far more
-- machinery than a weekly summary earns.
--
-- pg_cron calls the function over HTTP, so it needs the project URL and a
-- service key. Both are read from Vault rather than written into a cron row,
-- because cron.job stores its command as plain text and a key committed
-- there is a key in the database forever.
--
-- Setup (one-off, outside this migration):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
--   select vault.create_secret('<random-32-bytes-hex>', 'cron_secret');
--   -- rotation only: select vault.create_secret('<old-secret>', 'cron_secret_previous');
-- and on the functions side (H-3):
--   supabase secrets set CRON_SECRET='<same-as-cron_secret>' \
--     CRON_SECRET_PREVIOUS='<same-as-cron_secret_previous>'
--
-- The schedule rows are inserted defensively: on an instance without pg_cron
-- or Vault the migration still applies, and both jobs can be triggered
-- manually from the function hooks instead.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Only schedule when the secrets are actually present; a cron row pointing at
-- a null URL would fail silently every five minutes, which is worse than not
-- scheduling at all.
DO $$
DECLARE
  _ready boolean;
BEGIN
  SELECT count(*) = 2 INTO _ready
  FROM vault.decrypted_secrets
  WHERE name IN ('project_url', 'service_role_key');

  IF NOT _ready THEN
    RAISE NOTICE 'notification cron not scheduled: vault secrets project_url / service_role_key are missing.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not available; dispatch notify-dispatch and weekly-digest manually.';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notify-dispatch';
  PERFORM cron.schedule(
    'notify-dispatch',
    '*/5 * * * *',
    $job$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
               || '/functions/v1/notify-dispatch',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        -- Gateway JWT (unchanged): satisfies the function gateway's own
        -- verify_jwt. The X-Cron-Secret below is what the function itself
        -- checks (H-3); the two headers serve different layers on purpose.
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'X-Cron-Secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'), ''),
        'X-Cron-Previous', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret_previous'), '')
      ),
      body    := '{"limit": 25}'::jsonb
    )
    $job$
  );

  -- cron's day-of-week is 1-7 with 1 = Sunday, so Monday is 2.
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'weekly-digest';
  PERFORM cron.schedule(
    'weekly-digest',
    '30 6 * * 2',
    $job$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
               || '/functions/v1/weekly-digest',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        -- Gateway JWT (unchanged) + the X-Cron-Secret the function checks (H-3).
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'X-Cron-Secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'), ''),
        'X-Cron-Previous', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret_previous'), '')
      ),
      body    := '{}'::jsonb
    )
    $job$
  );
END $$;
