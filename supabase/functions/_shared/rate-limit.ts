// Shared per-user rate limiter for authenticated edge functions.
//
// Hammering a desk/adversarial endpoint (review decisions, credential
// minting, destructive account actions) must cost the caller a wait, not
// the database a stampede. Limits are per authenticated user (service-role
// lookup keyed on the caller's own id — the same pattern delete-account
// uses for its 30s deletion cooldown), fail-open on lookup errors (a
// ledger hiccup must never block a legitimate desk action), and surfaced
// as 429 with a Retry-After hint.
//
// Calibrated deliberately loose: these are human-driven actions (desk
// clicks, call setup, one cancellation), so the budgets below are orders
// of magnitude above legitimate use and only bite scripts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.1";

export type RateLimit = {
  /** Ledger purpose used as the cooldown key (see consent_events CHECK). */
  purpose: string;
  /** Minimum gap between two accepted calls. */
  cooldownMs: number;
  /** 429 body when the caller is too fast. */
  message: string;
};

export async function rateLimitError(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  limit: RateLimit,
): Promise<Response | null> {
  const json = (body: unknown, status = 200, retryAfterSec?: number): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        ...(retryAfterSec !== undefined ? { "retry-after": String(retryAfterSec) } : {}),
      },
    });

  try {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data } = await admin
      .from("consent_events")
      .select("recorded_at")
      .eq("user_id", userId)
      .eq("purpose", limit.purpose)
      .gte("recorded_at", new Date(Date.now() - limit.cooldownMs).toISOString())
      .limit(1);
    if (data && data.length > 0) {
      return json({ error: limit.message }, 429, Math.ceil(limit.cooldownMs / 1000));
    }
    // Record the attempt so the next call sees it. Best-effort: a ledger
    // failure fails open (the action proceeds unthrottled).
    await admin.from("consent_events").insert({
      user_id: userId,
      purpose: limit.purpose,
      granted: true,
      policy_version: "2026-09",
      note: `rate-limit ledger for ${limit.purpose}`,
    });
  } catch {
    // Fail open: throttling must never become a denial-of-service on the desk.
  }
  return null;
}
