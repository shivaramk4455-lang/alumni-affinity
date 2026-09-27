// Liveness/readiness probe (Phase 3).
//
// Deliberately unauthenticated (--no-verify-jwt / config.toml verify_jwt=false)
// because probes come from uptime monitors, not browsers. It answers three
// questions in one call: the edge runtime is up, the database is reachable,
// and the schema is the one we expect (the plan catalogue exists — it is
// created by the first meaningful migration and cannot vanish silently).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      },
    });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  let db = false;
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { count, error } = await admin
      .from("subscription_plans")
      .select("code", { count: "exact", head: true });
    db = !error && typeof count === "number";
  } catch {
    db = false;
  }

  const body = {
    ok: db,
    db,
    time: new Date().toISOString(),
    service: "merit-circle-health",
  };
  return new Response(req.method === "HEAD" ? null : JSON.stringify(body), {
    status: db ? 200 : 503,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
