-- Desk review hardening: explicit decision audit trail and a formal decline outcome.
-- The desk (service role) records who decided and when; members still cannot self-approve.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_decided_by uuid;

-- Allow a formal decline in the member inbox.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid
  CHECK (kind IN (
    'interest_received',
    'interest_accepted',
    'interest_declined',
    'copilot_invite_accepted',
    'verification_approved',
    'verification_resubmission',
    'verification_rejected',
    'suggestion_received'
  ));

-- Members may (re)submit from unverified / needs_resubmission / rejected.
-- Every other verification column stays desk-only.
CREATE OR REPLACE FUNCTION public.guard_verified_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- Service-role / desk writes bypass the guard.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF _uid = OLD.id THEN
    -- Members may only move themselves into the review queue.
    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
      IF NOT (OLD.verification_status IN ('unverified', 'needs_resubmission', 'rejected')
              AND NEW.verification_status = 'pending_review') THEN
        RAISE EXCEPTION 'Verification decisions are made by the membership desk';
      END IF;
    END IF;
    IF NEW.alumni_email_verified IS DISTINCT FROM OLD.alumni_email_verified
       OR NEW.verification_note IS DISTINCT FROM OLD.verification_note
       OR NEW.verification_decided_at IS DISTINCT FROM OLD.verification_decided_at
       OR NEW.verification_decided_by IS DISTINCT FROM OLD.verification_decided_by
       OR NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Verification fields can only be set by the membership desk';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_guard_verified ON public.profiles;
CREATE TRIGGER profiles_guard_verified BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_columns();
