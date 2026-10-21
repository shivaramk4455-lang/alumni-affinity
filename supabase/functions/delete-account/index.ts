// deno-lint-ignore-file
// Right to be forgotten (DPDP Act 2023, s.12).
//
// Deletion is deliberately NOT a client-side operation: it needs the service
// role to remove storage objects and the auth record, and a service key must
// never reach the browser. The caller's own JWT is the only credential
// accepted, and a typed confirmation string guards against an accidental
// click on a shared device.
//
// Order matters: purge credentials/photos FIRST, then the profile row (whose
// foreign keys cascade to interests, co-pilots, conversations, messages,
// calls, reports, shortlists and notifications), then the auth user last.
// If the last step fails the member has no data left but can still sign in
// and ask the desk to finish — the safer direction to fail.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// The caller's JWT must be validated with the publishable/anon key; falling
// back to the service key would let a forged token pass auth.getUser().
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

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

const BUCKETS = ["profile-photos", "verification-docs"] as const;
const CONFIRMATION = "DELETE MY ACCOUNT";
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET");

/**
 * Stop the member's recurring mandate before their profile goes.
 *
 * The defect this closes: `subscriptions.user_id` cascaded, so deleting the
 * profile destroyed the only record of the subscription while Razorpay kept
 * debiting the saved mandate — and the webhook, finding no row, answered 200 and
 * stopped retrying. Money left a deleted member's account with no trace.
 *
 * 20261106000100 changed the FK to ON DELETE SET NULL, so a failure here is
 * recoverable: the row survives as an orphan and the hourly
 * reconcile-orphaned-subscriptions job retries the cancellation. Deletion is
 * never blocked by a provider outage — erasure wins, billing follows.
 */
