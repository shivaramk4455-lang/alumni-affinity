CREATE TABLE IF NOT EXISTS public.deletion_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  policy_version text NOT NULL,
  purposes text[] NOT NULL DEFAULT '{}',
  storage_objects_removed int NOT NULL DEFAULT 0,
  auth_deleted boolean NOT NULL DEFAULT false,
  note text
);
CREATE INDEX IF NOT EXISTS idx_deletion_receipts_user ON public.deletion_receipts(user_id, deleted_at DESC);
GRANT ALL ON public.deletion_receipts TO service_role;
REVOKE ALL ON public.deletion_receipts FROM authenticated, anon, PUBLIC;
ALTER TABLE public.deletion_receipts ENABLE ROW LEVEL SECURITY;