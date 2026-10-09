/**
 * Single source of truth for the legally-required identity of this service.
 *
 * THE LAW: the Information Technology (Intermediary Guidelines and Digital Media
 * Ethics Code) Rules, 2021 requires an intermediary to publish the name and
 * contact details of a *Grievance Officer* together with a mechanism for
 * complaints — acknowledgement within 24 hours, resolution within 15 days
 * (Rule 3(2)(a)). The 2022 Amendment inserted Rule 3A, which gives a
 * complainant a further appeal to the Grievance Appellate Committee within 30
 * days of the Grievance Officer's decision, and Rule 4(1) requires published
 * contact details for a nodal contact person. The Digital Personal Data
 * Protection Act, 2023 separately requires a Section 5 notice and a Section 13
 * grievance route; a Data Protection Officer contact point is required for a
 * Significant Data Fiduciary.
 *
 * ---------------------------------------------------------------------------
 * LAUNCH BLOCKER — READ BEFORE RELEASING
 * ---------------------------------------------------------------------------
 * `published` is false and every field below is an explicit placeholder. While
 * it is false:
 *   - /grievance and the site footer render a loud, unmissable notice, and
 *   - `npm run build` FAILS, because vite.config.ts enables the gate whenever
 *     REQUIRE_LEGAL_IDENTITY=1 (which the CI release job now sets).
 *
 * To release:
 *   1. Appoint a grievance officer and a nodal officer.
 *   2. Register the operating entity and record its registered address.
 *   3. Set up a mailbox at a domain you control and that someone READS. The
 *      statutory clocks (24h acknowledgement, 15-day resolution) start the
 *      moment a complaint lands there. An unmonitored address is a breach, not
 *      a formality.
 *   4. Replace every bracketed placeholder below with the real value.
 *   5. Set `published: true`.
 *
 * The field is typed `boolean` (not the literal `false`), because flipping it
 * is exactly what a future operator will do, and the type must not fight them.
 */
export const GRIEVANCE_OFFICER = {
  /** Must be true AND every field filled before the release gate passes. */
  published: false as boolean,
  officer: "[REQUIRED before launch — name of the appointed Grievance Officer]",
  entity: "[REQUIRED before launch — registered name of the operating entity]",
  registeredAddress: "[REQUIRED before launch — registered address of the entity]",
  /** .invalid never delivers: an unmonitored address is never advertised. */
  email: "grievance@example.invalid",
  /** Statutory clocks under Rule 3(2)(a). Not negotiable. */
  redressalSlaHours: 24,
  resolutionSlaDays: 15,
} as const;

/**
 * Nodal contact person (IT Rules 2021, Rule 4(1)), which is also the
 * escalation point above the Grievance Officer. Rule 3A's appeal runs to the
 * central Grievance Appellate Committee, not to this office — see /grievance,
 * which states both routes separately.
 */
export const NODAL_OFFICER = {
  officer: "[REQUIRED before launch — name of the appointed Nodal Officer]",
  email: "nodal@example.invalid",
} as const;

/** Data Protection Officer / Data Principal contact point (DPDP Act 2023 — Sections 5, 13 and 14). */
export const DPO_CONTACT = {
  email: "dpo@example.invalid",
} as const;

/**
 * The canonical origin, used for canonical URLs, og:url and JSON-LD.
 * Kept here so SEO metadata and structured data cannot drift apart.
 */
export const SITE_URL = "https://themeritcircle.in";

/** Shared brand string — one place, so the manifest/footer/SEO stay consistent. */
export const SITE_NAME = "The Merit Circle";

/**
 * The service descriptor used in page titles, SEO metadata and the site
 * footer. Keep the short brand descriptor separate from the audience tagline.
 */
export const SITE_TAGLINE = "IIT, IIM & Premier Alumni Matrimony";

/**
 * Every field the release gate inspects, paired with a human-readable label.
 * `vite.config.ts` iterates this to produce a single actionable error listing
 * every outstanding field, rather than failing on one at a time.
 */
export const REQUIRED_LEGAL_FIELDS: ReadonlyArray<{
  label: string;
  value: string;
  hint: string;
}> = [
  {
    label: "GRIEVANCE_OFFICER.officer",
    value: GRIEVANCE_OFFICER.officer,
    hint: "Full name of the appointed Grievance Officer (IT Rules 2021, Rule 3(2)(a)).",
  },
  {
    label: "GRIEVANCE_OFFICER.entity",
    value: GRIEVANCE_OFFICER.entity,
    hint: "Registered legal name of the entity operating this service.",
  },
  {
    label: "GRIEVANCE_OFFICER.registeredAddress",
    value: GRIEVANCE_OFFICER.registeredAddress,
    hint: "Registered address of the operating entity.",
  },
  {
    label: "GRIEVANCE_OFFICER.email",
    value: GRIEVANCE_OFFICER.email,
    hint: "A monitored mailbox. An unmonitored address is a Rule 3(2)(b) breach.",
  },
  {
    label: "NODAL_OFFICER.officer",
    value: NODAL_OFFICER.officer,
    hint: "Full name of the appointed Nodal Officer (IT Rules 2021, Rule 4(1) nodal contact person).",
  },
  {
    label: "NODAL_OFFICER.email",
    value: NODAL_OFFICER.email,
    hint: "A monitored mailbox for the Nodal Officer (Rule 4(1) requires published contact details).",
  },
  {
    label: "DPO_CONTACT.email",
    value: DPO_CONTACT.email,
    hint: "Data Protection Officer contact point (DPDP Act 2023 — Sections 5 and 13; Rule 10 for a Significant Data Fiduciary).",
  },
];

type UnresolvedField = { label: string; hint: string };

/**
 * Fields still holding a bracketed placeholder, or an address that can never
 * deliver. Both are treated as "not provided" — a `.invalid` mailbox that
 * silently swallows complaints is worse than an obviously empty field.
 */
export function unresolvedLegalFields(): UnresolvedField[] {
  return REQUIRED_LEGAL_FIELDS.filter(
    (f) => f.value.trim().startsWith("[") || f.value.trim().toLowerCase().endsWith(".invalid"),
  ).map((f) => ({ label: f.label, hint: f.hint }));
}

/**
 * True only when the service may lawfully be presented to the public: the
 * operator has published, and every required field carries a real, deliverable
 * value. `published` alone is not trusted, because it is a manual flag that can
 * be flipped while a placeholder is still in place.
 */
export function isLegalIdentityComplete(): boolean {
  return GRIEVANCE_OFFICER.published === true && unresolvedLegalFields().length === 0;
}

/**
 * Rendered wherever the placeholder must be unmistakable. States plainly that
 * complaints are not being monitored, so nobody is misled into believing a
 * channel exists that does not.
 */
export const GRIEVANCE_PLACEHOLDER_NOTICE =
  "The details above are placeholders. Complaints sent here are not monitored. " +
  "The membership desk publishes the appointed officer's details before launch.";
