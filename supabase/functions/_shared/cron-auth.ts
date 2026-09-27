// ===========================================================================
// Shared cron secret check for the two unattended edge functions.
// Both notify-dispatch and weekly-digest have no caller identity by design
// (pg_cron invokes them), so they share one bearer secret with rotation
// support. The gateway keeps the Authorization JWT, so the cron secret rides
// in X-Cron-Secret (previous secret during rotation in X-Cron-Previous).
// Timing-safe compare; missing secret = 500, bad = 401.
// Set both with: supabase secrets set CRON_SECRET=... CRON_SECRET_PREVIOUS=...
// ===========================================================================
export function cronAuthError(req: Request): Response | null {
  const current = Deno.env.get("CRON_SECRET");
  if (!current) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  const token = req.headers.get("x-cron-secret") ?? "";
  const previous = req.headers.get("x-cron-previous") ?? "";
  const previousSecret = Deno.env.get("CRON_SECRET_PREVIOUS") ?? "";
  const ok =
    (token !== "" && timingSafeEqual(token, current)) ||
    (previousSecret !== "" && previous !== "" && timingSafeEqual(previous, previousSecret));
  if (!ok)
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  return null;
}

/** Constant-time comparison; a plain === leaks the digest one byte at a time. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
