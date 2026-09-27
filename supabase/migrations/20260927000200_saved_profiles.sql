-- Shortlists: a member's private tray of profiles they are considering before
-- reaching out. Owner-only, mirroring the reports table's policy shape.

CREATE TABLE IF NOT EXISTS public.saved_profiles (
  user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_profiles_pkey PRIMARY KEY (user_id, profile_id),
  CONSTRAINT saved_profiles_not_self CHECK (user_id <> profile_id)
);

GRANT SELECT, INSERT, DELETE ON public.saved_profiles TO authenticated;
GRANT ALL ON public.saved_profiles TO service_role;
ALTER TABLE public.saved_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own saves read" ON public.saved_profiles;
CREATE POLICY "Own saves read" ON public.saved_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own saves insert" ON public.saved_profiles;
CREATE POLICY "Own saves insert" ON public.saved_profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Own saves delete" ON public.saved_profiles;
CREATE POLICY "Own saves delete" ON public.saved_profiles FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_saved_profiles_user ON public.saved_profiles(user_id, created_at DESC);
