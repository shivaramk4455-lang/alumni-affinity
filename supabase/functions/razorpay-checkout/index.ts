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
    // Every outbound provider call carries a deadline. Without one, a stalled
    // Razorpay socket holds the invocation open until the platform kills it —
    // and this function makes up to three of these calls per checkout, so a
    // provider slowdown used to become checkout latency for the member.
    signal: init.signal ?? AbortSignal.timeout(10_000),
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

/**
 * Cancel a Razorpay subscription object that must not survive.
 *
 * `cancel_at_cycle_end: 0` cancels immediately rather than at the end of the
 * billing cycle. This is only ever called for an object created by a checkout
 * that then lost the race, so it has never been funded — leaving it alive
 * would mean a second live auto-debit mandate and a second monthly debit.
 */
async function cancelRzpSubscription(subscriptionId: string): Promise<void> {
  try {
    await razorpay(`/subscriptions/${subscriptionId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancel_at_cycle_end: 0 }),
    });
  } catch (err) {
    // Never let a cleanup failure mask the original response. The orphan
    // drain (razorpay-cancel, hourly) reconciles anything left behind.
    console.error(
      "razorpay-checkout: could not cancel the losing subscription",
      subscriptionId,
      err instanceof Error ? err.message : err,
    );
  }
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

  // F-07 & F-10: check for existing subscriptions and guard duplicate in-flight checkouts.
  // 1. Prevent subscribing if already on an active or authenticated tier.
  // 2. Reuse recent (<15m) uncompleted 'created' checkout session for the same plan
  //    to prevent spawning orphan Razorpay subscription objects.
  // 3. Throttle requests made within 10 seconds of each other.
  //
  // This is an OPTIMISATION, not the decision. It saves a provider call in the
  // common case. The authoritative, race-free decision is claim_checkout_slot()
  // further down, which runs after the provider call because the provider hands
  // out the subscription id the claim has to record.
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

    // A failed renewal leaves the mandate ALIVE at the provider — Razorpay does
    // not cancel a subscription because one invoice failed. Minting a second
    // Razorpay subscription here would hand the member two mandates, i.e. two
    // debits. So the row that failed is the one to retry: return its id and let
    // the member pay the same mandate again.
    const pendingSub = existingSubs.find((s) => s.status === "pending");
    if (pendingSub) {
      if (pendingSub.plan_code !== plan.code) {
        return json(
          {
            error:
              "A payment for a different tier is still unresolved. Please contact the membership desk.",
          },
          409,
        );
      }
      return json({
        key_id: RAZORPAY_KEY_ID,
        subscription_id: pendingSub.razorpay_subscription_id,
        plan_code: plan.code,
        amount_paise: plan.amount_paise,
        currency: plan.currency,
      });
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

      // Persist plan ID so subsequent checkouts reuse this plan instead of
      // creating duplicate plans. The IS NULL guard means a concurrent
      // checkout that already wrote an id is not clobbered.
      await admin
        .from("subscription_plans")
        .update({ razorpay_plan_id: rzpPlan.id })
        .eq("code", plan.code)
        .is("razorpay_plan_id", null);

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
    console.error("razorpay-checkout: provider error:", err instanceof Error ? err.message : err);
    return json({ error: "The payment provider is unavailable. Please try again shortly." }, 502);
  }

  // ---- The atomic decision ------------------------------------------------
  // The read above and this insert used to be two separate statements with a
  // provider call in between, so two concurrent checkouts (a double click, two
  // tabs, a retrying client) both saw an empty table, both created a Razorpay
  // subscription object, and both inserted a 'created' row.
  //
  // The partial unique index cannot catch that: idx_subscriptions_one_live
  // deliberately excludes 'created' so an abandoned checkout cannot block a new
  // one. The consequence was two live auto-debit mandates and two monthly
  // debits for a single paid tier — supersedeOtherOpenRows in the webhook
  // rewrote the losing LOCAL row but never cancelled the losing mandate.
  //
  // claim_checkout_slot() is the single authoritative decision point. It holds
  // an advisory transaction lock for this member, so concurrent checkouts
  // serialise, and it returns one verdict we must obey. When we lose the race
  // the Razorpay subscription we just created is cancelled at the provider, so
  // the losing mandate never debits.
  const { data: claim, error: claimError } = await admin.rpc("claim_checkout_slot", {
    _user: user.id,
    _plan_code: plan.code,
    _rzp_subscription_id: String(subscription.id),
  });

  if (claimError || !claim || claim.length === 0) {
    console.error("razorpay-checkout: checkout claim failed:", claimError?.message);
    await cancelRzpSubscription(String(subscription.id));
    return json({ error: "Could not start checkout. Please try again." }, 500);
  }

  const verdict = String(claim[0].verdict ?? "");
  const existingSubscriptionId = claim[0].existing_subscription_id as string | null;

  if (verdict === "claimed") {
    return json({
      key_id: RAZORPAY_KEY_ID,
      subscription_id: subscription.id,
      plan_code: plan.code,
      amount_paise: plan.amount_paise,
      currency: plan.currency,
    });
  }

  // We did not win. The provider object we just created must not survive, or
  // it becomes a second live mandate.
  await cancelRzpSubscription(String(subscription.id));

  if (verdict === "reuse") {
    // Another checkout for this plan is already in flight. Point the member at
    // that one rather than opening a second Razorpay modal.
    return json({
      key_id: RAZORPAY_KEY_ID,
      subscription_id: existingSubscriptionId,
      plan_code: plan.code,
      amount_paise: plan.amount_paise,
      currency: plan.currency,
    });
  }
  if (verdict === "already_active") {
    return json({ error: "You already have an active subscription" }, 409);
  }
  if (verdict === "already_pending") {
    return json({ error: "A payment is still being resolved. Please try again in a moment." }, 409);
  }
  if (verdict === "other_plan") {
    return json(
      {
        error:
          "A checkout for a different tier is already in progress. Please contact the membership desk.",
      },
      409,
    );
  }
  if (verdict === "too_soon") {
    return json({ error: "Please wait a moment before starting another checkout" }, 429);
  }

  return json({ error: "Could not start checkout. Please try again." }, 409);
});
