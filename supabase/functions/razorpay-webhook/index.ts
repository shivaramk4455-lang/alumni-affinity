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
//
// 20261106 changes (all four are audit findings, not features):
//
//  * Dedup is now CLAIM-FIRST. It used to be SELECT-then-INSERT with the INSERT
//    after the state write, so two concurrent deliveries of the same event both
//    passed the check and both applied the update; the unique index only
//    stopped the second *record*. Every branch happened to be an idempotent
//    UPDATE, so the blast radius was small — but the guard did not protect the
//    write, which is the only thing it exists to do. The claim is released on
//    failure so a retry still reprocesses; a successful "ignored" keeps it.
//
//  * Envelope freshness: a signed body carries no nonce and the dedup rows are
//    pruned after 90 days, so a captured body was replayable forever after the
//    prune. Events older than 30 days are now refused — far beyond Razorpay's
//    retry window, so no legitimate retry is affected.
//
//  * Refunds and chargebacks are handled. There was no branch for them at all:
//    an operator issuing a full refund left the row `active` and the tier live
//    permanently. A refund cannot be resolved from its own payload (it carries
//    a payment id, not a subscription id) — hence the invoice/payment columns
//    added in 20261106000100 — and an unresolvable refund is reported rather
//    than silently ignored.
//
//  * Supersede-before-activate. The checkout guard blocks only
//    active/authenticated, so a member already in `pending` could start a
//    second checkout; activating it then violated idx_subscriptions_one_live,
//    returned 500, and Razorpay retried forever. Money captured, tier never
//    granted. Closing the other open rows first makes the index impossible to
//    violate.
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
  payment_id?: string;
  status?: string;
  amount?: number;
  amount_paid?: number;
  currency?: string;
  period_start?: number;
  period_end?: number;
};

type RefundEntity = {
  id?: string;
  payment_id?: string;
  invoice_id?: string;
  amount?: number;
  notes?: Record<string, string>;
};

type DisputeEntity = {
  id?: string;
  payment_id?: string;
  amount?: number;
};

const iso = (seconds?: number) => (seconds ? new Date(seconds * 1000).toISOString() : null);

// Non-entitling terminal states. A replayed activation must never resurrect one;
// `superseded`, `refunded` and `disputed` join the original four in 20261106.
const TERMINAL = new Set([
  "halted",
  "cancelled",
  "completed",
  "expired",
  "superseded",
  "refunded",
  "disputed",
]);

// Refuse an event whose own envelope says it is older than any plausible retry.
// Razorpay retries for hours, not weeks; 30 days is chosen so the check can only
// ever reject a replay, never a retry.
const MAX_EVENT_AGE_SECONDS = 30 * 24 * 60 * 60;

const ENTITLING_EVENTS = new Set([
  "subscription.authenticated",
  "subscription.activated",
  "subscription.pending",
  "invoice.paid",
  "invoice.payment_failed",
]);

