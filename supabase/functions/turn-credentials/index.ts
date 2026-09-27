// deno-lint-ignore-file
// Short-lived TURN credentials (H-6).
//
// Static TURN credentials baked into the browser bundle are extractable by
// anyone, so they invite relay theft. This function mints time-boxed
// credentials using the standard TURN REST shared-secret scheme: the server
// holds TURN_STATIC_SECRET, the browser gets a username/credential pair that
// dies with the TTL. Only signed-in members may mint; the secret, the realm
// and the relay URLs never leave the server.
//
// CoTURN/coturn must be configured with matching static-auth-secret and
// realm for these credentials to work:
//   use-auth-secret, static-auth-secret=<TURN_STATIC_SECRET>, realm=<TURN_REALM>
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const TURN_SECRET = Deno.env.get("TURN_STATIC_SECRET");
const TURN_REALM = Deno.env.get("TURN_REALM") ?? "themeritcircle.in";
const TURN_URLS = (Deno.env.get("TURN_URLS") ?? "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const TTL_SECONDS = 6 * 60 * 60;

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY)
    return json({ error: "Server configuration error" }, 500);
  if (!TURN_SECRET || !TURN_URLS.length) return json({ error: "TURN is not configured" }, 503);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  // Caller JWT validated with the anon key — never the service key.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const username = `${expiry}:${user.id}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TURN_SECRET),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username));
  const credential = btoa(String.fromCharCode(...new Uint8Array(digest)));

  return json({ urls: TURN_URLS, username, credential, ttl: TTL_SECONDS, realm: TURN_REALM });
});