async function cancelBilling(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ cancelled: boolean; note: string }> {
  const { data: sub, error } = await admin
    .from("subscriptions")
    .select("id, razorpay_subscription_id, status, cancel_at_period_end")
    .eq("user_id", userId)
    .in("status", ["active", "authenticated", "pending"])
    .maybeSingle();

  if (error) return { cancelled: false, note: `subscription lookup failed: ${error.message}` };
  if (!sub) return { cancelled: true, note: "no live subscription" };
  if (sub.cancel_at_period_end) {
    return { cancelled: true, note: "already scheduled to cancel at period end" };
  }
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return {
      cancelled: false,
      note: "provider credentials absent — row kept as an orphan for the reconcile job",
    };
  }

  try {
    const res = await fetch(
      `https://api.razorpay.com/v1/subscriptions/${sub.razorpay_subscription_id}/cancel`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ cancel_at_cycle_end: 0 }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return {
        cancelled: false,
        note: `provider refused (${res.status}): ${text.slice(0, 200)}`,
      };
    }
  } catch (err) {
    return {
      cancelled: false,
      note: `provider call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Immediate cancellation, so record it as terminal rather than scheduled.
  const { error: updateError } = await admin
    .from("subscriptions")
    .update({
      status: "cancelled",
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
      last_event_at: new Date().toISOString(),
    })
    .eq("id", sub.id);

  if (updateError) {
    return {
      cancelled: true,
      note: `provider cancelled; row update failed: ${updateError.message}`,
    };
  }
  return { cancelled: true, note: "cancelled immediately at the provider" };
}

/**
 * Remove every object the member owns in the given bucket.
 *
 * A failure here is never silent. The previous implementation broke out of
 * the loop on either the list error or the remove error without recording
 * anything, and the caller then reported a clean DPDP erasure — while the
 * member's photographs and credential document were still in the bucket.
 */
async function purgeBucket(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<{ removed: number; failed: boolean; error?: string }> {
  let removed = 0;
  // Buckets are per-user folders, so one listing pass is enough; the loop
  // guards against very large folders being paginated.
  for (let pass = 0; pass < 20; pass++) {
    const { data: entries, error } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
    if (error) {
      console.error("delete-account: storage list failed for", bucket, error.message);
      return { removed, failed: true, error: `list failed: ${error.message}` };
    }
    if (!entries?.length) break;
    const paths = entries.map((e) => `${prefix}/${e.name}`);
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) {
      console.error("delete-account: storage remove failed for", bucket, removeError.message);
      return { removed, failed: true, error: `remove failed: ${removeError.message}` };
    }
    removed += paths.length;
  }
  return { removed, failed: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error("delete-account: missing SUPABASE_ANON_KEY / SUPABASE_URL / SERVICE_ROLE key");
    return json({ error: "Server configuration error" }, 500);
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== CONFIRMATION) {
    return json({ error: `Type "${CONFIRMATION}" to confirm deletion` }, 400);
  }

  // F-10: Cooldown rate limit. Check if an account_deletion consent event was
  // already attempted within the last 30 seconds to prevent hammer loops.
  const { data: recentAttempts } = await admin
    .from("consent_events")
    .select("recorded_at")
    .eq("user_id", user.id)
    .eq("purpose", "account_deletion")
    .gte("recorded_at", new Date(Date.now() - 30_000).toISOString())
    .limit(1);

  if (recentAttempts && recentAttempts.length > 0) {
    return json({ error: "A deletion request is already processing. Please wait a moment." }, 429);
  }

  // Record the request before anything is removed: the ledger row itself is
  // cascaded away with the profile, but it gives the desk a trail for the few
  // seconds the account still exists and survives a partial failure.
  const { error: consentErr } = await admin.from("consent_events").insert({
    user_id: user.id,
    purpose: "account_deletion",
    granted: true,
    policy_version: "2026-09",
    note: "Member-initiated deletion via settings",
  });
  if (consentErr) {
    console.warn("delete-account: consent insert warning:", consentErr.message);
  }

  // Billing first: stop the mandate while it can still be found. A provider
  // failure here must not block the erasure — the surviving orphan row is the
  // retry record (see cancelBilling above).
  const billing = await cancelBilling(admin, user.id);
  if (!billing.cancelled) {
    console.error(
      "delete-account: DESK ACTION REQUIRED — billing not cancelled:",
      billing.note,
      "(subscription row kept as an orphan; the reconcile job retries hourly)",
    );
  }

  let objects = 0;
  const purgeFailures: string[] = [];
  for (const bucket of BUCKETS) {
    const purge = await purgeBucket(admin, bucket, user.id);
    objects += purge.removed;
    if (purge.failed) {
      purgeFailures.push(`${bucket}: ${purge.error ?? "unknown error"}`);
    }
  }
  if (purgeFailures.length > 0) {
    // Never report a clean erasure while objects survive. The member is told,
    // the desk is logged, and the receipt records that the purge was partial.
    console.error(
      "delete-account: DESK ACTION REQUIRED — storage purge incomplete:",
      purgeFailures.join("; "),
    );
  }

  // Snapshot the member's consent purposes BEFORE the profile delete: the
  // consent_events rows cascade away with the profile, so this is the last
  // moment they are readable. Purposes only — no PII leaves with the receipt.
  const { data: consentRows } = await admin
    .from("consent_events")
    .select("purpose")
    .eq("user_id", user.id);
  const purposes = [...new Set((consentRows ?? []).map((r) => r.purpose as string))];

  const { error: profileError } = await admin.from("profiles").delete().eq("id", user.id);
  if (profileError) {
    // Generic message: this handler runs while the caller is still authenticated,
    // so echoing a PostgREST error could return row contents to the browser.
    console.error("delete-account: profile delete failed:", profileError.message);
    return json(
      {
        error:
          "Deletion could not complete. Nothing further was removed — please contact the membership desk.",
        objects,
      },
      500,
    );
  }

  const { error: authError } = await admin.auth.admin.deleteUser(user.id);
  if (authError) {
    // The member's data is gone but their login survives: they can still sign in
    // to an empty account and ask the desk to finish. Recorded on the receipt so
    // the desk can find it (`where not auth_deleted`) and logged loudly, rather
    // than reported as a clean success the member cannot act on.
    console.error(
      "delete-account: DESK ACTION REQUIRED — auth user not deleted:",
      authError.message,
    );
  }

  // DPDP Section 12 evidence: the receipt has no FK to profiles, so it
  // survives the cascade that eats consent_events. Best-effort — a receipt
  // failure must never resurrect deleted data, so it never blocks the 200.
  const { error: receiptError } = await admin.from("deletion_receipts").insert({
    user_id: user.id,
    policy_version: "2026-09",
    purposes,
    storage_objects_removed: objects,
    auth_deleted: !authError,
    billing_cancelled: billing.cancelled,
    billing_note: billing.note,
    storage_purge_failed: purgeFailures.length > 0,
    note: "Member-initiated deletion via settings",
  });
  if (receiptError) {
    console.error("delete-account: receipt insert failed:", receiptError.message);
  }

  return json({
    ok: true,
    objects,
    authDeleted: !authError,
    billingCancelled: billing.cancelled,
    // A non-null warning is the client's cue to say something needs the desk,
    // instead of showing a clean "everything is gone" message that is not quite
    // true.
    warning:
      authError || purgeFailures.length > 0
        ? authError
          ? "Your data was deleted, but the sign-in record could not be removed. The membership desk has been notified."
          : "Your data was deleted, but some files could not be removed from storage. The membership desk has been notified."
        : null,
  });
});