/** Rows that still hold an open billing relationship for this member. */
const OPEN_STATUSES = ["created", "authenticated", "active", "pending"];

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

  // ---- Freshness -----------------------------------------------------------
  // Checked before the claim so a stale replay leaves no row behind.
  if (
    typeof event.created_at === "number" &&
    Math.floor(Date.now() / 1000) - event.created_at > MAX_EVENT_AGE_SECONDS
  ) {
    console.warn(
      "razorpay-webhook: refusing stale event",
      event.id,
      event.event,
      new Date(event.created_at * 1000).toISOString(),
    );
    // 200, not 4xx: no retry can make this event valid, so there is nothing to
    // gain from asking Razorpay to try again.
    return json({ ok: true, ignored: true, stale: true, event: event.event });
  }

  // ---- Claim ---------------------------------------------------------------
  // Insert first: the unique index on webhook_events.event_id is what serializes
  // two concurrent deliveries. A duplicate that wins the race is discarded here,
  // before any state is touched.
  const eventId = event.id ?? null;
  if (eventId) {
    const { error: claimError } = await admin
      .from("webhook_events")
      .insert({ event_id: eventId, event_type: event.event ?? null });

    if (claimError) {
      if (claimError.code === "23505") {
        console.info("razorpay-webhook: duplicate event_id, skipping", eventId);
        return json({ ok: true, ignored: true, duplicate: true, event: event.event });
      }
      return json({ error: claimError.message }, 500);
    }
  }

  /** A failed delivery must leave no claim, or the retry would be discarded. */
  const releaseClaim = async () => {
    if (!eventId) return;
    await admin.from("webhook_events").delete().eq("event_id", eventId);
  };

  const refundEntity = (event.payload as { refund?: { entity?: RefundEntity } } | undefined)?.refund
    ?.entity;
  const disputeEntity = (event.payload as { dispute?: { entity?: DisputeEntity } } | undefined)
    ?.dispute?.entity;

  // ---- Refunds and chargebacks --------------------------------------------
  // Handled before the subscription-id requirement below: these payloads carry
  // a payment (or invoice) reference, not a subscription reference.
  if (event.event === "refund.processed" || event.event?.startsWith("payment.dispute")) {
    const target = await resolvePaidSubscription(admin, refundEntity, disputeEntity);

    if (!target) {
      // Never silent: a refund we cannot attach is money that left the business
      // while the tier stayed live.
      console.error(
        "razorpay-webhook: UNRESOLVED refund/dispute — no subscription matches payment/invoice",
        event.event,
        refundEntity?.payment_id ?? disputeEntity?.payment_id ?? "no payment id",
      );
      return json({ ok: true, ignored: true, reason: "unresolved_refund", event: event.event });
    }

    // `payment.dispute.won` means we keep the money — the desk reinstates access
    // deliberately, so this branch only records that the dispute closed.
    const isWon = event.event === "payment.dispute.won";
    if (isWon) {
      console.info("razorpay-webhook: dispute won, leaving entitlement untouched", target.id);
      return json({ ok: true, event: event.event, subscription: target.id });
    }

    const nextStatus = event.event === "refund.processed" ? "refunded" : "disputed";
    const { error } = await admin
      .from("subscriptions")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
        last_event_at: new Date().toISOString(),
      })
      .eq("id", target.id);

    if (error) {
      await releaseClaim();
      return json({ error: error.message }, 500);
    }

    console.warn(
      "razorpay-webhook: entitlement revoked by",
      event.event,
      "->",
      nextStatus,
      "subscription",
      target.id,
    );
    return json({ ok: true, event: event.event, subscription: target.id, status: nextStatus });
  }

  // ---- Subscription-scoped events -----------------------------------------
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
    .select(
      "id, user_id, plan_code, status, period_start, period_end, cancel_at_period_end, updated_at",
    )
    .eq("razorpay_subscription_id", rzpSubscriptionId)
    .maybeSingle();

  if (fetchError) {
    await releaseClaim();
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
  //  1. Never allow a terminal state (halted/cancelled/completed/expired/
  //     superseded/refunded/disputed) to regress back to an entitling state.
  //  2. Never allow an out-of-order `subscription.authenticated` to downgrade
  //     an already `active` subscription back to `authenticated`.
  if (TERMINAL.has(existing.status) && ENTITLING_EVENTS.has(event.event ?? "")) {
    return json({ ok: true, ignored: true, terminal: existing.status, event: event.event });
  }

  const rawStatus = entity.status ?? "created";
  const periodStart = iso(entity.current_start);
  const periodEnd = iso(entity.current_end);
  const nowIso = new Date().toISOString();

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
        // A re-delivery must not wipe a cancellation the member made:
        // `Boolean(undefined)` is `false`, which is how a retried
        // `subscription.authenticated` used to silently un-cancel them.
        cancel_at_period_end:
          entity.cancel_at_cycle_end === undefined
            ? existing.cancel_at_period_end
            : Boolean(entity.cancel_at_cycle_end),
        updated_at: nowIso,
        last_event_at: nowIso,
      };

      // Close any other open row BEFORE this one becomes entitling, so the
      // partial unique index can never be violated (see the file header).
      const supersedeError = await supersedeOtherOpenRows(admin, existing.user_id, existing.id);
      if (supersedeError) {
        await releaseClaim();
        return json({ error: supersedeError }, 500);
      }

      const { error } = await admin.from("subscriptions").update(patch).eq("id", existing.id);
      updateError = error;
      break;
    }

    case "invoice.paid": {
      const invoiceId = invPayload?.id ? String(invPayload.id) : null;
      const paymentId = invPayload?.payment_id ? String(invPayload.payment_id) : null;
      const amountPaise =
        typeof invPayload?.amount_paid === "number"
          ? invPayload.amount_paid
          : typeof invPayload?.amount === "number"
            ? invPayload.amount
            : null;

      // Reconcile what was actually charged against what the plan advertises.
      // A mismatch does NOT block activation — the member paid, so they get
      // access — but it is persisted and logged loudly, because the only other
      // way to notice is a member complaint. The row itself is the record:
      // compare `amount_paid_paise` against `subscription_plans.amount_paise`.
      if (amountPaise !== null) {
        const { data: plan } = await admin
          .from("subscription_plans")
          .select("amount_paise, currency")
          .eq("code", existing.plan_code)
          .maybeSingle();

        if (plan && typeof plan.amount_paise === "number" && plan.amount_paise !== amountPaise) {
          console.error(
            "razorpay-webhook: AMOUNT MISMATCH — charged",
            amountPaise,
            "against plan",
            existing.plan_code,
            "which advertises",
            plan.amount_paise,
            "(subscription",
            rzpSubscriptionId,
            ")",
          );
        }
      }

      const supersedeError = await supersedeOtherOpenRows(admin, existing.user_id, existing.id);
      if (supersedeError) {
        await releaseClaim();
        return json({ error: supersedeError }, 500);
      }

      const { error } = await admin
        .from("subscriptions")
        .update({
          status: "active",
          requests_used: 0,
          period_start: iso(invPayload?.period_start) ?? periodStart ?? existing.period_start,
          period_end: iso(invPayload?.period_end) ?? periodEnd ?? existing.period_end,
          razorpay_invoice_id: invoiceId,
          razorpay_payment_id: paymentId,
          amount_paid_paise: amountPaise,
          currency: invPayload?.currency ?? null,
          updated_at: nowIso,
          last_event_at: nowIso,
        })
        .eq("id", existing.id);
      updateError = error;
      break;
    }

    case "invoice.payment_failed":
    case "subscription.pending": {
      // `pending` is the payment-failure state and does NOT entitle
      // (private.subscription_is_live, 20261106000000). It is still written
      // because the desk and the member both need to see that a renewal failed.
      const { error } = await admin
        .from("subscriptions")
        .update({ status: "pending", updated_at: nowIso, last_event_at: nowIso })
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
          updated_at: nowIso,
          last_event_at: nowIso,
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
    // Release the claim so Razorpay's retry can actually reprocess this event.
    await releaseClaim();
    return json({ error: updateError.message }, 500);
  }

  return json({ ok: true, event: event.event });
});

