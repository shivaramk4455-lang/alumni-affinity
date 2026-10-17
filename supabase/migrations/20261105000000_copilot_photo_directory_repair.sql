-- ===========================================================================
-- 20261105: Repair one P0 runtime break and four regressions that later
-- migrations introduced into earlier migrations' end state.
--
-- Repairs, in severity order:
--
-- 1. [P0] public.accept_copilot_invite() writes public.copilots.accepted_at,
--    a column that has never existed. public.copilots is created in
--    20260925035052 (id, candidate_id, copilot_user_id, copilot_email,
--    copilot_name, relation, invite_code, status, created_at, updated_at) and
--    no migration ever adds a column to it -- only FOREIGN KEY constraints.
--    plpgsql validates column references at first execution, not at CREATE,
--    so 20261101 applied cleanly and every co-pilot invitation acceptance has
--    failed since with 42703 undefined_column.
--
--    This is the same defect class 20261104 repaired for
--    calls.created_at, conversations.updated_at and interests.reminder_sent.
--    It was missed here. Rather than only adding the column, the function is
--    restored to a correct shape (2 and 3 below) and asserted at the bottom,
--    so the class cannot silently recur.
--
-- 2. [P1] The 20261101 rewrite of the same function dropped
--    `RETURNING * INTO _row`, so `_row` was a pre-activation snapshot; the
--    candidate-facing notification built its body from
--    `_row.copilot_name || '...'`, which collapses to NULL whenever the
--    candidate left the optional name blank (notifications.body is nullable,
--    so this degraded silently rather than erroring). The rewrite also
--    changed the return value from _row.candidate_id -- the contract set by
--    20260928000000 -- to _row.id.
--
-- 3. [P1] The same rewrite replaced the literal error 'invitation_email_mismatch'
--    with a formatted sentence. src/routes/_authenticated/copilot-invite.$code.tsx
--    branches on that literal, so the dedicated "this invitation was sent to a
--    different address" message became unreachable and the member saw the
--    generic "not valid or already used" toast instead. The literal is restored.
--
-- 4. [P1] The storage.objects policy "Photo read by permitted members" was
--    re-created by 20261026000000 without the
--    (private.is_verified(auth.uid()) OR private.is_active_copilot(auth.uid()))
--    gate that 20261009000000 had placed on it. Its sibling row policy
--    "Permitted members read gallery" kept the gate, and 20261026's own comment
--    states the two "must agree, else the gallery lists rows the viewer cannot
--    fetch" -- they instead disagreed in the permissive direction, so an
--    account that merely signed up (verification_status = 'unverified') could
--    fetch any all_members photograph directly from the Storage API, bypassing
--    the verified-only directory promise.
--
-- 5. [P1] The public.profiles directory policy likewise lost the sabbatical
--    (paused_until) and private.same_shielded_employer(...) clauses when
--    20261009000000 re-created it. After that point both conditions survived
--    only inside function bodies (discover_members, directory_match_signals,
--    get_profile_partner_preferences) and never in a policy on public.profiles.
--    That matters because src/routes/_authenticated/members.tsx:81 also reads
--    public.profiles directly, with RLS as the only backstop -- so a paused
--    member, and a member shielded by the same-employer rule, were still
--    returned to any verified member.
--
-- 6. [P2] public.notification_channels_for(uuid, text) is SECURITY DEFINER and
--    was granted to authenticated with no caller check, so any signed-in member
--    could read another member's notification channel opt-ins by passing their
--    uuid. A caller check cannot be used here: its only legitimate callers are
--    internal definer-chain functions (public.enqueue_notification) that
--    deliberately pass a *recipient* uuid, so a check against auth.uid() would
--    break the notification outbox. The grant to authenticated is withdrawn
--    instead -- the definer chain executes with the owner's privileges and is
--    unaffected.
--
-- Nothing here is destructive: no rows are touched, and every policy is
-- re-asserted in its intended (more restrictive) form, so this migration is
-- idempotent and safe to re-apply.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. [P0] copilots.accepted_at -- written by the function below, never created
-- ---------------------------------------------------------------------------
ALTER TABLE public.copilots
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2 & 3. [P1] accept_copilot_invite(): restore RETURNING, the candidate's id,
--        the email-mismatch literal, and the name fallback chain.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_copilot_invite(_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  _copilot_name text;
  _row public.copilots;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to accept a co-pilot invitation' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR length(_code) < 8 THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO _row FROM public.copilots
   WHERE invite_code = _code AND status <> 'revoked'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF _row.copilot_user_id IS NOT NULL AND _row.copilot_user_id <> _uid THEN
    RAISE EXCEPTION 'invitation_already_used' USING ERRCODE = 'P0001';
  END IF;
  IF _email = '' OR lower(_row.copilot_email) <> _email THEN
    -- Matched literally by copilot-invite.$code.tsx; do not reword.
    RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = 'P0001';
  END IF;

  -- RETURNING * INTO _row re-reads the activated row and keeps _row.candidate_id
  -- available for the notification and the return value below.
  UPDATE public.copilots
     SET copilot_user_id = _uid,
         status = 'active',
         accepted_at = now()
   WHERE id = _row.id
   RETURNING * INTO _row;

  SELECT full_name INTO _copilot_name FROM public.profiles WHERE id = _uid;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (_row.candidate_id, 'copilot_invite_accepted', 'Co-pilot accepted',
          coalesce(_row.copilot_name, _copilot_name, 'Your co-pilot')
            || ' accepted your co-pilot invitation and can now view matching profiles with you.',
          '/copilots');

  PERFORM public.enqueue_notification(
    _row.candidate_id,
    'copilot_invite_accepted',
    jsonb_build_object('from_name', coalesce(_row.copilot_name, _copilot_name, 'Your co-pilot'))
  );

  -- Contract set by 20260928000000: the candidate's id, not the invite row's.
  RETURN _row.candidate_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.accept_copilot_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_copilot_invite(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. [P1] Restore the verified / active-co-pilot gate on the photo object
--        policy, merged with the accepted_only branch 20261026 added, so that
--        it finally agrees with its sibling "Permitted members read gallery".
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Photo read by permitted members" ON storage.objects;
CREATE POLICY "Photo read by permitted members" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-photos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (
        (private.is_verified(auth.uid()) OR private.is_active_copilot(auth.uid()))
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id::text = (storage.foldername(name))[1]
            AND p.onboarded AND p.is_visible
            AND (
              p.photo_visibility = 'all_members'
              OR private.has_accepted_interest(p.id, auth.uid())
              OR (
                p.photo_visibility = 'accepted_only'
                AND private.has_photo_access(p.id, auth.uid())
              )
            )
          -- 'hidden' is intentionally absent: never requestable, never served.
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. [P1] Restore sabbatical pause + employer shield on the directory policy.
--        Other policies ("Own profile read", "Introductions see the other
--        side", "Copilot reads candidate profile") still cover legitimate
--        access, so this cannot lock a member out of their own row, an
--        existing introduction, or a co-pilot's view.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Verified members and copilots read the directory" ON public.profiles;
CREATE POLICY "Verified members and copilots read the directory" ON public.profiles FOR SELECT TO authenticated
  USING (
    onboarded
    AND is_visible
    AND verification_status = 'verified'
    AND (paused_until IS NULL OR paused_until <= now())
    AND NOT private.same_shielded_employer(employer, auth.uid())
    AND (private.is_verified(auth.uid()) OR private.is_active_copilot(auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 6. [P2] Stop members reading another member's notification channel opt-ins.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.notification_channels_for(uuid, text) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Fail-loud regression assertions. These run at migrate time so a future
-- migration that reintroduces any of the above breaks the deploy instead of
-- production.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _copilot_body text;
  _photo_qual text;
  _dir_qual text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'copilots'
      AND column_name = 'accepted_at'
  ) THEN
    RAISE EXCEPTION
      'REGRESSION: public.copilots.accepted_at is missing but accept_copilot_invite() writes it';
  END IF;

  SELECT pg_get_functiondef(oid) INTO _copilot_body
  FROM pg_proc
  WHERE proname = 'accept_copilot_invite'
    AND pronamespace = 'public'::regnamespace;
  IF _copilot_body IS NULL OR _copilot_body NOT LIKE '%RETURNING * INTO _row%' THEN
    RAISE EXCEPTION
      'REGRESSION: accept_copilot_invite() must RETURNING * INTO _row so the candidate notification and return value are correct';
  END IF;
  IF _copilot_body NOT LIKE '%invitation_email_mismatch%' THEN
    RAISE EXCEPTION
      'REGRESSION: accept_copilot_invite() must raise the literal invitation_email_mismatch for the client branch';
  END IF;

  SELECT qual INTO _photo_qual FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Photo read by permitted members';
  IF _photo_qual IS NULL OR _photo_qual NOT LIKE '%is_verified%' THEN
    RAISE EXCEPTION
      'REGRESSION: the photo storage policy lost the verified/co-pilot gate and again disagrees with "Permitted members read gallery"';
  END IF;

  SELECT qual INTO _dir_qual FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'profiles'
    AND policyname = 'Verified members and copilots read the directory';
  IF _dir_qual IS NULL
     OR _dir_qual NOT LIKE '%paused_until%'
     OR _dir_qual NOT LIKE '%same_shielded_employer%' THEN
    RAISE EXCEPTION
      'REGRESSION: the directory policy lost the sabbatical-pause or employer-shield clause';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.notification_channels_for(uuid, text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'REGRESSION: authenticated can still read other members'' notification channel opt-ins';
  END IF;
END $$;
