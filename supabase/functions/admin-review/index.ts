// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// The caller's JWT must be validated with the publishable/anon key. Falling
// back to the service key here would let a forged token pass auth.getUser().
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

type Decision = "verified" | "needs_resubmission" | "rejected";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!ANON_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    console.error("admin-review: missing SUPABASE_ANON_KEY / SUPABASE_URL / SERVICE_ROLE key");
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

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!callerProfile?.is_admin) return json({ error: "Forbidden" }, 403);

  const body = (await req.json().catch(() => null)) as {
    profile_id?: string;
    decision?: string;
    note?: string | null;
  } | null;
  if (
    !body?.profile_id ||
    (body.decision !== "verified" &&
      body.decision !== "needs_resubmission" &&
      body.decision !== "rejected")
  ) {
    return json(
      { error: "profile_id and decision (verified|needs_resubmission|rejected) required" },
      400,
    );
  }
  // The desk must not rubber-stamp their own profile.
  if (body.profile_id === user.id)
    return json({ error: "A desk member cannot decide their own verification" }, 403);

  const decision = body.decision as Decision;
  const patch: Record<string, unknown> = {
    verification_status: decision,
    verification_note: body.note?.trim() || null,
    // Audit trail: who decided, and when (added in 20260927000000).
    verification_decided_at: new Date().toISOString(),
    verification_decided_by: user.id,
    alumni_email_verified: decision === "verified",
  };

  const { error } = await admin.from("profiles").update(patch).eq("id", body.profile_id);
  if (error) return json({ error: error.message }, 400);

  const notice =
    decision === "verified"
      ? {
          kind: "verification_approved",
          title: "Verification approved",
          body: "The membership desk has verified your profile.",
        }
      : decision === "rejected"
        ? {
            kind: "verification_rejected",
            title: "Verification not accepted",
            body: body.note?.trim() || "The membership desk was unable to verify this profile.",
          }
        : {
            kind: "verification_resubmission",
            title: "More information needed",
            body: body.note?.trim() || "The membership desk needs one more detail before approval.",
          };

  await admin.from("notifications").insert({
    user_id: body.profile_id,
    ...notice,
    link: "/verification",
  });

  return json({ ok: true });
});
