/**
 * Single source of truth for the legally-required grievance identity.
 *
 * H-7 SAFE DEFAULT: `published` is false and every field is an explicit
 * placeholder until a real officer is appointed (IT Rules 2021 require a
 * *named* officer with a monitored address). While it is false:
 *   - /grievance and the footer render a loud "placeholder" notice, and
 *   - `REQUIRE_LEGAL_IDENTITY=1 npm run build` fails (vite.config.ts gate),
 *     so a release pipeline can refuse to ship without real details.
 * Setting `published = true` and filling the fields is a human decision —
 * do it when the officer exists, not to make a build pass.
 */
export const GRIEVANCE_OFFICER = {
  published: false,
  officer: "[To be appointed — placeholder]",
  entity: "[Operating entity name — placeholder]",
  registeredAddress: "[Registered address — placeholder]",
  /** .invalid never delivers: an unmonitored address is never advertised. */
  email: "grievance@example.invalid",
  redressalSlaHours: 24,
  resolutionSlaDays: 15,
} as const;

/** Rendered wherever the placeholder must be unmistakable. */
export const GRIEVANCE_PLACEHOLDER_NOTICE =
  "The details above are placeholders. Complaints sent here are not monitored. The membership desk publishes the appointed officer's details before launch.";
