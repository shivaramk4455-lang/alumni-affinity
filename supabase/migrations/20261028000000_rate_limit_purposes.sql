-- ===========================================================================
-- 20261028: Ledger purposes for edge-function rate limiting.
--
-- The shared limiter (supabase/functions/_shared/rate-limit.ts) records one
-- consent_events row per accepted call as its cooldown key. Those purposes
-- must exist in the CHECK constraint or every throttled endpoint fails its
-- ledger insert. Rows are per-user timestamps only (granted=true, no PII in
-- note) and cascade with the profile on deletion.
-- ===========================================================================

ALTER TABLE public.consent_events DROP CONSTRAINT IF EXISTS consent_events_purpose_valid;

ALTER TABLE public.consent_events
  ADD CONSTRAINT consent_events_purpose_valid
  CHECK (purpose IN (
    'terms_and_privacy',
    'partnership_criteria',
    'document_review',
    'photo_watermarking',
    'contact_disclosure',
    'sabbatical_visibility',
    'profile_views_display',
    'account_deletion',
    'subscription_cancellation',
    'rate_limit_admin_review',
    'rate_limit_turn_credentials',
    'rate_limit_subscription_cancel'
  ));

-- Regression self-test: the limiter purposes must be accepted.
DO $$
BEGIN
  FOR i IN 1..3 LOOP
    IF NOT (CASE i
      WHEN 1 THEN 'rate_limit_admin_review'
      WHEN 2 THEN 'rate_limit_turn_credentials'
      ELSE 'rate_limit_subscription_cancel'
    END = ANY(ARRAY[
      'terms_and_privacy', 'partnership_criteria', 'document_review',
      'photo_watermarking', 'contact_disclosure', 'sabbatical_visibility',
      'profile_views_display', 'account_deletion', 'subscription_cancellation',
      'rate_limit_admin_review', 'rate_limit_turn_credentials',
      'rate_limit_subscription_cancel'
    ])) THEN
      RAISE EXCEPTION 'REGRESSION: rate-limit purpose % not in purpose list', i;
    END IF;
  END LOOP;
  RAISE NOTICE 'consent_events purpose constraint: rate-limit purposes accepted';
END $$;
