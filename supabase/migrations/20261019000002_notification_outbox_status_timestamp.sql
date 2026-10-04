-- ===========================================================================
-- 20261019002: F-08 — Add status_changed_at to notification_outbox.
--
-- notify-dispatch re-queues "stuck" rows by filtering on created_at, but the
-- intent is to re-queue rows that have been *in the sending state* for more
-- than 15 minutes. Using created_at means a row created 20 minutes ago and
-- only picked up 2 minutes ago gets incorrectly re-queued at the next run.
--
-- Fix: add status_changed_at, maintained by a trigger whenever status
-- changes. The stuck-row sweep in notify-dispatch is updated to filter on
-- this column instead of created_at.
-- ===========================================================================

-- 1. Add the column (nullable so existing rows are not forced to pick a value
--    immediately; the trigger backfills it on the next status change).
ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

-- 2. Backfill: for any existing 'sending' or 'queued' rows, set the column
--    to now() so they don't immediately look stuck.
UPDATE public.notification_outbox
SET status_changed_at = now()
WHERE status_changed_at IS NULL;

-- 3. Trigger that keeps status_changed_at fresh on every status update.
CREATE OR REPLACE FUNCTION public.outbox_stamp_status_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS notification_outbox_stamp_status ON public.notification_outbox;
CREATE TRIGGER notification_outbox_stamp_status
  BEFORE UPDATE ON public.notification_outbox
  FOR EACH ROW EXECUTE FUNCTION public.outbox_stamp_status_changed();

-- 4. Index so the dispatcher's stuck-row sweep is an index scan, not a seq scan.
CREATE INDEX IF NOT EXISTS idx_outbox_status_changed
  ON public.notification_outbox(status, status_changed_at)
  WHERE status = 'sending';

-- 5. Regression assertion.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'notification_outbox'
      AND column_name  = 'status_changed_at'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: status_changed_at column is missing from notification_outbox';
  END IF;
END $$;
