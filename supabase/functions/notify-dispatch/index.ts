// deno-lint-ignore-file
// Outbound notification dispatcher.
//
// Drains public.notification_outbox and hands each due row to a provider.
// Invoked two ways:
//   * by pg_cron -> invoke via the Supabase function hook, and
//   * manually, by the desk, to flush a backlog.
//
// Everything it needs comes from the service role; the function accepts no
// caller-supplied recipient, template or payload, so it cannot be turned into
// a mail relay. The POST body only tunes the batch size.
//
// A row is claimed in Postgres (FOR UPDATE SKIP LOCKED) before any provider
// call, so two overlapping runs never send the same alert twice. A crash
// mid-send leaves the row in 'sending'; the sweep below re-queues anything
// that got stuck, which is the one place where a duplicate send is possible
// (at-least-once, which is the right trade for an alert).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.1";
import { cronAuthError } from "../_shared/cron-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Cron invokes this with no body; a manual flush may ask for a bigger batch.
const DEFAULT_BATCH = 25;
const STUCK_AFTER_MINUTES = 15;

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

type OutboxRow = {
  id: string;
  user_id: string;
  channel: "email" | "sms" | "whatsapp";
  template: string;
  payload: Record<string, unknown>;
  attempts: number;
};

type Destination = { email?: string; phone?: string };

// ---------------------------------------------------------------------------
// Templates. Text is rendered here, not in Postgres, so a wording change ships
// without a migration and the SQL never has to escape HTML.
// ---------------------------------------------------------------------------
type Rendered = { subject: string; body: string };

const TEMPLATES: Record<string, (p: Record<string, unknown>, d: Destination) => Rendered> = {
  interest_received: (p) => ({
    subject: "Someone is interested in an introduction",
    body: `${p.from_name} would like to be introduced to you.\n\nSign in to read the note and respond.`,
  }),
  interest_accepted: (p) => ({
    subject: "Your introduction was accepted",
    body: `${p.from_name} accepted. Your contact details are now available to each other.\n\nSign in to start a conversation.`,
  }),
  interest_declined: (p) => ({
    subject: "Update on your introduction request",
    body: `${p.from_name} has passed on this introduction. No action is needed.`,
  }),
  verification_approved: () => ({
    subject: "Your membership is verified",
    body: "Welcome to The Merit Circle. You can now browse the directory and send introductions.\n\nSign in to get started.",
  }),
  verification_resubmission: () => ({
    subject: "A document detail needs your attention",
    body: "The desk needs one more document or detail before your membership can be confirmed.\n\nSign in to review your verification status.",
  }),
  verification_rejected: () => ({
    subject: "Your verification application was not accepted",
    body: "The membership desk was unable to verify this profile. The reason, if recorded, is shown on your verification page.\n\nSign in to review it.",
  }),
  copilot_invite_accepted: (p) => ({
    subject: `${p.from_name} accepted your co-pilot request`,
    body: "You can now nominate a family member or friend as your co-pilot.\n\nSign in to continue.",
  }),
  call_invite: (p) => ({
    subject: "A family-room call is waiting for you",
    body: `${p.from_name} invited you to a call. Join from your connections page.`,
  }),
  weekly_digest: (p) => ({
    subject: "Your week on The Merit Circle",
    body: [
      `New introductions: ${p.new_interests ?? 0}`,
      `Accepted this week: ${p.accepted ?? 0}`,
      `New members in your city: ${p.new_members ?? 0}`,
      `Profile views this week: ${p.profile_views ?? 0}`,
      "",
      "Sign in to see the details.",
    ].join("\n"),
  }),
};

function render(
  template: string,
  payload: Record<string, unknown>,
  dest: Destination,
): Rendered | null {
  const fn = TEMPLATES[template];
  if (!fn) return null;
  return fn(payload, dest);
}

/** WhatsApp has a hard per-message limit; SMS is measured in segments. */
function channelBody(channel: OutboxRow["channel"], r: Rendered): string {
  if (channel === "whatsapp") {
    return `${r.body}`.slice(0, 1000);
  }
  if (channel === "sms") {
    return `${r.subject} — ${r.body}`.replace(/\s+/g, " ").slice(0, 320);
  }
  return r.body;
}

// ---------------------------------------------------------------------------
// Providers. Each returns an error string on failure, or null on success.
// Absent credentials are a failure, not a silent skip: a queued row that can
// never be sent must surface to the desk rather than vanish.
// ---------------------------------------------------------------------------
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM = Deno.env.get("TWILIO_FROM_NUMBER");
const WHATSAPP_NUMBER = Deno.env.get("WHATSAPP_SENDER_NUMBER");

// Every provider call carries a deadline. Without one, a stalled socket holds
// the whole invocation open: the rest of the batch sits in 'sending' until the
// stuck-row sweep re-queues it 15 minutes later, so those members' messages are
// delayed — and the rows that already went out in this batch are sent a second
// time by the re-queue.
const PROVIDER_TIMEOUT_MS = 10_000;

