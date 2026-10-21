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
//
// EVERY failure of the ledger is logged. The limiter used to destructure only
// `data` and discard the query error, and it discarded the insert error
// entirely. Both were silent, so a ledger that could not be read looked
// exactly like "no recent call" and a ledger that could not be written left
// the endpoint permanently unthrottled — with nothing in the logs to say so.
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
    const { data, error: readError } = await admin
      .from("consent_events")
      .select("recorded_at")
      .eq("user_id", userId)
      .eq("purpose", limit.purpose)
      .gte("recorded_at", new Date(Date.now() - limit.cooldownMs).toISOString())
      .limit(1);

    if (readError) {
      // Fail open — throttling must never become a denial of service on the
      // desk — but say so. A limiter that cannot read its own ledger is not
      // throttling, and that has to be visible.
      console.error(
        `rate-limit: could not read the ${limit.purpose} ledger, proceeding unthrottled:`,
        readError.message,
      );
      return null;
    }

    if (data && data.length > 0) {
      return json({ error: limit.message }, 429, Math.ceil(limit.cooldownMs / 1000));
    }

    // Record the attempt so the next call sees it.
    const { error: writeError } = await admin.from("consent_events").insert({
      user_id: userId,
      purpose: limit.purpose,
      granted: true,
      policy_version: "2026-09",
      note: `rate-limit ledger for ${limit.purpose}`,
    });

    if (writeError) {
      // The attempt was not recorded, so the next request will not see it
      // either: this endpoint stays unthrottled until the ledger recovers.
      console.error(
        `rate-limit: could not record the ${limit.purpose} attempt, so the next call will not be throttled:`,
        writeError.message,
      );
    }
  } catch (err) {
    // Fail open: throttling must never become a denial-of-service on the desk.
    console.error(
      `rate-limit: unexpected failure for ${limit.purpose}, proceeding unthrottled:`,
      err instanceof Error ? err.message : err,
    );
  }
  return null;
}
