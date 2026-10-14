// deno-lint-ignore-file
// Razorpay webhook.
//
// This is the only place an entitlement is granted, so the signature check is
// the whole security boundary: an unverified body must not be able to mark a
// subscription active. Verification is HMAC-SHA256 over the RAW body bytes,
// compared in constant time.
//
// Razorpay retries on a non-2xx, so handlers are written to be idempotent:
// every branch is an UPDATE keyed on razorpay_subscription_id, and the
// period-reset only happens on a paid invoice.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");

// No CORS headers on this function: it is called only by Razorpay's servers,
// never from a browser. Returning Access-Control-Allow-Origin: * would invite
// browser-based probing; the HMAC signature check is the entire boundary.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Constant-time comparison; a plain === leaks the digest one byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify(body: string, signature: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(expected, signature.trim().toLowerCase());
}

type SubscriptionEntity = {
  id?: string;
  status?: string;
  plan_id?: string;
  current_start?: number;
  current_end?: number;
  cancel_at_cycle_end?: number;
  notes?: Record<string, string>;
  created_at?: number;
};

type InvoiceEntity = {
  id?: string;
  subscription_id?: string;
  status?: string;
  period_start?: number;
  period_end?: number;
};

const iso = (seconds?: number) => (seconds ? new Date(seconds * 1000).toISOString() : null);

const TERMINAL = new Set(["halted", "cancelled", "completed", "expired"]);

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !WEBHOOK_SECRET) {
    return json({ error: "Server configuration error" }, 500);
  }

  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  if (!(await verify(raw, signature))) {
    console.warn("razorpay-webhook: bad signature");
    return json({ error: "Invalid signature" }, 401);
  }

  let event: {
    event?: string;
    id?: string;
    payload?: Record<string, unknown>;
    created_at?: number;
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "Malformed body" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // F-02: Idempotency check via event_id.
  // Check whether this event_id was already processed first, and record it into
  // webhook_events after the state update succeeds so a transient DB error
  // does not permanently drop a valid retry.
  const eventId = event.id ?? null;
  if (eventId) {
    const { data: seen } = await admin
      .from("webhook_events")
      .select("event_id")
      .eq("event_id", eventId)
      .maybeSingle();
    if (seen) {
      console.info("razorpay-webhook: duplicate event_id, skipping", eventId);
      return json({ ok: true, ignored: true, duplicate: true, event: event.event });
    }
  }

  const subPayload = (
    event.payload as { subscription?: { entity?: SubscriptionEntity } } | undefined
  )?.subscription?.entity;
  const invPayload = (event.payload as { invoice?: { entity?: InvoiceEntity } } | undefined)
    ?.invoice?.entity;
  const genericEntity = (
    event.payload as { entity?: SubscriptionEntity & InvoiceEntity } | undefined
  )?.entity;

  const entity: SubscriptionEntity & InvoiceEntity = subPayload ?? genericEntity ?? {};
  const rzpSubscriptionId =
    subPayload?.id ?? invPayload?.subscription_id ?? entity.subscription_id ?? entity.id;

  if (!rzpSubscriptionId) {
    return json({ ok: true, ignored: true, event: event.event });
  }

  const { data: existing, error: fetchError } = await admin
    .from("subscriptions")
    .select("id, status, period_start, period_end, updated_at")
    .eq("razorpay_subscription_id", rzpSubscriptionId)
    .maybeSingle();

  if (fetchError) {
    return json({ error: fetchError.message }, 500);
  }

  if (!existing) {
    return json({ ok: true, ignored: true, reason: "unknown_subscription", event: event.event });
  }

  // State-machine monotonic ordering guard:
  // Never compare Razorpay's `event.created_at` against `existing.updated_at`
  // because `existing.updated_at` is modified by `mirror_intro_usage()` on
  // every sent introduction and by wall-clock arrival of `subscription.authenticated`
  // (which Razorpay creates within the same second as `subscription.activated`
  // and `invoice.paid`). Instead:
  //  1. Never allow a terminal state (halted/cancelled/completed/expired) to
  //     regress back to an entitling state.
  //  2. Never allow an out-of-order `subscription.authenticated` to downgrade
  //     an already `active` subscription back to `authenticated`.
  if (
    TERMINAL.has(existing.status) &&
    (event.event === "subscription.authenticated" ||
      event.event === "subscription.activated" ||
      event.event === "subscription.pending" ||
      event.event === "invoice.paid" ||
      event.event === "invoice.payment_failed")
  ) {
    return json({ ok: true, ignored: true, terminal: existing.status, event: event.event });
  }

  const rawStatus = entity.status ?? "created";
  const periodStart = iso(entity.current_start);
  const periodEnd = iso(entity.current_end);

  let updateError: { message: string } | null = null;

  switch (event.event) {
    case "subscription.activated":
    case "subscription.authenticated": {
      const nextStatus =
        event.event === "subscription.activated"
          ? "active"
          : existing.status === "active"
            ? "active"
            : rawStatus === "created"
              ? "authenticated"
              : rawStatus;

      const patch: Record<string, unknown> = {
        status: nextStatus,
        period_start: periodStart ?? existing.period_start,
        period_end: periodEnd ?? existing.period_end,
        cancel_at_period_end: Boolean(entity.cancel_at_cycle_end),
        updated_at: new Date().toISOString(),
      };
      if (event.event === "subscription.activated") patch.requests_used = 0;
      if (invPayload?.id) patch.razorpay_order_id = String(invPayload.id);

      const { error } = await admin.from("subscriptions").update(patch).eq("id", existing.id);
      updateError = error;
      break;
    }

    case "invoice.paid": {
      const { error } = await admin
        .from("subscriptions")
        .update({
          status: "active",
          requests_used: 0,
          period_start: iso(invPayload?.period_start) ?? periodStart ?? existing.period_start,
          period_end: iso(invPayload?.period_end) ?? periodEnd ?? existing.period_end,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      updateError = error;
      break;
    }

    case "invoice.payment_failed":
    case "subscription.pending": {
      const { error } = await admin
        .from("subscriptions")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      updateError = error;
      break;
    }

    case "subscription.halted":
    case "subscription.cancelled":
    case "subscription.completed":
    case "subscription.expired": {
      const terminalStatus = event.event.replace("subscription.", "");
      const { error } = await admin
        .from("subscriptions")
        .update({
          status: TERMINAL.has(rawStatus) ? rawStatus : terminalStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      updateError = error;
      break;
    }

    default:
      return json({ ok: true, ignored: true, event: event.event });
  }

  if (updateError) {
    console.error("razorpay-webhook: subscription update failed:", updateError.message);
    return json({ error: updateError.message }, 500);
  }

  if (eventId) {
    const { error: dedupError } = await admin
      .from("webhook_events")
      .insert({ event_id: eventId, event_type: event.event ?? null });
    if (dedupError && dedupError.code !== "23505") {
      console.warn("razorpay-webhook: dedup insert warning:", dedupError.message);
    }
  }

  return json({ ok: true, event: event.event });
});
