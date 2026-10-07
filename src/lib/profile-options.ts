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

export const HEIGHT_OPTIONS = [
  { cm: 140, label: "4' 7\" (140 cm)" },
  { cm: 142, label: "4' 8\" (142 cm)" },
  { cm: 145, label: "4' 9\" (145 cm)" },
  { cm: 147, label: "4' 10\" (147 cm)" },
  { cm: 150, label: "4' 11\" (150 cm)" },
  { cm: 152, label: "5' 0\" (152 cm)" },
  { cm: 155, label: "5' 1\" (155 cm)" },
  { cm: 157, label: "5' 2\" (157 cm)" },
  { cm: 160, label: "5' 3\" (160 cm)" },
  { cm: 163, label: "5' 4\" (163 cm)" },
  { cm: 165, label: "5' 5\" (165 cm)" },
  { cm: 168, label: "5' 6\" (168 cm)" },
  { cm: 170, label: "5' 7\" (170 cm)" },
  { cm: 173, label: "5' 8\" (173 cm)" },
  { cm: 175, label: "5' 9\" (175 cm)" },
  { cm: 178, label: "5' 10\" (178 cm)" },
  { cm: 180, label: "5' 11\" (180 cm)" },
  { cm: 183, label: "6' 0\" (183 cm)" },
  { cm: 185, label: "6' 1\" (185 cm)" },
  { cm: 188, label: "6' 2\" (188 cm)" },
  { cm: 191, label: "6' 3\" (191 cm)" },
  { cm: 193, label: "6' 4\" (193 cm)" },
  { cm: 196, label: "6' 5\" (196 cm)" },
  { cm: 198, label: "6' 6\" (198 cm)" },
  { cm: 201, label: "6' 7\" (201 cm)" },
  { cm: 203, label: "6' 8\" (203 cm)" },
  { cm: 206, label: "6' 9\" (206 cm)" },
  { cm: 208, label: "6' 10\" (208 cm)" },
  { cm: 211, label: "6' 11\" (211 cm)" },
  { cm: 213, label: "7' 0\" (213 cm)" },
] as const;

export const INDIAN_STATES = [
  "Madhya Pradesh",
  "Maharashtra",
  "Delhi NCR",
  "Karnataka",
  "Telangana",
  "Tamil Nadu",
  "Uttar Pradesh",
  "Gujarat",
  "West Bengal",
  "Rajasthan",
  "Kerala",
  "Punjab",
  "Haryana",
  "Bihar",
  "Odisha",
  "Andhra Pradesh",
  "Assam",
  "Jharkhand",
  "Chhattisgarh",
  "Uttarakhand",
  "Himachal Pradesh",
  "Goa",
  "Chandigarh",
  "Jammu & Kashmir",
  "USA / North America",
  "UK / Europe",
  "UAE / Middle East",
  "Singapore / Southeast Asia",
  "Other",
] as const;

export const MAJOR_CITIES_BY_STATE: Record<string, string[]> = {
  "Madhya Pradesh": ["Bhopal", "Indore", "Gwalior", "Jabalpur", "Ujjain"],
  "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Navi Mumbai"],
  "Delhi NCR": ["New Delhi", "Gurugram", "Noida", "Faridabad", "Ghaziabad"],
  "Karnataka": ["Bengaluru", "Mysuru", "Mangaluru", "Hubli-Dharwad"],
  "Telangana": ["Hyderabad", "Warangal", "Secunderabad"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli"],
  "Uttar Pradesh": ["Lucknow", "Noida", "Kanpur", "Varanasi", "Agra", "Prayagraj"],
  "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar"],
  "West Bengal": ["Kolkata", "Howrah", "Siliguri", "Durgapur"],
  "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Kota"],
  "Kerala": ["Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur"],
  "Punjab": ["Chandigarh", "Ludhiana", "Amritsar", "Jalandhar", "Mohali"],
  "Haryana": ["Gurugram", "Faridabad", "Panipat", "Ambala", "Panchkula"],
  "Bihar": ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur"],
  "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela"],
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Tirupati"],
  "Assam": ["Guwahati", "Silchar", "Dibrugarh"],
  "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad"],
  "Chhattisgarh": ["Raipur", "Bhilai", "Bilaspur"],
  "Uttarakhand": ["Dehradun", "Haridwar", "Rishikesh", "Nainital"],
  "Himachal Pradesh": ["Shimla", "Dharamshala", "Manali"],
  "Goa": ["Panaji", "Margao", "Vasco da Gama"],
  "Chandigarh": ["Chandigarh", "Mohali", "Panchkula"],
  "Jammu & Kashmir": ["Srinagar", "Jammu"],
  "USA / North America": ["New York", "San Francisco / Bay Area", "Seattle", "Austin", "Boston", "Chicago", "Toronto", "Vancouver"],
  "UK / Europe": ["London", "Dublin", "Amsterdam", "Berlin", "Paris", "Zurich"],
  "UAE / Middle East": ["Dubai", "Abu Dhabi", "Doha", "Riyadh"],
  "Singapore / Southeast Asia": ["Singapore", "Kuala Lumpur", "Bangkok"],
};

export function detectStateFromCity(city: string | null | undefined): string {
  if (!city) return "";
  const clean = city.toLowerCase().trim();
  for (const [st, cities] of Object.entries(MAJOR_CITIES_BY_STATE)) {
    if (clean.includes(st.toLowerCase())) return st;
    if (cities.some((c) => clean.includes(c.toLowerCase()))) return st;
  }
  return "";
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
