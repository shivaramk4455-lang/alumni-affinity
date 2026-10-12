// deno-lint-ignore-file
// Razorpay checkout-session creation.
//
// Creates a Razorpay subscription for the caller's plan and returns the
// details the browser needs to open Razorpay's checkout modal. No payment is
// taken here: Razorpay collects it, and the webhook is what actually grants
// the entitlement.
//
// The caller's JWT is validated with the anon key. The service key is used
// only to talk to Razorpay — never as the credential for auth.getUser(),
// because that would accept a forged token.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET");

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

async function razorpay(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      // Razorpay uses HTTP basic auth with key id + secret.
      authorization: `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`razorpay ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY)
    return json({ error: "Server configuration error" }, 500);
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET)
    return json({ error: "Payments are not configured" }, 503);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body = (await req.json().catch(() => null)) as { plan_code?: string } | null;

  const { data: plan, error: planError } = await admin
    .from("subscription_plans")
    .select("code, label, amount_paise, currency, razorpay_plan_id, active, sellable")
    .eq("code", body?.plan_code ?? "")
    .maybeSingle();
  if (planError) return json({ error: planError.message }, 500);
  if (!plan || !plan.active) return json({ error: "Unknown plan" }, 400);
  // Retired tiers keep entitling their payers but are never sold again.
  if (!plan.sellable) return json({ error: "This tier is no longer offered" }, 403);

  // F-07 & F-10: Check for existing subscriptions and guard duplicate in-flight checkouts.
  // 1. Prevent subscribing if already on an active or authenticated tier.
  // 2. Reuse recent (<15m) uncompleted 'created' checkout session for the same plan
  //    to prevent spawning orphan Razorpay subscription objects.
  // 3. Throttle requests made within 10 seconds of each other.
  const { data: existingSubs } = await admin
    .from("subscriptions")
    .select("id, status, plan_code, razorpay_subscription_id, created_at")
    .eq("user_id", user.id)
    .in("status", ["active", "authenticated", "pending", "created"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (existingSubs && existingSubs.length > 0) {
    const activeSub = existingSubs.find(
      (s) => s.status === "active" || s.status === "authenticated",
    );
    if (activeSub) {
      return json({ error: "You already have an active subscription" }, 409);
    }

    const mostRecent = existingSubs[0];
    const ageMs = Date.now() - new Date(mostRecent.created_at).getTime();

    // Throttling: if user created a checkout attempt < 10 seconds ago, rate limit
    if (ageMs < 10_000) {
      return json({ error: "Please wait a moment before starting another checkout" }, 429);
    }

    // Reuse recent in-flight session (<15 min) for the same plan
    if (
      mostRecent.status === "created" &&
      mostRecent.plan_code === plan.code &&
      ageMs < 15 * 60_000
    ) {
      return json({
        key_id: RAZORPAY_KEY_ID,
        subscription_id: mostRecent.razorpay_subscription_id,
        plan_code: plan.code,
        amount_paise: plan.amount_paise,
        currency: plan.currency,
      });
    }
  }

  // The price is looked up, never taken from the client: a browser that
  // posts { plan_code: 'founder', amount: 1 } buys founder at list price.
  let subscription: Record<string, unknown>;
  try {
    if (plan.razorpay_plan_id) {
      // A pre-created Razorpay plan keeps the amount server-side at Razorpay.
      subscription = (await razorpay("/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          plan_id: plan.razorpay_plan_id,
          total_count: 12,
          quantity: 1,
          notes: { user_id: user.id, plan_code: plan.code },
        }),
      })) as Record<string, unknown>;
    } else {
      // No Razorpay plan configured yet: create an ad-hoc one for this
      // checkout. Same server-side price, just a shorter-lived object.
      const rzpPlan = (await razorpay("/plans", {
        method: "POST",
        body: JSON.stringify({
          period: "monthly",
          interval: 1,
          item: {
            name: `The Merit Circle — ${plan.label}`,
            amount: plan.amount_paise,
            currency: plan.currency,
          },
          notes: { plan_code: plan.code },
        }),
      })) as { id: string };

      // Persist plan ID so subsequent checkouts reuse this plan instead of creating duplicate plans
      await admin
        .from("subscription_plans")
        .update({ razorpay_plan_id: rzpPlan.id })
        .eq("code", plan.code);

      subscription = (await razorpay("/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          plan_id: rzpPlan.id,
          total_count: 12,
          quantity: 1,
          notes: { user_id: user.id, plan_code: plan.code },
        }),
      })) as Record<string, unknown>;
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 502);
  }

  // Mirror the row before the payment. Status stays non-entitling until the
  // webhook says paid, so a checkout that is abandoned leaves only a
  // harmless 'created' row.
  const { error: insertError } = await admin.from("subscriptions").insert({
    user_id: user.id,
    plan_code: plan.code,
    razorpay_subscription_id: String(subscription.id),
    status: "created",
  });
  if (insertError) return json({ error: insertError.message }, 500);

  return json({
    key_id: RAZORPAY_KEY_ID,
    subscription_id: subscription.id,
    plan_code: plan.code,
    amount_paise: plan.amount_paise,
    currency: plan.currency,
  });
});
