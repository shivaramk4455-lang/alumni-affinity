-- ===========================================================================
-- 20261108: Restore the sabbatical and employer-shield clauses to the
--           directory policy (regression introduced by 20261107000000).
--
-- 20261105000000 (section 5) restored the sabbatical (paused_until) and
-- private.same_shielded_employer(...) clauses on
-- "Verified members and copilots read the directory" and asserted them.
-- 20261107000000 (section 8) then re-created the SAME policy — to remove the
-- permissive "Members read visible onboarded" policy — and its replacement
-- qualification kept only onboarded / is_visible / verification_status and the
-- verified-or-active-copilot gate. Both privacy clauses were dropped again.
-- 20261107000000's own regression assertion checks only for verification
-- (is_verified / is_active_copilot), so nothing failed loud.
--
-- The consequence: src/routes/_authenticated/members.tsx:85,
-- members.$id.tsx:146, shortlist.tsx:57, access-log.ts:78 and
-- settings.tsx:190 read public.profiles directly. RLS is the only backstop on
-- those paths, so a member who set a sabbatical pause ("removed from search")
-- or who shares a shielded employer with the viewer was still returned to any
-- verified member or active co-pilot, even though discover_members() hides
-- them. The promise held on the RPC path only, and the two answers disagreed.
--
-- This migration restores the intended (more restrictive) qualification and
-- extends the fail-loud assertion to cover BOTH clauses, so this exact
-- regression cannot be reintroduced silently a third time.
--
-- SAFE DEFAULT: only the directory SELECT policy is tightened. "Own profile
-- read", "Introductions see the other side" and "Copilot reads candidate
-- profile" still cover a member's own row, an existing introduction, and a
-- co-pilot's view, so nobody loses access they are entitled to. The migration
-- touches no rows and is idempotent, so it is safe to re-apply.
-- ===========================================================================

DROP POLICY IF EXISTS "Verified members and copilots read the directory" ON public.profiles;
CREATE POLICY "Verified members and copilots read the directory" ON public.profiles FOR SELECT TO authenticated
  USING (
    onboarded
    AND is_visible
    AND verification_status = 'verified'
    -- Sabbatical: a paused member is removed from discovery until the pause
    -- lapses. Mirrors the identical clause inside discover_members().
    AND (paused_until IS NULL OR paused_until <= now())
    -- Employer shield: opt-in only, and it only hides the *candidate* rows —
    -- never your own, never an existing introduction.
    AND NOT private.same_shielded_employer(employer, auth.uid())
    AND (private.is_verified(auth.uid()) OR private.is_active_copilot(auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Fail-loud regression assertions. Structural, not behavioural: a migration
-- cannot fabricate two members (profiles -> auth.users FK) to exercise the
-- predicate against real rows. Each clause below is an invariant a future
-- rewrite must preserve.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _qual text;
BEGIN
  SELECT qual INTO _qual FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'profiles'
     AND policyname = 'Verified members and copilots read the directory';

  IF _qual IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: the verified-only directory policy is missing';
  END IF;
  IF _qual NOT ILIKE '%verification_status%'
     OR _qual NOT ILIKE '%is_verified%'
     OR _qual NOT ILIKE '%is_active_copilot%' THEN
    RAISE EXCEPTION 'REGRESSION: the directory policy no longer gates on verification';
  END IF;
  IF _qual NOT ILIKE '%paused_until%' THEN
    RAISE EXCEPTION
      'REGRESSION: the directory policy lost the sabbatical-pause (paused_until) clause';
  END IF;
  IF _qual NOT ILIKE '%same_shielded_employer%' THEN
    RAISE EXCEPTION
      'REGRESSION: the directory policy lost the employer-shield clause';
  END IF;

  -- The policy calls this helper; if it were missing or its grant withdrawn,
  -- the policy would error instead of filtering.
  IF to_regprocedure('private.same_shielded_employer(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: private.same_shielded_employer(text, uuid) is missing';
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'private.same_shielded_employer(text, uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'REGRESSION: authenticated cannot execute private.same_shielded_employer, so the directory policy cannot filter';
  END IF;
END $$;
