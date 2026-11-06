/**
 * localStorage keys for a member's in-progress drafts, and the one place that
 * clears them.
 *
 * Both drafts hold personal data (name, date of birth, email, phone, employer,
 * city). On a shared device that data must not outlive the session, so
 * sign-out clears it alongside the query cache — the same shared-device reason
 * the auth listener already clears cached member data for. Keeping the keys in
 * one module (rather than a private const inside a route) means the clearing
 * path cannot silently drift from the writing path.
 */
export const APPLY_DRAFT_KEY = "merit-circle-apply-draft";

/** Onboarding draft written by the authenticated onboarding wizard. */
export const ONBOARDING_DRAFT_KEY = "alumni_onboarding_draft_v2";

/**
 * Remove every draft that may hold personal data. Best-effort: a browser with
 * storage disabled must not break sign-out.
 */
export function clearMemberDrafts(): void {
  try {
    localStorage.removeItem(APPLY_DRAFT_KEY);
    localStorage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch {
    /* storage unavailable — nothing retained to clear */
  }
}
