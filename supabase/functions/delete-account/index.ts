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

/** Remove every object the member owns in the given bucket. */
async function purgeBucket(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<number> {
  let removed = 0;
  // Buckets are per-user folders, so one listing pass is enough; the loop
  // guards against very large folders being paginated.
  for (let pass = 0; pass < 20; pass++) {
    const { data: entries, error } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
    if (error || !entries?.length) break;
    const paths = entries.map((e) => `${prefix}/${e.name}`);
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) break;
    removed += paths.length;
  }
  return removed;
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

  let objects = 0;
  for (const bucket of BUCKETS) {
    objects += await purgeBucket(admin, bucket, user.id);
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
  if (profileError) return json({ error: profileError.message, objects }, 400);

  const { error: authError } = await admin.auth.admin.deleteUser(user.id);

  // DPDP Section 12 evidence: the receipt has no FK to profiles, so it
  // survives the cascade that eats consent_events. Best-effort — a receipt
  // failure must never resurrect deleted data, so it never blocks the 200.
  const { error: receiptError } = await admin.from("deletion_receipts").insert({
    user_id: user.id,
    policy_version: "2026-09",
    purposes,
    storage_objects_removed: objects,
    auth_deleted: !authError,
    note: "Member-initiated deletion via settings",
  });
  if (receiptError) {
    console.error("delete-account: receipt insert failed:", receiptError.message);
  }

  return json({ ok: true, objects, authDeleted: !authError });
});
