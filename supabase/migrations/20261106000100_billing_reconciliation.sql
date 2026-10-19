-- ===========================================================================
-- 20261106 (2/2): Billing reconciliation — stop charging people who left, and
-- end a subscription whose terminal webhook never arrived.
--
-- TWO DEFECTS THIS CLOSES
--
-- 1. DELETION DID NOT CANCEL THE MANDATE (the worst bug in the audit).
--    `delete-account` deletes the profile; `subscriptions.user_id` was
--    `REFERENCES public.profiles(id) ON DELETE CASCADE`, so the billing row
--    vanished with it. The webhook then found nothing, answered
--    200 {reason:"unknown_subscription"}, and Razorpay stopped retrying — while
--    the saved mandate kept debiting a member who no longer had an account, and
--    no record of the subscription id survived to cancel it.
--
--    The FK becomes ON DELETE SET NULL and the row becomes a tombstone. It
--    holds no member PII — no name, e-mail or phone — only the provider handle
--    needed to stop the debit. That is the minimum retention that makes erasure
--    safe, and the reconcile job below drains it by calling the Razorpay cancel
--    API. The member's data is still fully removed.
--
-- 2. A LOST TERMINAL WEBHOOK ENTITLED FOREVER.
--    20261106000000 made the live predicate check `period_end`, so a lapsed row
--    stops entitling immediately. This migration finishes the job: it moves
--    lapsed rows to the terminal `expired` state on a schedule, so the row the
--    desk looks at matches the access the member actually has.
--
-- SAFE DEFAULT (product decision, flagged): a lapsed period ends access at
-- `period_end`, with no grace window. The alternative — a grace period — would
-- keep granting a paid allowance for a period nobody paid for, which is the bug
-- being fixed. If the desk wants a grace window, add it to the predicate in
-- 20261106000000, not here.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The FK: cascade -> set null, so erasure cannot destroy the only record of
--    a live debit. `user_id` becoming nullable is what makes the tombstone
--    expressible; the existing RLS policy (`auth.uid() = user_id`) evaluates to
--    NULL for these rows, so they are invisible to every member — including the
--    member themselves — without a policy change.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. What the webhook needs in order to reconcile money against an event.
--    Without these, a refund could not be tied back to a subscription: a
--    `refund.processed` payload carries a payment id, not a subscription id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_invoice_id text,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id text,
  ADD COLUMN IF NOT EXISTS amount_paid_paise integer,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'subscriptions_amount_paid_nonneg'
      AND c.conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_amount_paid_nonneg
      CHECK (amount_paid_paise IS NULL OR amount_paid_paise >= 0);
  END IF;
END $$;

