-- ===========================================================================
-- 20261010 — Phase 2 fix batch, part 2: regression assertions.
-- Each block raises on the exact bug Phase 1 reported, so a future migration
-- that re-opens a hole fails loudly at migrate time instead of shipping it.
-- Pure DO blocks: no schema change, no data change, safe to re-apply.
-- ===========================================================================

-- C-2: no unpaid checkout may entitle. (Any 'created' row present is legacy
-- data; the assertion is on the function body, not the rows.)
DO $$
DECLARE
  _body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _body
  FROM pg_proc WHERE proname = 'entitlement' AND pronamespace = 'public'::regnamespace;
  IF _body IS NULL OR _body LIKE '%''created''%' THEN
    RAISE EXCEPTION 'REGRESSION: entitlement() must not reference status created';
  END IF;
END $$;

-- C-3: my_profile must expose both restored columns.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'my_profile'
      AND column_name = 'verification_doc_path'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: my_profile is missing verification_doc_path';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'my_profile'
      AND column_name = 'show_profile_views'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: my_profile is missing show_profile_views';
  END IF;
END $$;

-- H-2: no member INSERT policy may remain on notifications.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications' AND cmd = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: member INSERT policy on notifications is back';
  END IF;
END $$;

-- M-3: the permissive copilot-claim policy must stay gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'copilots'
      AND policyname = 'Copilot accepts own invite'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: Copilot accepts own invite policy is back';
  END IF;
END $$;

-- C-1: the allowance gate must exist on the send path.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'interests_allowance'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: interests_allowance trigger is missing';
  END IF;
END $$;

-- H-1: 'blocked' must be a legal terminal state.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints c
    JOIN information_schema.constraint_column_usage u
      ON u.constraint_name = c.constraint_name
    WHERE c.constraint_name = 'interests_status_valid'
      AND u.table_name = 'interests'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: interests_status_valid constraint is missing';
  END IF;
END $$;
