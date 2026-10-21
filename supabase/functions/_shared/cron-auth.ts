// ===========================================================================
// Shared cron secret check for the two unattended edge functions.
// Both notify-dispatch and weekly-digest have no caller identity by design
// (pg_cron invokes them), so they share one bearer secret with rotation
// support. The gateway keeps the Authorization JWT, so the cron secret rides
// in X-Cron-Secret (previous secret during rotation in X-Cron-Previous).
// Timing-safe compare; missing secret = 500, bad = 401.
// Set both with: supabase secrets set CRON_SECRET=... CRON_SECRET_PREVIOUS=...
// ===========================================================================

/**
 * Constant-time comparison.
 *
 * Both sides are hashed first, so the byte-by-byte comparison below always
 * runs over the same number of bytes and the length of the secret is never
 * observable from the response time. Comparing the raw strings instead
 * short-circuits on a length mismatch, which leaks the secret's length and
 * narrows a brute-force search space.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const da = new Uint8Array(ha);
  const db = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

export async function cronAuthError(req: Request): Promise<Response | null> {
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
    (token !== "" && (await timingSafeEqual(token, current))) ||
    (previousSecret !== "" && previous !== "" && (await timingSafeEqual(previous, previousSecret)));
  if (!ok)
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  return null;
}
