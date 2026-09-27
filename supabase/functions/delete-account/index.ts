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

  // Record the request before anything is removed: the ledger row itself is
  // cascaded away with the profile, but it gives the desk a trail for the few
  // seconds the account still exists and survives a partial failure.
  await admin.from("consent_events").insert({
    user_id: user.id,
    purpose: "account_deletion",
    granted: true,
    policy_version: "2026-09",
    note: "Member-initiated deletion via settings",
  });

  let objects = 0;
  for (const bucket of BUCKETS) {
    objects += await purgeBucket(admin, bucket, user.id);
  }

  const { error: profileError } = await admin.from("profiles").delete().eq("id", user.id);
  if (profileError) return json({ error: profileError.message, objects }, 400);

  const { error: authError } = await admin.auth.admin.deleteUser(user.id);

  return json({ ok: true, objects, authDeleted: !authError });
});