async function sendEmail(to: string, r: Rendered): Promise<string | null> {
  if (!RESEND_KEY) return "RESEND_API_KEY not configured";
  // No sandbox fallback sender. `alerts@resend.dev` is Resend's onboarding
  // address and only delivers to the account owner, so a deployment that forgot
  // ALERT_FROM_EMAIL would queue every notification and fail every one of them
  // silently. A missing sender is a configuration failure, reported per row.
  const from = Deno.env.get("ALERT_FROM_EMAIL");
  if (!from) return "ALERT_FROM_EMAIL not configured";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${RESEND_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: r.subject,
      text: r.body,
    }),
  });
  if (!res.ok) return `resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
  return null;
}

async function sendSms(to: string, text: string): Promise<string | null> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return "Twilio SMS not configured";
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: {
      authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: text }),
  });
  if (!res.ok) return `twilio ${res.status}: ${(await res.text()).slice(0, 200)}`;
  return null;
}

async function sendWhatsApp(to: string, text: string): Promise<string | null> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !WHATSAPP_NUMBER) return "WhatsApp sender not configured";
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: {
      authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: `whatsapp:${to}`,
      From: `whatsapp:${WHATSAPP_NUMBER}`,
      Body: text,
    }),
  });
  if (!res.ok) return `twilio whatsapp ${res.status}: ${(await res.text()).slice(0, 200)}`;
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Server configuration error" }, 500);
  // No caller identity by design (pg_cron invokes this); the shared cron
  // secret is the whole boundary. The publishable key alone must not pass.
  const cronRejection = cronAuthError(req);
  if (cronRejection) return cronRejection;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Anything still 'sending' past the stuck window is from a run that died
  // mid-flight. Re-queue it; the attempt counter makes the loss bounded.
  // F-08: Check status_changed_at (migration 20261019000002) rather than
  // created_at so a row claimed into 'sending' recently is not prematurely re-queued.
  //
  // The attempts filter is NOT optional. Without it a row that had already spent
  // its entire budget was re-queued, the next claim pushed attempts past the
  // CHECK, and — because the claim is a single statement — the whole batch
  // failed, so every member's notification stopped until someone edited the row
  // by hand. Migration 20261106000200 removes the trap at its source (the claim
  // now skips such rows); this filter is the second half of that fix.
  const stuckCutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString();
  const { error: sweepError } = await admin
    .from("notification_outbox")
    .update({ status: "queued" })
    .eq("status", "sending")
    // Must match notification_outbox_attempts_valid and claim_due_notifications.
    .lt("attempts", 25)
    .or(
      `status_changed_at.lt.${stuckCutoff},and(status_changed_at.is.null,created_at.lt.${stuckCutoff})`,
    );
  if (sweepError) {
    // Previously discarded, which made "the sweep found nothing" and "the sweep
    // was rejected" look identical — so stranded rows never recovered and no one
    // could tell why.
    console.error("notify-dispatch: stuck-row sweep failed:", sweepError.message);
  }

  // A row that exhausted its attempts becomes a desk-visible failure instead of
  // sitting in the queue forever. Runs before the claim so the claim is only
  // ever given rows it is allowed to increment.
  const { data: parked, error: parkError } = await admin.rpc("park_exhausted_notifications");
  if (parkError) {
    console.error("notify-dispatch: park failed:", parkError.message);
  } else if (typeof parked === "number" && parked > 0) {
    console.warn("notify-dispatch: parked", parked, "exhausted notification(s) as failed");
  }

  const body = (await req.json().catch(() => null)) as { limit?: number } | null;
  const limit = Math.max(1, Math.min(body?.limit ?? DEFAULT_BATCH, 100));

  const { data: claimed, error: claimError } = await admin.rpc("claim_due_notifications", {
    _limit: limit,
  });
  if (claimError) return json({ error: claimError.message }, 500);

  const rows = (claimed ?? []) as OutboxRow[];
  const summary = { claimed: rows.length, sent: 0, failed: 0, skipped: 0 };

  // Destinations are private profile columns, so they are read through the
  // service-role client. If a member verified via credential document without
  // filling `alumni_email`, fall back to their primary login email in `auth.users`.
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const destinations = new Map<string, Destination>();
  if (userIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, alumni_email, contact_phone")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      destinations.set(p.id, {
        email: p.alumni_email ?? undefined,
        phone: p.contact_phone ?? undefined,
      });
    }

    for (const uid of userIds) {
      const current = destinations.get(uid) ?? {};
      if (!current.email) {
        try {
          const { data: authUser } = await admin.auth.admin.getUserById(uid);
          if (authUser?.user?.email) {
            current.email = authUser.user.email;
            destinations.set(uid, current);
          }
        } catch {
          // Keep undefined; handled below per channel
        }
      }
    }
  }

  for (const row of rows) {
    const dest = destinations.get(row.user_id) ?? {};
    const rendered = render(row.template, row.payload, dest);
    if (!rendered) {
      // An unknown template is a deploy-skew bug, not a transient failure.
      await admin.rpc("finish_notification", {
        _id: row.id,
        _ok: false,
        _error: `no template ${row.template}`,
      });
      summary.failed += 1;
      continue;
    }

    const text = channelBody(row.channel, rendered);
    let error: string | null = null;

    try {
      if (row.channel === "email") {
        if (!dest.email) error = "member has no email on file";
        else error = await sendEmail(dest.email, rendered);
      } else if (!dest.phone) {
        error = "member has no phone on file";
      } else if (row.channel === "sms") {
        error = await sendSms(dest.phone, text);
      } else {
        error = await sendWhatsApp(dest.phone, text);
      }
    } catch (err) {
      // A throwing provider must fail ONE row, not the batch. Previously an
      // unhandled rejection here aborted the loop with the remaining rows left
      // in 'sending' — the sweep re-queued them 15 minutes later, which also
      // re-sent everything already delivered in this batch.
      error = `provider threw: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (error) {
      summary.failed += 1;
      console.error(`notify ${row.channel} ${row.id}: ${error}`);
    } else {
      summary.sent += 1;
    }

    // The result is checked because an unrecorded outcome is indistinguishable
    // from success: the row would stay 'sending' and the sweep would send it a
    // second time.
    const { error: finishError } = await admin.rpc("finish_notification", {
      _id: row.id,
      _ok: !error,
      _error: error,
    });
    if (finishError) {
      console.error(
        `notify ${row.channel} ${row.id}: could not record outcome:`,
        finishError.message,
      );
    }
  }

  return json({ ok: true, ...summary });
});
