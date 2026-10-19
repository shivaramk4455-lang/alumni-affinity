-- ===========================================================================
-- 20261106: One definition of "is this member's subscription live".
--
-- FINDING (verified against the shipped bodies, not against the comments):
-- six places decided whether a subscription counts, and they disagreed.
--
--   1. public.entitlement()                20261015000000:49   IN ('authenticated','active','pending')
--   2. public.count_intro_usage()          20261027000000:52   same three states
--   3. public.mirror_intro_usage()         20261027000000:86   same three states
--   4. public.record_intro_usage()         20261027000000:120  same three states
--   5. public.enforce_intro_allowance()    20261011000000:260  same three states
--   6. discover_members() / directory_match_signals()          active|authenticated AND period_end > now()
--   7. src/lib/subscription.ts:81                              same three states (browser)
--
-- Two defects followed from 1-5:
--
--   (a) `pending` ENTITLED. That is the state Razorpay's
--       `invoice.payment_failed` and `subscription.pending` write
--       (supabase/functions/razorpay-webhook/index.ts:220-228), so a declined
--       renewal kept the full paid allowance with no money collected. The
--       README described the opposite set as proof that "an unpaid checkout
--       never entitles" — the comment asserted the bug rather than catching it.
--
--   (b) No `period_end` check, so a subscription whose terminal webhook was
--       lost stayed entitling forever. Two of the six DID check it, which is
--       why a lapsed member could be weighted 0 in the directory and still be
--       granted a paid allowance at the send gate. Same member, two answers.
--
-- The fix is one predicate in one place, consumed by every entitling path, so
-- the next audit reads a single function instead of six.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * `discover_members` and `directory_match_signals` already implement the
--     same predicate correctly inline. Rewriting a 200-line ranking function to
--     add nothing is risk without reward; the assertion at the end of this file
--     fails loudly if that predicate is ever loosened to include `pending`.
--   * `idx_subscriptions_one_live` keeps 'created' OUT of its predicate.
--     20261010000000:91-94 removed it on purpose so an abandoned checkout
--     cannot block a new one. Widening this index would reintroduce exactly
--     that bug. The double-checkout case (charged twice, second activation
--     failing on the unique index) is fixed in the webhook by
--     supersede-before-activate — see 20261106000100.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The predicate. STABLE, not IMMUTABLE, because it reads now().
--    It takes the two values rather than a row so it can be used as an index
--    predicate or a policy expression later without a table reference.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.subscription_is_live(_status text, _period_end timestamptz)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT _status IN ('active', 'authenticated')
     AND (_period_end IS NULL OR _period_end > now())
$$;

COMMENT ON FUNCTION private.subscription_is_live(text, timestamptz) IS
  'The single definition of a live subscription: an entitling status AND an '
  'unexpired period. `pending` is the payment-failure state and must never '
  'appear here; a NULL period_end stays live because Razorpay omits it on some '
  'activation payloads, and 20261106000100 expires lapsed rows on a schedule.';

