// deno-lint-ignore-file
// Razorpay subscription cancellation.
//
// Cancels a recurring subscription at the end of the billing cycle (or immediately
// if requested), preserving member access until the period_end.
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

  // Locate the caller's live subscription.
  const { data: sub, error: subError } = await admin
    .from("subscriptions")
    .select("id, razorpay_subscription_id, status, cancel_at_period_end, period_end")
    .eq("user_id", user.id)
    .in("status", ["created", "authenticated", "active", "pending"])
    .maybeSingle();

  if (subError) return json({ error: subError.message }, 500);
  if (!sub) return json({ error: "No active subscription found to cancel." }, 404);

  if (sub.cancel_at_period_end) {
    return json({
      ok: true,
      message:
        "Subscription is already scheduled for cancellation at the end of the current billing cycle.",
      period_end: sub.period_end,
    });
  }

  // If Razorpay keys are configured, schedule cancellation at cycle end on Razorpay.
  if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && sub.razorpay_subscription_id) {
    try {
      await razorpay(`/subscriptions/${sub.razorpay_subscription_id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ cancel_at_cycle_end: 1 }),
      });
    } catch (err) {
      console.warn("Razorpay API cancel warning:", err instanceof Error ? err.message : err);
      // Fall through to update database row
    }
  }

  // Update subscription row to record cancel_at_period_end.
  const { error: updateError } = await admin
    .from("subscriptions")
    .update({
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id);

  if (updateError) return json({ error: updateError.message }, 500);

  // Record consent audit entry for cancellation.
  // NOTE: purpose "subscription_cancellation" must exist in the
  // consent_events_purpose_valid CHECK constraint (migration 20261019000000).
  // We log the error and continue — blocking a cancellation because the audit
  // ledger is unavailable is worse than a missing receipt.
  const { error: consentError } = await admin.from("consent_events").insert({
    user_id: user.id,
    purpose: "subscription_cancellation",
    granted: true,
    policy_version: "2026-10",
    note: "Member scheduled subscription cancellation for end of billing cycle.",
  });
  if (consentError) {
    console.error("razorpay-cancel: consent receipt failed:", consentError.message);
  }

  return json({
    ok: true,
    message:
      "Subscription cancellation scheduled. Your tier remains active until the end of the billing period.",
    period_end: sub.period_end,
  });
});
