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
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET");

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

serve(async (req) => {
  // Razorpay calls POST only; no browser preflight is expected.
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !WEBHOOK_SECRET) {
    return json({ error: "Server configuration error" }, 500);
  }

  // Read once as text: re-serialising the parsed JSON would change the bytes
  // and the signature would no longer match.
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

  // Create the service-role client once and reuse throughout the handler.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // F-02: Idempotency via event_id dedup.
  // Razorpay signs only the body (no timestamp envelope), so a captured,
  // validly-signed request is replayable indefinitely. We store the Razorpay
  // event.id in a dedup table; any id we have seen before gets a 200
  // immediately without touching the subscriptions table.
  // The unique constraint on webhook_events.event_id turns a duplicate into
  // a conflict; ON CONFLICT DO NOTHING means the insert is a no-op on replay.
  const eventId = event.id ?? null;
  if (eventId) {
    const { error: dedupError } = await admin
      .from("webhook_events")
      .insert({ event_id: eventId, event_type: event.event ?? null });
    if (dedupError) {
      // error code 23505 = unique_violation: this event was already processed.
      if (dedupError.code === "23505") {
        console.info("razorpay-webhook: duplicate event_id, skipping", eventId);
        return json({ ok: true, ignored: true, duplicate: true, event: event.event });
      }
      // Any other dedup error: log and continue rather than dropping the event.
      console.warn("razorpay-webhook: dedup insert failed, continuing:", dedupError.message);
    }
  }

  const entity = (event.payload?.subscription?.entity ?? event.payload?.entity ?? {}) as
    SubscriptionEntity | InvoiceEntity;
  const rzpSubscriptionId =
    (event.payload?.subscription?.entity as SubscriptionEntity)?.id ?? entity.id;

  if (!rzpSubscriptionId) {
    // Some events (a failed payment) carry no subscription entity we act on.
    return json({ ok: true, ignored: true, event: event.event });
  }

  // Entitlement is keyed on the Razorpay subscription, never on a user id
  // from the payload: a forged-but-signed-for-another-subscription body would
  // otherwise be able to credit the wrong member.
  const { data: existing } = await admin
    .from("subscriptions")
    .select("id, status, updated_at")
    .eq("razorpay_subscription_id", rzpSubscriptionId)
    .maybeSingle();

  // Event ordering: Razorpay signs the body only (no timestamp envelope),
  // so a captured old event replays validly. Ignore events older than the
  // row's last write, and never regress a terminal state (halted /
  // cancelled / completed / expired) back to an entitling one.
  const eventTime = (event as { created_at?: number }).created_at
    ? new Date((event as { created_at?: number }).created_at! * 1000).toISOString()
    : null;
  if (existing && eventTime && existing.updated_at && eventTime < existing.updated_at) {
    return json({ ok: true, ignored: true, stale: true, event: event.event });
  }
  const TERMINAL = new Set(["halted", "cancelled", "completed", "expired"]);
  const regressing = !!existing && TERMINAL.has(existing.status) && event.event === "invoice.paid";
  if (regressing) {
    return json({ ok: true, ignored: true, terminal: existing.status, event: event.event });
  }

  const status = entity.status ?? "created";
  const periodStart = iso((entity as SubscriptionEntity).current_start);
  const periodEnd = iso((entity as SubscriptionEntity).current_end);
  const invoice = event.payload?.invoice?.entity as InvoiceEntity | undefined;

  switch (event.event) {
    // Money received: activate and reset the monthly allowance.
    case "subscription.activated":
    case "subscription.authenticated": {
      const patch: Record<string, unknown> = {
        status,
        period_start: periodStart,
        period_end: periodEnd,
        cancel_at_period_end: Boolean((entity as SubscriptionEntity).cancel_at_cycle_end),
        updated_at: new Date().toISOString(),
      };
      if (event.event === "subscription.activated") patch.requests_used = 0;
      if (invoice?.id) patch.razorpay_order_id = String(invoice.id);
      if (existing) {
        await admin.from("subscriptions").update(patch).eq("id", existing.id);
      }
      break;
    }

    // A new billing period: the allowance refills, it does not accumulate.
    case "invoice.paid": {
      if (existing) {
        await admin
          .from("subscriptions")
          .update({
            status: "active",
            requests_used: 0,
            period_start: iso(invoice?.period_start) ?? periodStart,
            period_end: iso(invoice?.period_end) ?? periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }
      break;
    }

    // Payment failed but Razorpay is still retrying: keep the entitlement and
    // let the dunning play out, rather than cutting a member off instantly.
    case "invoice.payment_failed":
    case "subscription.pending": {
      if (existing) {
        await admin
          .from("subscriptions")
          .update({ status: "pending", updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      }
      break;
    }

    case "subscription.halted":
    case "subscription.cancelled":
    case "subscription.completed":
    case "subscription.expired": {
      if (existing) {
        await admin
          .from("subscriptions")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      }
      break;
    }

    default:
      return json({ ok: true, ignored: true, event: event.event });
  }

  return json({ ok: true, event: event.event });
});
