-- ===========================================================================
-- 20261029: Deletion receipts — DPDP Section 12 evidence that survives the
-- cascade (follow-up to 20261004).
--
-- delete-account writes a consent_events(account_deletion) row and then
-- deletes the profile; the FK (user_id -> profiles ON DELETE CASCADE) eats
-- the receipt seconds later. The function comment admits it. That leaves no
-- proof a deletion happened, when, under which policy version, or what was
-- purged — exactly what DPDP grievance redress (Sections 13-14) asks for.
--
-- SAFE DEFAULT (product decision, flagged): a deletion_receipts ledger with
-- NO foreign key to profiles, written by the service role BEFORE the profile
-- delete. It holds no PII — only the fact of deletion, timestamps, policy
-- version, consent purposes on file, and purge counts. The member's data is
-- still fully removed (profiles row, storage objects, auth user, and every
-- cascaded table); only the receipt remains, which is the standard
-- hide-vs-delete split (cf. Shaadi.com: profile gone, transaction/fraud
-- records retained).
--
-- Existing users untouched: the table starts empty; past deletions (whose
-- receipts cascaded) cannot be reconstructed and are not backfilled.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.deletion_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Deliberately NO REFERENCES: this row must survive the profile delete.
  user_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  policy_version text NOT NULL,
  -- Consent purposes the member held (from consent_events at delete time),
  -- so a later dispute can be answered without the cascaded ledger.
  purposes text[] NOT NULL DEFAULT '{}',
  -- What the function purged: storage objects removed, and whether the auth
  -- record was deleted.
  storage_objects_removed int NOT NULL DEFAULT 0,
  auth_deleted boolean NOT NULL DEFAULT false,
  note text
);

CREATE INDEX IF NOT EXISTS idx_deletion_receipts_user
  ON public.deletion_receipts(user_id, deleted_at DESC);

-- Desk-auditable only: no member-facing policies. The browser never reads
-- or writes this table; the delete-account function (service role) is the
-- sole writer, and the desk reads via service role.
GRANT ALL ON public.deletion_receipts TO service_role;
REVOKE ALL ON public.deletion_receipts FROM authenticated, anon, PUBLIC;

ALTER TABLE public.deletion_receipts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Regression assertions. Fail at migrate time, not in production.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- The receipt table must have NO FK to profiles: a CASCADE would re-create
  -- the self-destruct this migration removes.
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'deletion_receipts'
      AND tc.constraint_type = 'FOREIGN KEY'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: deletion_receipts must not reference profiles (cascade would eat receipts)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'deletion_receipts'
      AND column_name = 'deleted_at'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: deletion_receipts table is missing';
  END IF;
END $$;
