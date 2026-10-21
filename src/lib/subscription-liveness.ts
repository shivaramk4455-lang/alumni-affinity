/**
 * Subscription liveness — the pure decision logic, deliberately separated
 * from the React hooks that consume it.
 *
 * Why this file exists: the billing rules are the highest-consequence logic
 * in the product (they decide who gets a paid tier and how many
 * introductions they may send), and they were buried inside a module whose
 * bulk is React Query hooks. That made them impossible to threshold, and it
 * made the one test that covered them look like it covered the file.
 *
 * These functions are a STRICT MIRROR of the database:
 *
 *   private.subscription_is_live(status, period_end)   (20261106000000)
 *   private.live_subscription(user)                    (20261107000000)
 *
 * The database is the enforcement point; this is the browser's view of it. If
 * the two ever disagree, the member sees a tier the database will not grant —
 * or worse, the reverse. `src/lib/migration-contract.test.ts` asserts that the
 * SQL still requires recorded payment evidence, so the mirror and the
 * enforcement are checked in the same test run.
 *
 * Three conditions, in order:
 *   1. an entitling status — 'active' or 'authenticated';
 *   2. an unexpired period — period_end null or in the future;
 *   3. RECORDED PAYMENT — amount_paid_paise is not null.
 *
 * The third is what stops `subscription.activated` (which fires before any
 * invoice has been recorded) from granting a paid tier on its own.
 */

/**
 * Whether a subscription row entitles its member.
 *
 * @param status           the row's status
 * @param periodEnd        the billing period end, or null when the provider
 *                          omitted it
 * @param amountPaidPaise  the recorded payment in paise, or null when no
 *                          payment has been recorded against the row
 */
export function isSubscriptionLive(
  status: string,
  periodEnd: string | null,
  amountPaidPaise: number | null,
  nowMs = Date.now(),
): boolean {
  return (
    (status === "active" || status === "authenticated") &&
    (periodEnd === null || new Date(periodEnd).getTime() > nowMs) &&
    amountPaidPaise !== null
  );
}

/**
 * Whether an incoming webhook event is older than the record it would update.
 *
 * Razorpay webhook timestamps are integer seconds; Postgres stores ISO
 * strings with sub-second precision. A same-second event must never be
 * treated as stale, or a legitimate retry is discarded.
 */
export function isEventStale(eventCreatedAtSeconds: number, existingUpdatedAtIso: string): boolean {
  const existingSeconds = Math.floor(new Date(existingUpdatedAtIso).getTime() / 1000);
  return eventCreatedAtSeconds < existingSeconds;
}

/** The terminal states a subscription can never leave. */
export const TERMINAL_SUBSCRIPTION_STATES = new Set([
  "halted",
  "cancelled",
  "completed",
  "expired",
]);

export function isTerminalSubscriptionState(status: string): boolean {
  return TERMINAL_SUBSCRIPTION_STATES.has(status);
}