/**
 * Close every other open row for this member. Returns an error message, or null.
 *
 * Leaving one open is what caused the charged-but-never-activated 500: the
 * partial unique index counts `created`/`authenticated`/`active`/`pending`, and
 * a member can legitimately hold a `pending` row while paying a fresh checkout.
 * Superseding an *active* row is unusual (it means the member paid twice), so it
 * is logged rather than done quietly.
 */
async function supersedeOtherOpenRows(
  admin: ReturnType<typeof createClient>,
  userId: string | null,
  keepId: string,
): Promise<string | null> {
  if (!userId) return null;

  const { data: others, error: readError } = await admin
    .from("subscriptions")
    .select("id, status")
    .eq("user_id", userId)
    .neq("id", keepId)
    .in("status", OPEN_STATUSES);

  if (readError) return readError.message;
  if (!others || others.length === 0) return null;

  for (const other of others) {
    if (other.status === "active") {
      console.warn(
        "razorpay-webhook: superseding an ACTIVE subscription",
        other.id,
        "in favour of",
        keepId,
        "— the member paid twice; the desk should check for a duplicate charge",
      );
    }
  }

  const { error } = await admin
    .from("subscriptions")
    .update({
      status: "superseded",
      updated_at: new Date().toISOString(),
      last_event_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .neq("id", keepId)
    .in("status", OPEN_STATUSES);

  return error ? error.message : null;
}

/**
 * Attach a refund or dispute to the subscription it belongs to.
 *
 * Resolution order mirrors how the data is written: an explicit note first
 * (Razorpay lets an operator tag a refund), then the payment id recorded on
 * `invoice.paid`, then the invoice id.
 */
async function resolvePaidSubscription(
  admin: ReturnType<typeof createClient>,
  refund?: RefundEntity,
  dispute?: DisputeEntity,
): Promise<{ id: string } | null> {
  const paymentId = refund?.payment_id ?? dispute?.payment_id ?? null;
  const invoiceId = refund?.invoice_id ?? null;
  const notedSubscription = refund?.notes?.subscription_id ?? null;

  const attempts: Array<[string, string]> = [];
  if (notedSubscription) attempts.push(["razorpay_subscription_id", String(notedSubscription)]);
  if (paymentId) attempts.push(["razorpay_payment_id", String(paymentId)]);
  if (invoiceId) attempts.push(["razorpay_invoice_id", String(invoiceId)]);

  for (const [column, value] of attempts) {
    const { data } = await admin.from("subscriptions").select("id").eq(column, value).maybeSingle();
    if (data) return data as { id: string };
  }

  return null;
}