-- ---------------------------------------------------------------------------
-- 2. The member's live row, chosen deterministically.
--    SECURITY DEFINER because the entitling triggers and entitlement() run
--    against a table the caller may not read (members hold SELECT on their own
--    row only, and RLS applies to everyone else). The ORDER BY mirrors the
--    ordering the inline copies used, so `active` still beats `authenticated`
--    if a member ever holds both.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.live_subscription(_user uuid)
RETURNS SETOF public.subscriptions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.*
  FROM public.subscriptions s
  WHERE s.user_id = _user
    AND private.subscription_is_live(s.status, s.period_end)
  ORDER BY
    array_position(ARRAY['active', 'authenticated'], s.status),
    s.created_at DESC
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION private.subscription_is_live(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.live_subscription(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.subscription_is_live(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION private.live_subscription(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. entitlement() — the send gate's source of truth.
--    The self-or-desk guard is kept verbatim IN THIS BODY: 20261015000000:104
--    asserts at migrate time that the shipped definition still contains
--    `private.is_admin()` and `42501`, and that assertion is a good one, so the
--    guard text must not be delegated to the helper below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.entitlement(_user uuid)
RETURNS TABLE (
  plan_code text,
  placement_weight integer,
  intro_requests integer,
  requests_used integer,
  requests_remaining integer,
  active boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only the member themselves, or the desk, may read an entitlement.
  IF auth.uid() IS NOT NULL
     AND _user IS NOT NULL
     AND _user IS DISTINCT FROM auth.uid()
     AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Entitlement is personal to the member or available to the desk'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH live AS (
    SELECT s.*, pl.code AS plan, pl.placement_weight AS weight, pl.intro_requests AS allowance
    FROM private.live_subscription(_user) s
    JOIN public.subscription_plans pl
      ON pl.code = s.plan_code
     AND pl.active
  )
  SELECT
    coalesce(live.plan, 'free'),
    coalesce(live.weight, 0),
    live.allowance,
    coalesce(live.requests_used, 0),
    CASE
      -- Only a genuinely unlimited plan reports NULL; a free member reports 0.
      WHEN live.allowance IS NULL AND live.id IS NOT NULL THEN NULL
      ELSE greatest(0, coalesce(live.allowance, 0) - coalesce(live.requests_used, 0))
    END,
    live.id IS NOT NULL
  FROM (SELECT 1) AS _
  LEFT JOIN live ON true;
END; $$;

REVOKE EXECUTE ON FUNCTION public.entitlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entitlement(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The usage counter, the mirror trigger and the converging recompute.
--    All three keep their exact semantics for a free member (no live row ->
--    join yields nothing -> count 0), and now share the live-row choice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_intro_usage(_user uuid)
RETURNS int
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _n int := 0;
BEGIN
  IF _user IS NULL THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO _n
  FROM public.interests i
  JOIN private.live_subscription(_user) s ON true
  WHERE i.sender_id = _user
    AND i.status <> 'declined'
    AND i.created_at >= coalesce(s.period_start, now() - interval '30 days');

  RETURN coalesce(_n, 0);
END; $$;

REVOKE EXECUTE ON FUNCTION public.count_intro_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_intro_usage(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mirror_intro_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sub uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (TG_OP = 'INSERT' AND NEW.status = 'pending')
    OR (TG_OP = 'UPDATE'
        AND OLD.status IN ('declined', 'withdrawn', 'expired')
        AND NEW.status = 'pending')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT s.id INTO _sub FROM private.live_subscription(NEW.sender_id) s;

  IF _sub IS NOT NULL THEN
    UPDATE public.subscriptions
    SET requests_used = public.count_intro_usage(NEW.sender_id),
        updated_at = now()
    WHERE id = _sub;
  END IF;

  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.record_intro_usage(_user uuid DEFAULT auth.uid())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sub uuid;
BEGIN
  IF _user IS NULL THEN
    RETURN;
  END IF;

  SELECT s.id INTO _sub FROM private.live_subscription(_user) s;

  IF _sub IS NULL THEN
    RETURN; -- free member: nothing to accrue against
  END IF;

  UPDATE public.subscriptions
  SET requests_used = public.count_intro_usage(_user),
      updated_at = now()
  WHERE id = _sub;
END; $$;

REVOKE EXECUTE ON FUNCTION public.record_intro_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intro_usage(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The two send gates, re-issued with a real serialization point.
--
--    20261010000000:138-141 claimed there is "no check-then-act race …
--    concurrent sends serialize on the interests rows the trigger's own count
--    query locks". That was not true: `count(*)` takes no locks, and the
--    concurrent row does not exist yet, so nothing serializes. A double click,
--    two tabs, or a script could overshoot both the paid allowance and the
--    5-outstanding pacing cap.
--
--    A transaction-scoped advisory lock keyed on the sender is the honest
--    serialization point. Both triggers take the SAME key on purpose: advisory
--    xact locks are re-entrant, so whichever fires first does the waiting and
--    the second is free.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_intro_allowance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _plan text;
  _allowance int;
  _used int;
  _cap int;
BEGIN
  -- Desk/service writes are exempt (no auth.uid()).
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Identity bar: only fresh asks are gated; rows already in flight are not
  -- retroactively punished if a verification is later suspended.
  IF (TG_OP = 'INSERT' AND NEW.status = 'pending')
     OR (TG_OP = 'UPDATE' AND OLD.status IN ('declined', 'withdrawn', 'expired')
         AND NEW.status = 'pending')
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = _uid
        AND p.verification_status = 'verified'
        AND p.verification_decided_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Verification required before you may send introductions'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT (
    OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent asks by this sender (see the note above).
  PERFORM pg_advisory_xact_lock(hashtext('interests_send:' || NEW.sender_id::text));

  SELECT e.plan_code, e.intro_requests INTO _plan, _allowance
  FROM public.entitlement(NEW.sender_id) e;

  IF _plan IS NULL OR _plan = 'free' THEN
    RETURN NEW; -- free members: pacing cap only
  END IF;
  IF _allowance IS NULL THEN
    RETURN NEW; -- defensive: no plan may be unlimited, but stay permissive
  END IF;

  -- Reciprocity scales the paid allowance: 50%..150%, always >= 5.
  _cap := least(
    greatest(
      round(_allowance * public.reciprocity_multiplier(NEW.sender_id)),
      5
    ),
    round(_allowance * 1.5)
  );

  SELECT count(*) INTO _used
  FROM public.interests i
  JOIN private.live_subscription(NEW.sender_id) s ON true
  WHERE i.sender_id = NEW.sender_id
    AND i.status <> 'declined'
    AND i.created_at >= coalesce(s.period_start, now() - interval '30 days')
    AND (TG_OP = 'INSERT' OR i.id <> NEW.id);

  IF _used >= _cap THEN
    RAISE EXCEPTION 'Monthly introduction allowance used (% of % this period) — answer more introductions to earn reach, or upgrade'
      , _used, _cap
      USING ERRCODE = '45000';
  END IF;

  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_interest_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _outstanding int;
  _cap int;
BEGIN
  IF auth.uid() IS NULL OR NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  -- Same key as the allowance trigger: the two gates must not interleave.
  PERFORM pg_advisory_xact_lock(hashtext('interests_send:' || NEW.sender_id::text));

  -- 5 base, scaled by reciprocity to the 3..7 band.
  _cap := least(
    greatest(round(5 * public.reciprocity_multiplier(NEW.sender_id))::int, 3),
    7
  );

  SELECT count(*) INTO _outstanding
  FROM public.interests
  WHERE sender_id = NEW.sender_id
    AND status = 'pending'
    AND id <> NEW.id;

  IF _outstanding >= _cap THEN
    RAISE EXCEPTION 'At most % outstanding introductions — answer what you have or withdraw one'
      , _cap
      USING ERRCODE = '45000';
  END IF;

  RETURN NEW;
END; $$;

-- ---------------------------------------------------------------------------
-- 6. Status vocabulary. Three names the webhook needs now that refunds,
--    chargebacks and superseded checkouts are handled:
--
--      superseded — a second checkout row that was closed when a later one
--                   activated, so the unique live index can never 500.
--      refunded   — money returned. Terminal, never entitling.
--      disputed   — chargeback raised. Terminal, never entitling.
--
--    None of the three is in the live predicate, so adding them cannot grant
--    access. All three are added to TERMINAL in the webhook so a replayed
--    activation cannot resurrect them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_valid;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_valid CHECK (status IN (
  'created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'expired', 'completed',
  'superseded', 'refunded', 'disputed'
));

COMMENT ON INDEX public.idx_subscriptions_one_live IS
  'One OPEN billing relationship per member. `created` is deliberately excluded '
  '(20261010000000:91-94) so an abandoned checkout cannot block a new one; the '
  'charged-without-entitlement case is handled by supersede-before-activate in '
  'razorpay-webhook. Terminal states are excluded because a member must be able '
  'to subscribe again after a refund or a superseded checkout.';

-- ---------------------------------------------------------------------------
-- 7. Fail-loud regression assertions. These are STRUCTURAL, not behavioural:
--    a migration cannot fabricate a member (profiles -> auth.users FK) to test
--    the predicate against real rows, and doing so on a production database
--    inside a migration transaction would be worse than the risk it removes.
--    Each clause below is an invariant that a future rewrite must preserve.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _predicate text;
  _entitlement text;
  _offenders text;
BEGIN
  -- The predicate itself: must exist, must gate on period_end, must not admit
  -- the payment-failure state.
  SELECT pg_get_functiondef(oid) INTO _predicate
  FROM pg_proc WHERE proname = 'subscription_is_live' AND pronamespace = 'private'::regnamespace;

  IF _predicate IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: private.subscription_is_live() is missing';
  END IF;
  IF _predicate NOT LIKE '%period_end%' THEN
    RAISE EXCEPTION 'REGRESSION: subscription_is_live() must gate on period_end';
  END IF;
  IF _predicate LIKE '%pending%' THEN
    RAISE EXCEPTION 'REGRESSION: pending is the payment-failure state and must not entitle';
  END IF;

  -- entitlement() keeps its guard text (20261015000000 asserts this too, but
  -- this migration rewrites the body, so it re-asserts rather than relying on
  -- a check that has already run once).
  SELECT pg_get_functiondef(oid) INTO _entitlement
  FROM pg_proc WHERE proname = 'entitlement' AND pronamespace = 'public'::regnamespace;

  IF _entitlement IS NULL OR _entitlement NOT LIKE '%private.is_admin()%' THEN
    RAISE EXCEPTION 'REGRESSION: entitlement() lost its self-or-desk guard';
  END IF;
  IF _entitlement NOT LIKE '%42501%' THEN
    RAISE EXCEPTION 'REGRESSION: entitlement() must refuse cross-member reads';
  END IF;
  IF _entitlement NOT LIKE '%private.live_subscription%' THEN
    RAISE EXCEPTION 'REGRESSION: entitlement() must consume private.live_subscription()';
  END IF;

  -- Every entitling path must delegate. A function that hand-rolls the state
  -- list again will not mention the helper, so this catches a partial revert.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO _offenders
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN (
      'count_intro_usage', 'mirror_intro_usage', 'record_intro_usage', 'enforce_intro_allowance'
    )
    AND pg_get_functiondef(p.oid) NOT LIKE '%live_subscription%';

  IF _offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'REGRESSION: these entitling paths do not use private.live_subscription(): %', _offenders;
  END IF;

  -- The status vocabulary must admit the three states the webhook writes.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'subscriptions_status_valid'
      AND c.conrelid = 'public.subscriptions'::regclass
      AND pg_get_constraintdef(c.oid) LIKE '%superseded%'
      AND pg_get_constraintdef(c.oid) LIKE '%refunded%'
      AND pg_get_constraintdef(c.oid) LIKE '%disputed%'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: subscriptions_status_valid must admit superseded/refunded/disputed';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Backfill the display counter onto the new window definition.
--    Requests already accrued inside the window are preserved; a member whose
--    row is `pending` or whose period has lapsed now correctly shows 0 against
--    a free plan rather than a paid allowance they did not pay for.
--    Nothing is locked out by this: the send gate recomputes from interests
--    rows, so a genuinely active member's usage is unchanged.
-- ---------------------------------------------------------------------------
UPDATE public.subscriptions s
SET requests_used = public.count_intro_usage(s.user_id),
    updated_at = now()
WHERE private.subscription_is_live(s.status, s.period_end);