-- Refund and dispute payloads identify the subscription only through the
-- invoice/payment pair, so both lookups need an index.
CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay_invoice
  ON public.subscriptions(razorpay_invoice_id)
  WHERE razorpay_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay_payment
  ON public.subscriptions(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

-- The reconcile jobs scan for lapsed and orphaned rows; without this they are
-- sequential scans on a table that grows with every checkout attempt.
CREATE INDEX IF NOT EXISTS idx_subscriptions_reconcile
  ON public.subscriptions(status, period_end)
  WHERE status IN ('active', 'authenticated', 'pending');

-- ---------------------------------------------------------------------------
-- 3. Lapsed -> expired. Pure SQL, so it needs no secret and can be scheduled
--    unconditionally (unlike the HTTP drain below).
--    FOR UPDATE SKIP LOCKED so two overlapping runs cannot both claim a row;
--    GET DIAGNOSTICS into its own variable (cf. the accumulator bug fixed in
--    20261101000000:419), so the count returned is the count actually moved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _expired int := 0;
BEGIN
  WITH lapsed AS (
    SELECT s.id
    FROM public.subscriptions s
    WHERE s.status IN ('active', 'authenticated', 'pending')
      AND s.period_end IS NOT NULL
      AND s.period_end <= now()
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.subscriptions s
  SET status = 'expired',
      updated_at = now(),
      last_event_at = now()
  FROM lapsed
  WHERE s.id = lapsed.id;

  GET DIAGNOSTICS _expired = ROW_COUNT;
  RETURN _expired;
END; $$;

REVOKE EXECUTE ON FUNCTION public.expire_lapsed_subscriptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_lapsed_subscriptions() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Orphaned rows: the member's account is gone but the mandate may still be
--    live at the provider. The razorpay-cancel function drains these when it is
--    called with the cron secret (see supabase/functions/razorpay-cancel).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orphaned_subscriptions()
RETURNS TABLE (id uuid, razorpay_subscription_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.razorpay_subscription_id
  FROM public.subscriptions s
  WHERE s.user_id IS NULL
    AND s.status IN ('active', 'authenticated', 'pending')
  ORDER BY s.updated_at
  LIMIT 25
$$;

REVOKE EXECUTE ON FUNCTION public.orphaned_subscriptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orphaned_subscriptions() TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The deletion receipt must record what happened to the billing
--    relationship. A receipt that says the account was deleted while the debit
--    continued is evidence of the wrong thing.
-- ---------------------------------------------------------------------------
ALTER TABLE public.deletion_receipts
  ADD COLUMN IF NOT EXISTS billing_cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_note text;

-- ---------------------------------------------------------------------------
-- 6. Schedules.
--    The pure-SQL expiry is scheduled unconditionally. The HTTP drain needs the
--    project URL and the cron secret from Vault, so it is scheduled only when
--    they exist — and says so loudly when they do not, instead of failing
--    silently (the trap 20261101000000:451 fell into with RAISE NOTICE).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE WARNING
      'pg_cron is not installed, so expire-lapsed-subscriptions is NOT scheduled. Call public.expire_lapsed_subscriptions() manually or from an external scheduler.';
  ELSE
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-lapsed-subscriptions') THEN
      PERFORM cron.unschedule('expire-lapsed-subscriptions');
    END IF;
    PERFORM cron.schedule(
      'expire-lapsed-subscriptions',
      '7 * * * *',
      $job$SELECT public.expire_lapsed_subscriptions()$job$
    );

    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-orphaned-subscriptions') THEN
      IF to_regclass('vault.decrypted_secrets') IS NOT NULL
         AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url')
         AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      THEN
        PERFORM cron.schedule(
          'reconcile-orphaned-subscriptions',
          '23 * * * *',
          $job$
          SELECT net.http_post(
            url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
                   || '/functions/v1/razorpay-cancel',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
            ),
            body := '{"mode":"reconcile-orphans"}'::jsonb
          )
          $job$
        );
      ELSE
        RAISE WARNING
          'Vault secrets project_url / cron_secret are missing, so reconcile-orphaned-subscriptions is NOT scheduled. Until it runs, a member deleted while holding a live mandate is not cancelled at the provider. See DEPLOYMENT.md section 5.';
      END IF;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Fail-loud regression assertions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _delete_rule text;
  _nullable text;
BEGIN
  -- The FK must not cascade: a cascade is exactly how the billing record was
  -- destroyed while the mandate lived on.
  SELECT rc.delete_rule INTO _delete_rule
  FROM information_schema.referential_constraints rc
  WHERE rc.constraint_name = 'subscriptions_user_id_fkey'
    AND rc.constraint_schema = 'public';

  IF _delete_rule IS DISTINCT FROM 'SET NULL' THEN
    RAISE EXCEPTION
      'REGRESSION: subscriptions_user_id_fkey must be ON DELETE SET NULL (found: %)', coalesce(_delete_rule, 'missing');
  END IF;

  IF _delete_rule = 'CASCADE' THEN
    RAISE EXCEPTION 'REGRESSION: a cascade here destroys the only record of a live debit';
  END IF;

  -- And user_id must stay nullable, or the tombstone cannot exist.
  SELECT is_nullable INTO _nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'user_id';

  IF _nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'REGRESSION: subscriptions.user_id must be nullable for the orphan tombstone';
  END IF;

  -- The members must not be able to invoke the maintenance jobs.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('expire_lapsed_subscriptions', 'orphaned_subscriptions')
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'REGRESSION: billing maintenance functions must be service_role only';
  END IF;
END $$;
