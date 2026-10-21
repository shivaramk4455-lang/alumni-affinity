-- ===========================================================================
-- Foreign keys, made safe to re-apply.
--
-- WHY THIS FILE WAS REVISED
--
-- 20260928000200 already adds every foreign key listed below, with identical
-- names and identical definitions. This file was a duplicate of that work.
--
-- Re-applying it was not harmless. Every statement was an unconditional
-- DROP CONSTRAINT + ADD CONSTRAINT, which re-validates the key against live
-- rows. On a populated database that means:
--
--   * a single row that violates a key aborts the whole migration, leaving
--     the chain half-applied; and
--   * profiles_id_fkey was re-added UNCONDITIONALLY, undoing the guard in
--     20260928000200 that deliberately skips the key when any profile row
--     still has no auth.users counterpart (the seeded directory rows are
--     backfilled with placeholder accounts, and that backfill can itself
--     fail). A database holding one such row could not apply this file at
--     all.
--
-- The production database's recorded history skips a block of files from
-- 2026-09-28/30 and db-push.yml applies the remainder with `--include-all`,
-- so this file CAN be applied to an already-migrated production database.
--
-- THE FIX
--
-- A key is added only when it is genuinely absent, and only when no live row
-- would violate it. On a fresh install the key is absent (the tables it
-- covers were dropped by the legacy teardown and recreated empty), so it is
-- added exactly as before. On an already-migrated database the key is already
-- present, so nothing is re-validated and nothing can abort the push.
-- ===========================================================================

DO $$
DECLARE
  -- table, column, constraint name, referenced table, ON DELETE action
  _specs text[][] := ARRAY[
    ARRAY['interests',              'sender_id',              'interests_sender_fkey',        'profiles', 'CASCADE'],
    ARRAY['interests',              'recipient_id',           'interests_recipient_fkey',     'profiles', 'CASCADE'],
    ARRAY['copilots',               'candidate_id',           'copilots_candidate_fkey',      'profiles', 'CASCADE'],
    ARRAY['copilots',               'copilot_user_id',        'copilots_user_fkey',           'profiles', 'SET NULL'],
    ARRAY['copilot_recommendations','candidate_id',           'copilot_rec_candidate_fkey',   'profiles', 'CASCADE'],
    ARRAY['copilot_recommendations','recommended_profile_id', 'copilot_rec_profile_fkey',     'profiles', 'CASCADE'],
    ARRAY['reports',                'reporter_id',            'reports_reporter_fkey',        'profiles', 'CASCADE'],
    ARRAY['reports',                'reported_profile_id',    'reports_reported_fkey',        'profiles', 'CASCADE'],
    ARRAY['notifications',          'user_id',                'notifications_user_fkey',      'profiles', 'CASCADE'],
    ARRAY['saved_profiles',         'user_id',                'saved_profiles_user_fkey',     'profiles', 'CASCADE'],
    ARRAY['saved_profiles',         'profile_id',             'saved_profiles_profile_fkey',  'profiles', 'CASCADE']
  ];
  _s text[];
  _orphans bigint;
BEGIN
  FOREACH _s SLICE 1 IN ARRAY _specs LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', _s[1])::regclass
        AND conname = _s[3]
    ) THEN
      RAISE NOTICE 'FK % already present — not re-validated', _s[3];
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM public.%I t
         WHERE t.%I IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.id = t.%I)',
      _s[1], _s[2], _s[4], _s[1], _s[2]
    ) INTO _orphans;

    IF _orphans > 0 THEN
      RAISE NOTICE 'FK % skipped: % orphan row(s) would violate it', _s[3], _orphans;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE %s',
      _s[1], _s[3], _s[2], _s[4], _s[5]
    );
    RAISE NOTICE 'FK % added', _s[3];
  END LOOP;

  -- profiles.id -> auth.users.id. Deliberately conditional, exactly like
  -- 20260928000200: a profile row with no auth.users counterpart must not
  -- block the chain, because the seeded directory rows are backfilled with
  -- placeholder accounts and that backfill can itself fail.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_id_fkey'
  ) THEN
    SELECT count(*) INTO _orphans
    FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);

    IF _orphans = 0 THEN
      ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
      RAISE NOTICE 'profiles_id_fkey added';
    ELSE
      RAISE NOTICE 'profiles_id_fkey skipped: % profile row(s) still have no auth.users counterpart', _orphans;
    END IF;
  ELSE
    RAISE NOTICE 'profiles_id_fkey already present — not re-validated';
  END IF;
END $$;
