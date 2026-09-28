CREATE TABLE IF NOT EXISTS public.subscription_plans (
  code text NOT NULL PRIMARY KEY,
  label text NOT NULL,
  amount_paise integer NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  intro_requests integer,
  placement_weight int NOT NULL DEFAULT 0,
  razorpay_plan_id text,
  active boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  CONSTRAINT subscription_plans_amount_positive CHECK (amount_paise > 0),
  CONSTRAINT subscription_plans_requests_positive CHECK (intro_requests IS NULL OR intro_requests > 0)
);
GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT ALL ON public.subscription_plans TO service_role;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans are public" ON public.subscription_plans FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.subscription_plans (code, label, amount_paise, intro_requests, placement_weight, display_order)
VALUES ('concierge', 'Concierge', 149900, 20, 10, 1), ('founder', 'Founder', 399900, NULL, 50, 2)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, amount_paise = excluded.amount_paise, intro_requests = excluded.intro_requests, placement_weight = excluded.placement_weight, display_order = excluded.display_order;
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES public.subscription_plans(code),
  razorpay_subscription_id text NOT NULL UNIQUE,
  razorpay_order_id text,
  status text NOT NULL DEFAULT 'created',
  requests_used int NOT NULL DEFAULT 0,
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_status_valid CHECK (status IN ('created','authenticated','active','pending','halted','cancelled','expired','completed')),
  CONSTRAINT subscriptions_requests_nonneg CHECK (requests_used >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_live ON public.subscriptions(user_id) WHERE status IN ('created', 'authenticated', 'active', 'pending');
CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay ON public.subscriptions(razorpay_subscription_id);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own subscription read" ON public.subscriptions;
CREATE POLICY "Own subscription read" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE OR REPLACE FUNCTION public.entitlement(_user uuid)
RETURNS TABLE (plan_code text, placement_weight integer, intro_requests integer, requests_used integer, requests_remaining integer, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH live AS (
    SELECT s.*, pl.code AS plan, pl.placement_weight AS weight, pl.intro_requests AS allowance
    FROM public.subscriptions s
    JOIN public.subscription_plans pl ON pl.code = s.plan_code AND pl.active
    WHERE s.user_id = _user AND s.status IN ('created', 'authenticated', 'active', 'pending')
    ORDER BY array_position(ARRAY['active', 'authenticated', 'pending', 'created'], s.status), s.created_at DESC
    LIMIT 1
  )
  SELECT coalesce(live.plan, 'free'), coalesce(live.weight, 0), live.allowance, coalesce(live.requests_used, 0),
    CASE WHEN live.allowance IS NULL AND live.id IS NOT NULL THEN NULL ELSE greatest(0, coalesce(live.allowance, 0) - coalesce(live.requests_used, 0)) END,
    live.id IS NOT NULL
  FROM (SELECT 1) AS _ LEFT JOIN live ON true
$$;
REVOKE EXECUTE ON FUNCTION public.entitlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entitlement(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.can_send_introduction(_user uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT e.requests_remaining IS NULL OR e.requests_remaining > 0 FROM public.entitlement(_user) e WHERE e.active), false)
$$;
REVOKE EXECUTE ON FUNCTION public.can_send_introduction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_send_introduction(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.placement_weight(_user uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT e.placement_weight FROM public.entitlement(_user) e), 0)
$$;
REVOKE EXECUTE ON FUNCTION public.placement_weight(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.placement_weight(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.record_intro_usage(_user uuid DEFAULT auth.uid())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sub uuid;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;
  SELECT id INTO _sub FROM public.subscriptions
  WHERE user_id = _user AND status IN ('created', 'authenticated', 'active', 'pending')
  ORDER BY array_position(ARRAY['active', 'authenticated', 'pending', 'created'], status), created_at DESC
  LIMIT 1;
  IF _sub IS NULL THEN RETURN; END IF;
  UPDATE public.subscriptions SET requests_used = requests_used + 1, updated_at = now() WHERE id = _sub;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_intro_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intro_usage(uuid) TO service_role;