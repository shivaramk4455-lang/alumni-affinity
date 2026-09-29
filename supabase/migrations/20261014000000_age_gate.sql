-- ===========================================================================
-- 20261014: Server-side age gate for profiles.birth_year.
--
-- Membership is 21+ (terms of membership; onboarding zod schema). Client-side
-- checks can be bypassed from the console, so the floor is enforced here:
-- a birth year is only accepted when the holder is at least 21, or when it
-- is absent (signup rows are created without a birth year; onboarding fills
-- it in). Adult attestation at signup and at apply rides on top of this gate.
--
-- Why a time-relative CHECK works here: PostgreSQL evaluates a CHECK at
-- write time only. The bound EXTRACT(YEAR FROM CURRENT_DATE) - 21 only ever
-- *relaxes* as time passes (1994 <= 2005 stays true in 2027), so rows valid
-- at write time can never be retroactively invalidated by the constraint,
-- and pg_dump/restore validation cannot fail for rows this gate accepted.
-- CHECK constraints also reject only subqueries — CURRENT_DATE is allowed.
-- ===========================================================================

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_birth_year_adult;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_birth_year_adult
  CHECK (
    birth_year IS NULL
    OR (birth_year >= 1900 AND birth_year <= EXTRACT(YEAR FROM CURRENT_DATE)::int - 21)
  );

-- Regression self-test: exercise the gate the way a write would.
--
-- Both probes tolerate profiles_id_fkey (which this migration may or may not
-- have added, depending on whether the profile table was orphan-free at the
-- time). PostgreSQL evaluates NOT NULL/CHECK *before* the row triggers that
-- implement a foreign key, so:
--   * an underage value must raise check_violation — a foreign_key_violation
--     here would mean the CHECK never ran, so we re-raise rather than accept
--     a false pass;
--   * an admissible value may then raise foreign_key_violation, which is
--     proof the CHECK passed (the probe row simply has no auth.users parent).
DO $$
DECLARE
  _probe uuid := gen_random_uuid();
BEGIN
  -- 1. An underage year must be refused.
  BEGIN
    INSERT INTO public.profiles (id, full_name, birth_year)
    VALUES (_probe, 'Age-gate probe', EXTRACT(YEAR FROM CURRENT_DATE)::int - 10);
    DELETE FROM public.profiles WHERE id = _probe;
    RAISE EXCEPTION 'age gate accepted an underage birth_year' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN
      NULL; -- expected: the gate held
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'CHECK did not fire before the foreign key — age gate not enforced';
  END;

  -- 2. An admissible year must be accepted by the CHECK.
  BEGIN
    INSERT INTO public.profiles (id, full_name, birth_year)
    VALUES (_probe, 'Age-gate probe', EXTRACT(YEAR FROM CURRENT_DATE)::int - 30);
    DELETE FROM public.profiles WHERE id = _probe;
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'age gate rejected an admissible birth_year';
    WHEN foreign_key_violation THEN
      NULL; -- CHECK passed; only the auth.users parent is missing
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Adult attestation record.
--
-- The signup form asks for an affirmative "I am 21 or older" before the
-- account is created; the client passes it through the auth user's metadata.
-- Storing the timestamp here makes the attestation an auditable server-side
-- fact rather than a browser-local boolean, and gives the desk something to
-- point at if a member's stated age is later disputed.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS adult_attested_at timestamptz;

COMMENT ON COLUMN public.profiles.adult_attested_at IS
  'When the member affirmatively attested to being 21+ at signup. NULL means no attestation was recorded (e.g. an OAuth signup).';

-- Keep the signup trigger's existing idempotence: an auth.users insert that
-- races a pre-existing profile row must still never fail signup.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, adult_attested_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    CASE
      WHEN NEW.raw_user_meta_data->>'adult_attested' = 'true' THEN now()
      ELSE NULL
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
