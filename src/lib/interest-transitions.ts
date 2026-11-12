/**
 * Interest transition table — a strict client mirror of the database trigger
 * `enforce_interest_transition` (migration 20260928000000 and later hardenings).
 *
 * The database is the enforcement point; this is the browser's view of it.
 * If the two ever disagree, the trigger still wins and the client shows a
 * generic "Could not update" toast. `migration-contract.test.ts` asserts the
 * trigger still exists and still gates the same edges, so the mirror and the
 * enforcement are checked in the same test run (same pattern as
 * `subscription-liveness.ts` mirroring `private.live_subscription()`).
 *
 * Roles matter: `accepted` can only be written by the recipient. The sender
 * may withdraw; a declined/withdrawn/expired row may be re-opened only by the
 * original sender re-sending (status back to `pending`).
 */
export type InterestStatus =
  "pending" | "accepted" | "declined" | "withdrawn" | "expired" | "blocked";

export type InterestRole = "sender" | "recipient";

/** Legal next states by (current status, role). */
export const INTEREST_TRANSITIONS: Record<
  InterestStatus,
  Partial<Record<InterestRole, InterestStatus[]>>
> = {
  pending: {
    // Only the recipient may accept or decline; the sender may withdraw.
    recipient: ["accepted", "declined"],
    sender: ["withdrawn"],
  },
  declined: {
    // Re-open: back to pending re-arms a fresh 14-day window.
    sender: ["pending"],
  },
  withdrawn: {
    sender: ["pending"],
  },
  expired: {
    sender: ["pending"],
  },
  accepted: {
    // Block is the only member-side exit from an accepted introduction.
    sender: ["blocked"],
    recipient: ["blocked"],
  },
  blocked: {},
};

/** Whether `role` may move a row from `from` to `to`. */
export function canTransitionInterest(
  from: InterestStatus,
  to: InterestStatus,
  role: InterestRole,
): boolean {
  return INTEREST_TRANSITIONS[from]?.[role]?.includes(to) ?? false;
}

/**
 * Rank for picking the "best" row when a mutual pair (A→B and B→A) coexists.
 * Accepted wins over pending (so a hidden accepted row can never be masked),
 * a pending row where I am the recipient is actionable, and blocked is the
 * least useful (already terminal). Extracted from members.$id.tsx so the
 * ranking is unit-testable and shared by any surface that resolves a pair.
 */
export function rankInterest(status: string, iAmRecipient: boolean): number {
  if (status === "blocked") return -1;
  if (status === "accepted") return 0;
  if (status === "pending" && iAmRecipient) return 1;
  if (status === "pending") return 2;
  return 3;
}
