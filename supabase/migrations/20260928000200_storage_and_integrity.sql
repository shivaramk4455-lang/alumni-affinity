-- Storage limits and referential integrity.
--
--   1. The private buckets were created with no size or MIME restrictions, so a
--      member could store an arbitrarily large file, or any content type, while
--      the UI promised "PDF, JPG or PNG up to 10 MB".
--   2. Nothing referenced public.profiles, so deleting an account orphaned every
--      interest, co-pilot, report and notification that mentioned it — which the
--      grievance policy promises to delete.

-- ---------------------------------------------------------------------------
-- 1. Bucket limits. Buckets may already exist (created by an earlier
--    migration), so only the limits are set here — no INSERT.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png']
 WHERE id = 'profile-photos';

UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']
 WHERE id = 'verification-docs';

-- ---------------------------------------------------------------------------
-- 2. Orphan cleanup. Pre-existing rows whose profile is gone would block the
--    constraints below (e.g. a report filed against a random uuid).
-- ---------------------------------------------------------------------------
DO $$
DECLARE _n bigint;
BEGIN
  DELETE FROM public.reports r
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.reporter_id)
      OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.reported_profile_id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'reports: removed % orphan row(s)', _n;

  DELETE FROM public.notifications n
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = n.user_id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'notifications: removed % orphan row(s)', _n;

  DELETE FROM public.interests i
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = i.sender_id)
      OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = i.recipient_id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'interests: removed % orphan row(s)', _n;

  DELETE FROM public.copilot_recommendations c
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.candidate_id)
      OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.recommended_profile_id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'copilot_recommendations: removed % orphan row(s)', _n;

  DELETE FROM public.copilots c
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.candidate_id)
      OR (c.copilot_user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.copilot_user_id));
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'copilots: removed % orphan row(s)', _n;

  DELETE FROM public.saved_profiles s
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = s.user_id)
      OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = s.profile_id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'saved_profiles: removed % orphan row(s)', _n;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Foreign keys so deleting an account removes everything that referenced it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.interests DROP CONSTRAINT IF EXISTS interests_sender_fkey;
ALTER TABLE public.interests ADD CONSTRAINT interests_sender_fkey
  FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.interests DROP CONSTRAINT IF EXISTS interests_recipient_fkey;
ALTER TABLE public.interests ADD CONSTRAINT interests_recipient_fkey
  FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.copilots DROP CONSTRAINT IF EXISTS copilots_candidate_fkey;
ALTER TABLE public.copilots ADD CONSTRAINT copilots_candidate_fkey
  FOREIGN KEY (candidate_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.copilots DROP CONSTRAINT IF EXISTS copilots_user_fkey;
ALTER TABLE public.copilots ADD CONSTRAINT copilots_user_fkey
  FOREIGN KEY (copilot_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.copilot_recommendations DROP CONSTRAINT IF EXISTS copilot_rec_candidate_fkey;
ALTER TABLE public.copilot_recommendations ADD CONSTRAINT copilot_rec_candidate_fkey
  FOREIGN KEY (candidate_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.copilot_recommendations DROP CONSTRAINT IF EXISTS copilot_rec_profile_fkey;
ALTER TABLE public.copilot_recommendations ADD CONSTRAINT copilot_rec_profile_fkey
  FOREIGN KEY (recommended_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reporter_fkey;
ALTER TABLE public.reports ADD CONSTRAINT reports_reporter_fkey
  FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reported_fkey;
ALTER TABLE public.reports ADD CONSTRAINT reports_reported_fkey
  FOREIGN KEY (reported_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_user_fkey;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.saved_profiles DROP CONSTRAINT IF EXISTS saved_profiles_user_fkey;
ALTER TABLE public.saved_profiles ADD CONSTRAINT saved_profiles_user_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.saved_profiles DROP CONSTRAINT IF EXISTS saved_profiles_profile_fkey;
ALTER TABLE public.saved_profiles ADD CONSTRAINT saved_profiles_profile_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. profiles.id -> auth.users.id. Seeded directory rows have no auth.users
--    counterpart, so backfill them with disabled placeholder accounts (empty
--    password, no identities: they can never sign in) before adding the FK.
--    If the placeholder insert is not possible on this Supabase version the FK
--    is skipped with a notice instead of failing the migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE _orphans int;
BEGIN
  SELECT count(*) INTO _orphans
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE u.id IS NULL;

  IF _orphans > 0 THEN
    BEGIN
      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      )
      SELECT p.id,
             '00000000-0000-0000-0000-000000000000'::uuid,
             'authenticated',
             'authenticated',
             'directory+' || replace(p.id::text, '-', '') || '@example.invalid',
             '',
             now(),
             '{"provider":"email","providers":["email"]}'::jsonb,
             jsonb_build_object('full_name', p.full_name, 'directory_seed', true),
             coalesce(p.created_at, now()),
             now()
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
       WHERE u.id IS NULL
      ON CONFLICT (id) DO NOTHING;
      RAISE NOTICE 'auth.users: backfilled placeholder account(s) for % seeded profile row(s)', _orphans;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'auth.users backfill skipped (%); profiles_id_fkey will not be added', SQLERRM;
    END;
  END IF;
END $$;

DO $$
DECLARE _orphans int;
BEGIN
  SELECT count(*) INTO _orphans
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE u.id IS NULL;

  IF _orphans = 0 THEN
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    RAISE NOTICE 'profiles_id_fkey added';
  ELSE
    RAISE NOTICE 'profiles_id_fkey skipped: % profile row(s) still have no auth.users counterpart', _orphans;
  END IF;
END $$;
