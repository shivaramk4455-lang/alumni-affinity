-- ===========================================================================
-- 20261011 — Founder decisions, phase 3 batch.
-- Chained after 20261010000001. Additive; no existing row is rewritten except
-- the two plan rows (grandfathering an existing paid tier) and no user loses
-- access: a grandfathered plan keeps entitling, it just stops being sold.
--
-- 1. No plan may be "unlimited introductions" (that axis punishes the network
--    the pacing design protects). `sellable` separates "can be bought" from
--    "still entitles", so retiring a tier can never downgrade a payer.
-- 2. Quota rewards reciprocity: members who answer what they receive may send
--    more; members who leave others hanging may send less. Behaviour lever,
--    not a price lever. Floors stop it ever becoming a trap.
-- 3. Identity bar before the first send: the sender must be a verified member
--    with a decided verification, enforced in the database.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Plans as access/service tiers, never metered-volume promises.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS sellable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS service_note text;

COMMENT ON COLUMN public.subscription_plans.sellable IS
  'May be bought at checkout. Retiring a tier sets this false without touching '
  'entitlement, so existing payers are grandfathered (never downgraded).';
COMMENT ON COLUMN public.subscription_plans.service_note IS
  'Pricing-page copy describing the human/service element of the tier.';

-- Concierge becomes the sellable service tier (desk-curated shortlist), with a
-- bounded monthly allowance. Founder is retired from sale, keeps entitling,
-- and loses the "unlimited" property that contradicted the pacing design.
UPDATE public.subscription_plans
   SET service_note = 'Desk-curated shortlist each month, photo/credential pre-check, priority desk replies.',
       sellable = true,
       active = true
 WHERE code = 'concierge';

UPDATE public.subscription_plans
   SET label = 'Founder (grandfathered)',
       service_note = 'Legacy tier: kept only for members who already pay for it. No longer sold.',
       sellable = false,
       active = true,
       -- Bounded, not NULL: every allowance is finite so no tier can be
       -- marketed as unlimited volume.
       intro_requests = greatest(coalesce(intro_requests, 0), 60)
 WHERE code = 'founder';

-- Belt and braces: nothing may be sold that promises unlimited sends.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.subscription_plans
    WHERE sellable AND intro_requests IS NULL
  ) THEN
    RAISE EXCEPTION 'A sellable plan may not have an unlimited introduction allowance';
  END IF;
