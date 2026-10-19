// deno-lint-ignore-file
// Razorpay subscription cancellation.
//
// Cancels a recurring subscription at the end of the billing cycle (or immediately
// if requested), preserving member access until the period_end.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.1";
import { rateLimitError } from "../_shared/rate-limit.ts";
import { cronAuthError } from "../_shared/cron-auth.ts";

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

  const payload = (await req.json().catch(() => null)) as { mode?: string } | null;

  // ---------------------------------------------------------------------------
  // Unattended mode: drain mandates whose member no longer exists.
  //
  // delete-account cancels billing before it deletes the profile, but a provider
  // outage there must not be allowed to block an erasure request — so a failure
  // leaves an orphaned row (subscriptions.user_id IS NULL, 20261106000100) and
  // this job retries hourly. Without it, "I deleted my account" and "the debit
  // continued" were both true at once, with no record left to fix it.
  //
  // Checked BEFORE the Bearer requirement below: pg_cron has no caller identity
  // by design (see _shared/cron-auth.ts), and the gateway JWT it presents is the
  // service-role key, which caller.auth.getUser() would reject.
  // ---------------------------------------------------------------------------
  if (payload?.mode === "reconcile-orphans") {
    const cronError = cronAuthError(req);
    if (cronError) return cronError;

    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return json({ error: "Payments are not configured" }, 503);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: orphans, error: orphanError } = await admin.rpc("orphaned_subscriptions");
    if (orphanError) return json({ error: orphanError.message }, 500);

    const failures: string[] = [];
    let cancelled = 0;

    for (const orphan of (orphans ?? []) as Array<{
      id: string;
      razorpay_subscription_id: string;
    }>) {
      try {
        await razorpay(`/subscriptions/${orphan.razorpay_subscription_id}/cancel`, {
          method: "POST",
          body: JSON.stringify({ cancel_at_cycle_end: 0 }),
        });
        await admin
          .from("subscriptions")
          .update({
            status: "cancelled",
            updated_at: new Date().toISOString(),
            last_event_at: new Date().toISOString(),
          })
          .eq("id", orphan.id);
        cancelled++;
      } catch (err) {
        // Left in place for the next run: the surviving row IS the retry record,
        // which is the whole reason the FK became ON DELETE SET NULL.
        failures.push(orphan.id);
        console.error(
          "razorpay-cancel: orphan drain failed for",
          orphan.id,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return json({ ok: true, mode: "reconcile-orphans", cancelled, failed: failures.length });
  }

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

  // Cancellation hits the Razorpay API and writes money state: 30s per-user
  // cooldown against double-click / replay storms.
  const limited = await rateLimitError(SUPABASE_URL, SERVICE_KEY, user.id, {
    purpose: "rate_limit_subscription_cancel",
    cooldownMs: 30_000,
    message: "A cancellation request is already processing. Please wait a moment.",
  });
  if (limited) return limited;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Locate the caller's live subscription. Only active, authenticated, or pending
  // subscriptions can be cancelled (guaranteed at most one by idx_subscriptions_one_live).
  const { data: sub, error: subError } = await admin
    .from("subscriptions")
    .select("id, razorpay_subscription_id, status, cancel_at_period_end, period_end")
    .eq("user_id", user.id)
    .in("status", ["active", "authenticated", "pending"])
    .maybeSingle();

  if (subError) {
    console.error("razorpay-cancel: subscription lookup failed:", subError.message);
    return json({ error: "Could not load your subscription. Please try again." }, 500);
  }
  if (!sub) return json({ error: "No active subscription found to cancel." }, 404);

  if (sub.cancel_at_period_end) {
    return json({
      ok: true,
      message:
        "Subscription is already scheduled for cancellation at the end of the current billing cycle.",
      period_end: sub.period_end,
    });
  }

  // A row carrying a real Razorpay subscription id may only be recorded as
  // cancelled once the provider has confirmed it. Previously a failed (or
  // unconfigured) provider call fell through to the database update below,
  // which set cancel_at_period_end and told the member billing would stop while
  // Razorpay kept charging at cycle end. Divergence like that is now surfaced
  // instead of swallowed; the razorpay-webhook remains the reconciliation path
  // if the subscription was cancelled out of band.
  if (sub.razorpay_subscription_id) {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return json(
        {
          error: "Cancellation is temporarily unavailable. Please contact the membership desk.",
        },
        503,
      );
    }
    try {
      await razorpay(`/subscriptions/${sub.razorpay_subscription_id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ cancel_at_cycle_end: 1 }),
      });
    } catch (err) {
      console.error(
        "razorpay-cancel: provider cancellation failed:",
        err instanceof Error ? err.message : err,
      );
      return json(
        {
          error:
            "The payment provider could not schedule this cancellation, so nothing has changed. Please try again shortly.",
        },
        502,
      );
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

  if (updateError) {
    // The provider has already scheduled the cancellation, so this is the one
    // case where the member must be told to check with a human: their tier will
    // stop at the provider while the row here still says otherwise.
    console.error("razorpay-cancel: row update failed after provider cancel:", updateError.message);
    return json(
      {
        error:
          "Your cancellation was recorded with the payment provider but not saved here. Please contact the membership desk so we can reconcile it.",
      },
      500,
    );
  }

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
