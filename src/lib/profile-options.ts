export const INSTITUTIONS = [
  "IIT Bombay",
  "IIT Delhi",
  "IIT Madras",
  "IIT Kanpur",
  "IIT Kharagpur",
  "IIT Roorkee",
  "IIT Guwahati",
  "IIM Ahmedabad",
  "IIM Bangalore",
  "IIM Calcutta",
  "IIM Lucknow",
  "ISB Hyderabad",
  "BITS Pilani",
  "NLSIU Bengaluru",
  "AIIMS Delhi",
  "XLRI Jamshedpur",
  "Other premier institute",
];
export const RELOCATION = [
  "Open to relocate",
  "Within India only",
  "Prefer current city",
  "Open to abroad",
];
export const GENDERS = ["Woman", "Man", "Non-binary"];

export const DIETS = ["Vegetarian", "Eggetarian", "Non-vegetarian", "Jain", "Vegan"];

export const MARITAL_STATUSES = ["Never married", "Divorced", "Awaiting divorce", "Widowed"];

export const MOTHER_TONGUES = [
  "Hindi",
  "Bengali",
  "Telugu",
  "Marathi",
  "Tamil",
  "Gujarati",
  "Kannada",
  "Malayalam",
  "Punjabi",
  "Odia",
  "Assamese",
  "Urdu",
  "English",
  "Other",
];

export const RESIDENCY_STATUSES = [
  "India",
  "US (H-1B / O-1 / L-1)",
  "US (Permanent Resident / Citizen)",
  "United Kingdom",
  "Singapore",
  "Canada",
  "Europe",
  "Middle East / UAE",
  "Other International",
];

export const RELATIONS = ["Mother", "Father", "Sibling", "Guardian", "Close family"];

/** Format height in centimeters to cm and feet-inches string (e.g., 175 cm (5'9")). */
export function formatHeight(cm: number | null | undefined): string | null {
  if (!cm || cm <= 0) return null;
  const totalInches = Math.round(cm / 2.54);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${cm} cm (${feet}'${inches}")`;
}

export const PHOTO_VISIBILITY = [
  {
    value: "all_members",
    label: "All verified members",
    detail: "Any verified member may see your photograph.",
  },
  {
    value: "accepted_only",
    label: "After an accepted introduction",
    detail: "Shown only once both of you accept.",
  },
  {
    value: "hidden",
    label: "Hidden entirely",
    detail: "Nobody sees your photograph, including matches.",
  },
] as const;

export const VERIFICATION_LABELS: Record<
  string,
  { label: string; tone: "pending" | "done" | "warn" }
> = {
  unverified: { label: "Not yet submitted", tone: "warn" },
  pending_review: { label: "With the membership desk", tone: "pending" },
  verified: { label: "Verified member", tone: "done" },
  needs_resubmission: { label: "More information needed", tone: "warn" },
  rejected: { label: "Not accepted", tone: "warn" },
};

const UNKNOWN_VERIFICATION = { label: "Verification under review", tone: "pending" } as const;

/** Safe lookup — an unrecognised status must never crash a page. */
export function verificationLabel(status: string | null | undefined) {
  if (!status) return VERIFICATION_LABELS["unverified"]!;
  return VERIFICATION_LABELS[status] ?? UNKNOWN_VERIFICATION;
}

/** Statuses a member may submit from (mirrors guard_verified_columns). */
export function canSubmitForReview(status: string | null | undefined) {
  return status === "unverified" || status === "needs_resubmission" || status === "rejected";
}

// Recognised institutional / alumni mail domains used for automatic credential checks.
export const ALUMNI_DOMAINS = [
  "iitb.ac.in",
  "alumni.iitb.ac.in",
  "iitd.ac.in",
  "alumni.iitd.ac.in",
  "iitm.ac.in",
  "alumni.iitm.ac.in",
  "iitk.ac.in",
  "iitkgp.ac.in",
  "iitr.ac.in",
  "iitg.ac.in",
  "iima.ac.in",
  "iimb.ac.in",
  "iimcal.ac.in",
  "iiml.ac.in",
  "isb.edu",
  "pilani.bits-pilani.ac.in",
  "bits-pilani.ac.in",
  "nls.ac.in",
  "aiims.edu",
  "xlri.ac.in",
  "iisc.ac.in",
  "isical.ac.in",
  "stanford.edu",
  "mit.edu",
  "harvard.edu",
  "berkeley.edu",
  "ox.ac.uk",
  "cam.ac.uk",
  "insead.edu",
  "wharton.upenn.edu",
];

export function isRecognisedAlumniEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  return ALUMNI_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}