END $$;
-- ---------------------------------------------------------------------------
-- 1b. `interests.decided_at` — the column weekly-digest has queried since
--     20261006 but which no migration ever created (that query has been
--     silently failing, so the digest's "accepted" count was always empty),
--     and which the reciprocity scoring below depends on. Added, stamped by
--     the transition trigger, backfilled from updated_at (the only timestamp
--     a decision could have touched), and indexed per recipient.
-- ---------------------------------------------------------------------------
ALTER TABLE public.interests
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_interests_decided
  ON public.interests(recipient_id, decided_at)
  WHERE decided_at IS NOT NULL;

-- Transition machine, redefined to stamp/clear decided_at alongside the
-- existing rules (all rules from 20261010000000 carried over verbatim).
CREATE OR REPLACE FUNCTION public.enforce_interest_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean := false;
BEGIN
  IF current_setting('app.pacing_job', true) = '1' AND NEW.status = 'expired' THEN
    RETURN NEW;
  END IF;

  -- Stamp the answer moment for ANY writer (member or service role). A
  -- reopened ask is unanswered again; expiry is not an answer, so it never
  -- stamps. Placed before the authorization checks: if those raise, the whole
  -- UPDATE aborts anyway, so no partial state can leak.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
      NEW.expires_at := now() + interval '14 days';
      NEW.reminder_sent_at := NULL;
      NEW.decided_at := NULL;
    ELSIF NEW.status IN ('accepted', 'declined', 'blocked') THEN
      NEW.decided_at := now();
    END IF;
  END IF;

  IF _uid IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF _uid = OLD.sender_id AND _uid <> OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status = 'withdrawn')
             OR (OLD.status IN ('declined', 'withdrawn', 'expired') AND NEW.status = 'pending')
             OR (OLD.status = 'accepted' AND NEW.status = 'blocked');
  ELSIF _uid = OLD.recipient_id THEN
    _allowed := (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined'))
             OR (OLD.status = 'accepted' AND NEW.status = 'blocked');
  END IF;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Only the recipient may accept an introduction, and only while it is pending'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END; $$;

-- Backfill: decisions that predate this migration are timed by the last
-- transition write (updated_at is trigger-maintained), which is the closest
-- honest approximation; expired/system rows are left alone (they were not
-- answered by anyone).
UPDATE public.interests
   SET decided_at = updated_at
 WHERE decided_at IS NULL
   AND status IN ('accepted', 'declined', 'blocked');



-- ---------------------------------------------------------------------------
-- 2. Reciprocity: how reliably does this member answer what they receive?
--    SECURITY DEFINER + STABLE so the triggers and the desk view can call it.
--    Only *decided* received introductions count; a fresh ask still waiting
--    for an answer does not yet count against anyone. Members with fewer than
--    5 decisions get the neutral score (no signal, no penalty).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.response_rate(_user uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _rate numeric;
BEGIN
  -- Reach scoring is personal: ask about yourself, or (desk only) anyone.
  IF _user IS NULL
     OR (_user IS DISTINCT FROM auth.uid() AND NOT private.is_admin()) THEN
    RAISE EXCEPTION 'Response rate is personal to the member or the desk'
      USING ERRCODE = '42501';
  END IF;

  SELECT CASE
    WHEN count(*) < 5 THEN 0.500
    ELSE round(
      count(*) FILTER (
        WHERE i.status IN ('accepted', 'declined', 'blocked')
          AND i.decided_at IS NOT NULL
          AND i.decided_at <= i.created_at + interval '7 days'
      )::numeric / greatest(count(*), 1),
      3)
  END
  INTO _rate
  FROM public.interests i
  WHERE i.recipient_id = _user
    AND (i.status IN ('accepted', 'declined', 'blocked', 'expired')
         OR (i.status = 'pending' AND i.expires_at < now()));

  RETURN coalesce(_rate, 0.500);
END; $$;

REVOKE EXECUTE ON FUNCTION public.response_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.response_rate(uuid) TO authenticated, service_role;

-- Allowance multiplier for one send, derived from response_rate.
CREATE OR REPLACE FUNCTION public.reciprocity_multiplier(_user uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.response_rate(_user) >= 0.800 THEN 1.500
    WHEN public.response_rate(_user) >= 0.500 THEN 1.000
    ELSE 0.500
  END
$$;

REVOKE EXECUTE ON FUNCTION public.reciprocity_multiplier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reciprocity_multiplier(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2b. Identity bar before the first send + reciprocity-aware paid allowance.
--     Replaces the 20261010 body (same name, so CREATE OR REPLACE swaps it in).
--     * Verified members only: the sender must be desk-verified with a decided
--       verification before any new/renewed ask lands. Free members keep the
--       pacing cap as their only *volume* gate, but the identity gate applies
--       to everyone (it is about who may approach, not how often).
--     * The monthly allowance is multiplied by the sender's reciprocity score:
--       answering people earns reach, ghosting costs it. Floors stop it from
--       ever becoming a trap (never below 5 sends for a paid member, never
--       above the plan allowance times 1.5).
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
  JOIN public.subscriptions s
    ON s.user_id = NEW.sender_id
   AND s.status IN ('authenticated', 'active', 'pending')
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

-- ---------------------------------------------------------------------------
-- 2c. Reciprocity-aware pacing for every member (replaces 20261003 body).
--     Base cap stays 5 outstanding; a member who answers what they receive may
--     hold 7, a member who ghosts down to 3. Floors/caps are absolute, and
--     members with fewer than 5 decisions are treated as neutral, so this can
--     never lock a newcomer out. Message keeps the "outstanding introductions"
--     phrase the send-failure toast maps on.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_interest_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _outstanding int;
  _cap int;
BEGIN
  IF auth.uid() IS NULL OR NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

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
-- 3. Reporter's half of the safety loop: reports gain a resolution workflow.
--    Who can read reports is unchanged (reporter + desk). Resolution fields
--    are desk-written; the reporter is informed through a server-composed
--    notification written inside the SECURITY DEFINER function (members have
--    no INSERT path on notifications since 20261010).
-- ---------------------------------------------------------------------------
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS handled_by uuid,
  ADD COLUMN IF NOT EXISTS handled_at timestamptz;

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_status_valid;
ALTER TABLE public.reports ADD CONSTRAINT reports_status_valid
  CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed'));

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_outcome_valid;
ALTER TABLE public.reports ADD CONSTRAINT reports_outcome_valid
  CHECK (outcome IS NULL OR outcome IN (
    'no_action', 'warning_sent', 'profile_hidden', 'account_suspended', 'referred_to_desk'
  ));

COMMENT ON COLUMN public.reports.status IS
  'Workflow: open -> in_review -> resolved | dismissed. The reporter sees the status and outcome of their own report; reports never expose the reporter to the reported member.';

-- The desk writes resolution columns; reporters keep their existing SELECT.
GRANT UPDATE (status, outcome, resolution_note, handled_by, handled_at)
  ON public.reports TO authenticated;
-- Desk transitions one report and, on a terminal state, tells the reporter
-- what happened. Re-checks the desk role itself: the client is never the
-- authority, and every string the reporter sees is a constant below.
CREATE OR REPLACE FUNCTION public.desk_update_report(
  _id uuid,
  _status text,
  _outcome text DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.reports;
BEGIN
  IF _uid IS NULL OR NOT private.is_admin() THEN
    RAISE EXCEPTION 'Membership desk only' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('open', 'in_review', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Unknown report status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.reports
     SET status = _status,
         outcome = CASE WHEN _status IN ('resolved', 'dismissed') THEN _outcome END,
         resolution_note = _note,
         handled_by = _uid,
         handled_at = now()
   WHERE id = _id
   RETURNING * INTO _row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;

  IF _status = 'resolved' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_row.reporter_id, 'report_resolved', 'Your report was actioned',
            'The membership desk reviewed your report and took action. Thank you for making the Circle safer.',
            '/dashboard');
  ELSIF _status = 'dismissed' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (_row.reporter_id, 'report_resolved', 'Your report was reviewed',
            'The membership desk reviewed your report. No further action was needed.',
            '/dashboard');
  END IF;
END; $$;

-- report_resolved joins the inbox whitelist (server-written only; members
-- still have no INSERT policy on notifications).
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid
-- desk_reports() must surface the workflow; the return type changes, so it is
-- replaced wholesale (Postgres forbids changing a function's result type).
DROP FUNCTION IF EXISTS public.desk_reports(int);
CREATE FUNCTION public.desk_reports(_limit int DEFAULT 200)
RETURNS TABLE (
  id uuid, reason text, created_at timestamptz,
  reporter_id uuid, reporter_name text,
  reported_profile_id uuid, reported_name text, reported_visible boolean,
  status text, outcome text, resolution_note text, handled_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Membership desk only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.reason, r.created_at,
           r.reporter_id, coalesce(rp.full_name, 'Member'),
           r.reported_profile_id, coalesce(tp.full_name, 'Member'),
           coalesce(tp.is_visible, false),
           r.status, r.outcome, r.resolution_note, r.handled_at
    FROM public.reports r
    LEFT JOIN public.profiles rp ON rp.id = r.reporter_id
    LEFT JOIN public.profiles tp ON tp.id = r.reported_profile_id
    ORDER BY (r.status = 'open') DESC, r.created_at DESC
    LIMIT greatest(1, least(coalesce(_limit, 200), 500));
END; $$;

REVOKE EXECUTE ON FUNCTION public.desk_reports(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desk_reports(int) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Retention purge: credential documents live in storage forever after the
--    desk decides. Purge the file once the decision is older than the grace
--    period; keep the *decision* (status, note, who, when) and the consent
--    ledger — those are the audit trail. The member can always re-upload if
--    the decision was needs_resubmission. Blast radius of a storage incident
--    drops to the documents still genuinely under review.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_decided_verification_docs(_grace_days int DEFAULT 90)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _purged int := 0;
  _profile record;
BEGIN
  IF _grace_days < 7 THEN
    RAISE EXCEPTION 'Grace period below one week is refused — this deletes documents'
      USING ERRCODE = '22023';
  END IF;

  FOR _profile IN
    SELECT p.id, p.verification_doc_path
    FROM public.profiles p
    WHERE p.verification_doc_path IS NOT NULL
      AND p.verification_decided_at IS NOT NULL
      AND p.verification_decided_at < now() - make_interval(days => _grace_days)
    FOR UPDATE OF p
  LOOP
    -- Remove the object first; if the storage row is already gone the loop
    -- still clears the dangling pointer below.
    DELETE FROM storage.objects
    WHERE bucket_id = 'verification-docs'
      AND name = _profile.verification_doc_path;

    UPDATE public.profiles
       SET verification_doc_path = NULL,
           updated_at = now()
     WHERE id = _profile.id;

    _purged := _purged + 1;
  END LOOP;

  RETURN _purged;
END; $$;

REVOKE EXECUTE ON FUNCTION public.purge_decided_verification_docs(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_decided_verification_docs(int)
  TO service_role;

-- Daily at 03:47 (off-peak, deliberately not on the hour so it never collides
-- with the notification dispatch jobs). Pure-SQL job: no HTTP, no secrets, so
-- it runs on any instance with pg_cron.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not available; purge verification documents manually';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-verification-docs';
  PERFORM cron.schedule(
    'purge-verification-docs',
    '47 3 * * *',
    $$SELECT public.purge_decided_verification_docs(90);$$
  );
END $$;

-- ---------------------------------------------------------------------------
-- 5. Liquidity over vanity: one call that answers "is the network actually
--    alive?" — verified supply, gender split of the verified pool, reply rate,
--    time-to-first-reply, and open safety work. Desk-only (JSON, so nothing
--    restructures when a metric is added).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.desk_network_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _result jsonb;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Membership desk only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'verified_by_status', (
      SELECT coalesce(jsonb_object_agg(verification_status, n), '{}'::jsonb)
      FROM (SELECT verification_status, count(*) n FROM public.profiles GROUP BY 1) s
    ),
    'verified_gender_split', (
      SELECT coalesce(jsonb_object_agg(coalesce(gender, 'unstated'), n), '{}'::jsonb)
      FROM (SELECT gender, count(*) n FROM public.profiles WHERE verification_status='verified' GROUP BY 1) s
    ),
    'verified_last_7d', (SELECT count(*) FROM public.profiles
      WHERE verification_status='verified' AND created_at > now() - interval '7 days'),
    'reply_rate', (
      SELECT round(avg(CASE WHEN status IN ('accepted','declined','blocked') THEN 1.0 ELSE 0 END)::numeric, 3)
      FROM public.interests
      WHERE created_at > now() - interval '30 days'
        AND (status <> 'pending' OR expires_at < now())
    ),
    'median_hours_to_reply', (
      SELECT round((percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (decided_at - created_at))
      ) / 3600)::numeric, 1)
      FROM public.interests
      WHERE status IN ('accepted','declined','blocked')
        AND decided_at IS NOT NULL
        AND decided_at > now() - interval '30 days'
    ),
    'open_reports', (SELECT count(*) FROM public.reports WHERE status IN ('open','in_review')),
    'unanswered_pending_interests', (SELECT count(*) FROM public.interests
      WHERE status='pending' AND expires_at < now() + interval '3 days')
  ) INTO _result;

  RETURN _result;
END; $$;

REVOKE EXECUTE ON FUNCTION public.desk_network_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desk_network_health() TO authenticated, service_role;


  CHECK (kind IN (
    'interest_received', 'interest_accepted', 'interest_declined', 'interest_expired',
    'interest_reminder', 'copilot_invite_accepted', 'verification_approved',
    'verification_resubmission', 'verification_rejected', 'suggestion_received',
    'message_received', 'call_missed', 'report_resolved'
  ));

REVOKE EXECUTE ON FUNCTION public.desk_update_report(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_update_report(uuid, text, text, text)
  TO authenticated, service_role;


DROP POLICY IF EXISTS "Desk updates reports" ON public.reports;
CREATE POLICY "Desk updates reports" ON public.reports FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());


