-- ===========================================================================
-- Legacy teardown, made safe to re-apply.
--
-- WHY THIS FILE WAS REVISED
--
-- This migration was written to tear down a pre-2026-09-28 schema. On a
-- fresh install that is exactly what it does. But the production database's
-- recorded history skips a block of files from 2026-09-28/30 (suite-split
-- UUID renames), and db-push.yml applies the remainder with `--include-all`.
-- That means this file can be applied to a database that has ALREADY
-- migrated past it — and on that path it was destructive:
--
--   * DROP TABLE ... CASCADE removed the live public.messages,
--     public.notifications and public.reports tables together with every row
--     in them, plus public.desk_reports(int) (which depends on reports).
--     The migrations that recreate those tables (20260928055956,
--     20260928060420, 20260930000000) are already recorded on the production
--     database, so `db push` would never run them again: the tables would be
--     gone permanently, not just emptied.
--   * The DROP POLICY statements removed policies ("Admins read all
--     profiles", "Admin reads documents", "Admin reads photos") whose
--     replacements live in 20260928055956 — again, already recorded, so they
--     would never be recreated.
--   * The permissive directory policy this file created
--     (USING (onboarded AND is_visible)) ORs with the later verified-only
--     policy, because multiple permissive SELECT policies on one table are
--     OR'd together. Re-creating it would silently un-gate the directory.
--
-- THE FIX
--
-- The teardown is only meaningful on a database that still carries the
-- legacy schema. public.conversations is created by 20260928060420 — a
-- migration that comes AFTER this one — so it is an exact marker for "this
-- database has already migrated past the legacy schema". On a fresh install
-- it does not exist yet and the teardown runs exactly as before; on a
-- migrated database it exists and the teardown is skipped entirely.
--
-- The table drops additionally refuse to touch a table that holds rows, so
-- even a partially-migrated database keeps its data.
--
-- Nothing in this file is needed for the modern schema to be correct: every
-- object it drops is either recreated identically by 20260928055956 (reports
-- and notifications have byte-identical columns in both migrations) or never
-- existed in this chain at all (meetings, blocks, shortlists, user_roles).
-- ===========================================================================

DO $$
DECLARE
  _t text;
  _n bigint;
BEGIN
  -- Already past the legacy schema: every object this file tears down has a
  -- modern replacement whose migration is already recorded. Touching them
  -- would delete live rows and leave the schema permanently broken.
  IF to_regclass('public.conversations') IS NOT NULL THEN
    RAISE NOTICE 'legacy teardown skipped: public.conversations exists, so this database is already past the legacy schema';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS interests_notify ON public.interests;
  DROP TRIGGER IF EXISTS profiles_guard_verification ON public.profiles;
  DROP TRIGGER IF EXISTS profiles_notify_verification ON public.profiles;
  DROP POLICY IF EXISTS "Desk reads verification docs" ON storage.objects;
  DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;
  DROP POLICY IF EXISTS "Admins update profiles" ON public.profiles;
  DROP POLICY IF EXISTS "Verified members read the directory" ON public.profiles;

  -- The permissive directory policy is REMOVED, not re-created. It ORs with
  -- the verified-only policy that 20260928060826 installs, and because
  -- Postgres ORs multiple permissive SELECT policies together, leaving it in
  -- place would let any authenticated member read every onboarded profile
  -- including unverified ones. The verified-only policy is the intended
  -- directory gate.
  DROP POLICY IF EXISTS "Members read visible onboarded" ON public.profiles;

  -- Legacy tables. Each is dropped only when it holds no rows: an empty table
  -- is the fresh-install shape that 20260928055956 recreates, while a table
  -- with rows is live data that must survive.
  FOREACH _t IN ARRAY ARRAY[
    'messages', 'meetings', 'notifications', 'reports', 'blocks', 'shortlists', 'user_roles'
  ] LOOP
    IF to_regclass(format('public.%I', _t)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', _t) INTO _n;
    IF _n > 0 THEN
      RAISE NOTICE 'public.% retained: % row(s) present — legacy teardown of a populated table skipped', _t, _n;
    ELSE
      EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', _t);
    END IF;
  END LOOP;

  DROP FUNCTION IF EXISTS private.notify_interest() CASCADE;
  DROP FUNCTION IF EXISTS private.notify_message() CASCADE;
  DROP FUNCTION IF EXISTS private.notify_meeting() CASCADE;
  DROP FUNCTION IF EXISTS private.notify_verification() CASCADE;
  DROP FUNCTION IF EXISTS private.guard_verification() CASCADE;
  DROP FUNCTION IF EXISTS private.is_accepted_party(uuid, uuid) CASCADE;
  DROP FUNCTION IF EXISTS private.is_blocked_pair(uuid, uuid) CASCADE;
  -- Dropped without a signature on purpose: public.app_role is never created
  -- by this chain, and naming a non-existent type in a DROP FUNCTION argument
  -- list makes the statement depend on type resolution.
  DROP FUNCTION IF EXISTS public.has_role CASCADE;
  DROP TYPE IF EXISTS public.app_role;
END $$;
