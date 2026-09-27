-- ===========================================================================
-- 20261008: Razorpay subscription tiers.
--
-- Two paid tiers, and what they buy is placement and volume:
--   * concierge — priority placement in the directory, a monthly allowance of
--     introduction requests.
--   * founder   — priority placement, no cap on introduction requests.
--
-- One-to-one video calling is deliberately NOT behind the paywall. It runs
-- browser-to-browser, costs us nothing to serve, and it is the moment a
-- matched pair most needs it — charging for it would be charging members for
-- the product working.
--
-- Razorpay is the source of truth for payment state. This table is a local
-- mirror, written only by the webhook-verified service role, and every
-- entitlement decision is made from it in a SECURITY DEFINER function so the
-- client cannot grant itself a tier.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Plan catalogue. Reference data, not user data: readable by everyone so
-- the pricing page can render without a round trip.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  code text NOT NULL PRIMARY KEY,
  label text NOT NULL,
  -- Paise per month. Integer money, no floats.
  amount_paise integer NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  -- Introduction requests allowed per billing month. NULL = unlimited.
  intro_requests integer,
  -- Directory weighting: higher sorts first when relevance is otherwise equal.
  placement_weight int NOT NULL DEFAULT 0,
  -- Razorpay plan ids, set per environment after the plans are created.
  razorpay_plan_id text,
  active boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  CONSTRAINT subscription_plans_amount_positive CHECK (amount_paise > 0),
  CONSTRAINT subscription_plans_requests_positive CHECK (intro_requests IS NULL OR intro_requests > 0)
);

GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT ALL ON public.subscription_plans TO service_role;

INSERT INTO public.subscription_plans (code, label, amount_paise, intro_requests, placement_weight, display_order)
VALUES
  ('concierge', 'Concierge', 149900, 20, 10, 1),
  ('founder',   'Founder',   399900, NULL, 50, 2)
ON CONFLICT (code) DO UPDATE
  SET label = excluded.label,
      amount_paise = excluded.amount_paise,
      intro_requests = excluded.intro_requests,
      placement_weight = excluded.placement_weight,
      display_order = excluded.display_order;

-- ---------------------------------------------------------------------------
-- 2. Subscriptions. One live subscription per member.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES public.subscription_plans(code),
  -- Razorpay's own identifiers. subscription_id is the billing relationship;
  -- order_id is the payment that created it.
  razorpay_subscription_id text NOT NULL UNIQUE,
  razorpay_order_id text,
  status text NOT NULL DEFAULT 'created',
  -- Introduction requests sent in the current billing period, reset by the
  -- webhook on each invoice.paid.
  requests_used int NOT NULL DEFAULT 0,
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_status_valid CHECK (status IN (
    'created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'expired', 'completed'
  )),
  CONSTRAINT subscriptions_requests_nonneg CHECK (requests_used >= 0)
);

-- The entitlement lookup is "the member's live subscription, if any".
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_live
  ON public.subscriptions(user_id)
  WHERE status IN ('created', 'authenticated', 'active', 'pending');

CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay
  ON public.subscriptions(razorpay_subscription_id);

-- The member reads their own; they never write. service_role is the only
-- writer, so a browser cannot grant, extend or downgrade itself.
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own subscription read" ON public.subscriptions;
CREATE POLICY "Own subscription read" ON public.subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Entitlement. The single source of truth for "what does this member get".
-- ---------------------------------------------------------------------------
-- Called from RLS, so it must be SECURITY DEFINER (it reads a table the
-- caller cannot) and STABLE (RLS calls it once per row).
--
-- Returns a row for EVERY member, paid or not: a free member gets
-- placement_weight 0 and an allowance of 0, so callers never have to reason
-- about a missing row meaning "free".
--
-- The active subscription is chosen with an explicit order, never with a bare
-- LIMIT 1. The unique index makes at most one *paid* row, but a member who
-- churned and later resubscribes can have both a 'created' row and an
-- 'active' one, and the entitlement must follow the live one. An
-- order-insensitive LIMIT here would hand the answer to the database planner.
CREATE OR REPLACE FUNCTION public.entitlement(_user uuid)
RETURNS TABLE (
  plan_code text,
  placement_weight integer,
  intro_requests integer,
  requests_used integer,
  requests_remaining integer,
  active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH live AS (
    SELECT s.*, pl.code AS plan, pl.placement_weight AS weight, pl.intro_requests AS allowance
    FROM public.subscriptions s
    JOIN public.subscription_plans pl
      ON pl.code = s.plan_code
     AND pl.active
    WHERE s.user_id = _user
      AND s.status IN ('created', 'authenticated', 'active', 'pending')
    -- Most authoritative state first, then the newest row.
    ORDER BY
      array_position(
        ARRAY['active', 'authenticated', 'pending', 'created'],
        s.status
      ),
      s.created_at DESC
    LIMIT 1
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
  LEFT JOIN live ON true
$$;

REVOKE EXECUTE ON FUNCTION public.entitlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entitlement(uuid) TO authenticated, service_role;

-- May this member still send an introduction request this period? A free
-- member has an allowance of 0, so this is false without a separate branch.
CREATE OR REPLACE FUNCTION public.can_send_introduction(_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT e.requests_remaining IS NULL OR e.requests_remaining > 0
     FROM public.entitlement(_user) e
     WHERE e.active),
    false
  )
$$;

REVOKE EXECUTE ON FUNCTION public.can_send_introduction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_send_introduction(uuid) TO authenticated, service_role;

-- Directory ranking weight. Returns 0 for a free member rather than NULL so a
-- sort key never has to be coalesced at the call site.
CREATE OR REPLACE FUNCTION public.placement_weight(_user uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT e.placement_weight FROM public.entitlement(_user) e), 0)
$$;

REVOKE EXECUTE ON FUNCTION public.placement_weight(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.placement_weight(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Usage accrual.
-- ---------------------------------------------------------------------------
-- Takes the *member*, not a subscription id: the browser has no business
-- holding that id, and a self-resolving lookup cannot be pointed at somebody
-- else's row. Called by the server when it accepts an introduction request,
-- so a modified browser cannot inflate its own allowance.
CREATE OR REPLACE FUNCTION public.record_intro_usage(_user uuid DEFAULT auth.uid())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sub uuid;
BEGIN
  IF _user IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO _sub
  FROM public.subscriptions
  WHERE user_id = _user
    AND status IN ('created', 'authenticated', 'active', 'pending')
  ORDER BY
    array_position(ARRAY['active', 'authenticated', 'pending', 'created'], status),
    created_at DESC
  LIMIT 1;

  IF _sub IS NULL THEN
    RETURN; -- free member: nothing to accrue against
  END IF;

  UPDATE public.subscriptions
  SET requests_used = requests_used + 1,
      updated_at = now()
  WHERE id = _sub;
END; $$;

REVOKE EXECUTE ON FUNCTION public.record_intro_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intro_usage(uuid) TO service_role;
