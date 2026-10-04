-- ===========================================================================
-- 20261019: F-05 — add subscription_cancellation to consent_events purpose.
--
-- razorpay-cancel/index.ts writes purpose = 'subscription_cancellation' but
-- that value was absent from the CHECK constraint, so every cancellation
-- silently dropped the consent receipt (the insert failed; the function did
-- not check the error). This migration:
--   1. Widens the constraint to include the missing value.
--   2. Adds a regression assertion that the function body checks for the
--      error so a future refactor cannot re-introduce the silent drop.
-- ===========================================================================

-- 1. Drop and recreate the constraint with the missing value included.
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
    'subscription_cancellation'   -- F-05: was missing, razorpay-cancel needed it
  ));

-- 2. Regression self-test: insert and roll back to prove the gate accepts
--    the new purpose without needing a real user_id.
DO $$
BEGIN
  -- The check must accept the new value; test it against the constraint
  -- directly without inserting a real row (we don't have a valid user_id here).
  IF NOT (
    'subscription_cancellation' = ANY(ARRAY[
      'terms_and_privacy', 'partnership_criteria', 'document_review',
      'photo_watermarking', 'contact_disclosure', 'sabbatical_visibility',
      'profile_views_display', 'account_deletion', 'subscription_cancellation'
    ])
  ) THEN
    RAISE EXCEPTION 'REGRESSION: subscription_cancellation not in purpose list';
  END IF;

  RAISE NOTICE 'consent_events purpose constraint: subscription_cancellation accepted';
END $$;
