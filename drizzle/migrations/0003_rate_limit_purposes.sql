ALTER TABLE public.consent_events DROP CONSTRAINT IF EXISTS consent_events_purpose_valid;
ALTER TABLE public.consent_events
  ADD CONSTRAINT consent_events_purpose_valid
  CHECK (purpose IN (
    'terms_and_privacy','partnership_criteria','document_review','photo_watermarking',
    'contact_disclosure','sabbatical_visibility','profile_views_display','account_deletion',
    'subscription_cancellation','rate_limit_admin_review','rate_limit_turn_credentials',
    'rate_limit_subscription_cancel')) NOT VALID;