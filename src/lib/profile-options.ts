export const INSTITUTIONS = [
  // IITs (All 23 campuses)
  "IIT Bombay",
  "IIT Delhi",
  "IIT Madras",
  "IIT Kanpur",
  "IIT Kharagpur",
  "IIT Roorkee",
  "IIT Guwahati",
  "IIT (BHU) Varanasi",
  "IIT Hyderabad",
  "IIT Indore",
  "IIT Gandhinagar",
  "IIT Ropar",
  "IIT Patna",
  "IIT Bhubaneswar",
  "IIT Jodhpur",
  "IIT Mandi",
  "IIT (ISM) Dhanbad",
  "IIT Tirupati",
  "IIT Palakkad",
  "IIT Goa",
  "IIT Dharwad",
  "IIT Bhilai",
  "IIT Jammu",

  // IIMs (All 21 campuses)
  "IIM Ahmedabad",
  "IIM Bangalore",
  "IIM Calcutta",
  "IIM Lucknow",
  "IIM Kozhikode",
  "IIM Indore",
  "IIM Shillong",
  "IIM Mumbai",
  "IIM Rohtak",
  "IIM Ranchi",
  "IIM Raipur",
  "IIM Tiruchirappalli (Trichy)",
  "IIM Udaipur",
  "IIM Kashipur",
  "IIM Nagpur",
  "IIM Visakhapatnam",
  "IIM Bodh Gaya",
  "IIM Amritsar",
  "IIM Sambalpur",
  "IIM Sirmaur",
  "IIM Jammu",

  // Top Management & Business Schools
  "FMS Delhi",
  "Jamnalal Bajaj (JBIMS Mumbai)",
  "ISB (Indian School of Business)",
  "XLRI Jamshedpur",

  // Premier Engineering & Science
  "BITS Pilani",
  "IISc Bengaluru",

  // Design & Fashion
  "NIFT (National Institute of Fashion Technology)",

  // Law
  "NLSIU Bengaluru",

  // Other
  "Other premier institute",
];

export const DEGREES = [
  "B.Tech",
  "B.E.",
  "Dual Degree (B.Tech + M.Tech)",
  "MBA",
  "PGDM / PGP",
  "M.Tech",
  "M.S.",
  "M.Sc",
  "B.Des / M.Des",
  "PhD",
  "Other",
] as const;

export type ProfessionGroup = {
  category: string;
  options: string[];
};

export const PROFESSION_GROUPS: ProfessionGroup[] = [
  {
    category: "Software & Technology",
    options: [
      "Software Engineer",
      "Senior Software Engineer",
      "Tech Lead / Engineering Manager",
      "Staff / Principal Engineer",
      "Director / VP of Engineering",
      "Data Scientist / AI / ML Engineer",
      "Data Analyst / BI Specialist",
      "Cloud / DevOps / Platform Engineer",
      "Product Designer / UI/UX Designer",
    ],
  },
  {
    category: "Core Engineering & Technical",
    options: [
      "Civil Engineer",
      "Mechanical Engineer",
      "Electrical / Electronics Engineer",
      "Chemical Engineer",
      "Hardware / VLSI / Semiconductor Engineer",
      "Aerospace / Automotive Engineer",
    ],
  },
  {
    category: "Corporate Management & Leadership",
    options: [
      "Manager",
      "Senior Manager",
      "General Manager / AVP / VP",
      "Director / Executive Director",
      "Chief Executive Officer (CEO)",
      "Chief Technology Officer (CTO)",
      "Chief Financial Officer (CFO)",
      "Chief Operating Officer (COO)",
      "CXO / Executive Leadership",
    ],
  },
  {
    category: "Product & Program Management",
    options: [
      "Product Manager",
      "Senior Product Manager",
      "Director / VP of Product",
      "Program Manager / Project Manager",
      "Scrum Master / Agile Coach",
    ],
  },
  {
    category: "Consulting & Strategy",
    options: [
      "Management Consultant (MBB / Tier-1)",
      "Strategy & Operations Consultant",
      "Business Analyst",
      "Associate / Engagement Manager",
      "Principal / Partner (Consulting)",
    ],
  },
  {
    category: "Banking, Finance & Investment",
    options: [
      "Investment Banker",
      "Private Equity / Venture Capital",
      "Quantitative Analyst / Quant Trader",
      "Financial Analyst / Equity Research",
      "Portfolio Manager / Fund Manager",
      "Corporate Finance / Treasury",
      "Chartered Accountant (CA) / Controller",
      "Risk & Compliance Analyst",
    ],
  },
  {
    category: "Business, Startup & Entrepreneurship",
    options: [
      "Founder / Co-Founder",
      "Business Owner / Industrialist",
      "Entrepreneur / Startup Operator",
      "Self-Employed / Independent Consultant",
      "Family Business Director",
    ],
  },
  {
    category: "Civil Services & Public Sector",
    options: [
      "Civil Services (IAS / IPS / IFS / IRS)",
      "PSU / Public Sector Executive",
      "Government Officer / Defense",
    ],
  },
  {
    category: "Marketing, Growth & Sales",
    options: [
      "Brand / Marketing Manager",
      "Growth / Performance Marketing Lead",
      "Sales / Enterprise Account Director",
      "Corporate Communications / PR",
    ],
  },
  {
    category: "Research, Academia & Law",
    options: [
      "Professor / Assistant Professor",
      "Research Scientist / Scholar",
      "Corporate Lawyer / Legal Counsel",
      "Patent / Intellectual Property Attorney",
    ],
  },
];

export const PROFESSIONS = [...PROFESSION_GROUPS.flatMap((g) => g.options), "Other"] as const;

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

export const RELIGIONS = [
  "Hindu",
  "Muslim",
  "Christian",
  "Sikh",
  "Jain",
  "Buddhist",
  "Parsi",
  "Jewish",
  "Spiritual - not religious",
  "No religion / Agnostic / Atheist",
  "Other",
] as const;

export const CASTES = [
  "Open to all / No caste bar",
  "Brahmin",
  "Bania / Vaishya / Agarwal / Gupta / Maheshwari",
  "Kayastha",
  "Kshatriya / Rajput",
  "Khatri / Arora",
  "Maratha",
  "Jat",
  "Reddy",
  "Kamma",
  "Nair",
  "Ezhava",
  "Lingayat",
  "Vokkaliga",
  "Patel / Patidar",
  "Yadav",
  "Mudaliar / Pillai",
  "Chettiar",
  "Gounder",
  "Vellalar",
  "Nadar",
  "Sindhi",
  "Bunt",
  "Sikh - Jat / Arora / Khatri",
  "Jain - Digambar / Shwetambar",
  "Muslim - Sunni / Shia",
  "Christian - Catholic / Protestant / Syrian",
  "Other",
] as const;

export const GOTRAS = [
  "Don't know / Not applicable",
  "Kashyap",
  "Bharadwaj",
  "Vashistha",
  "Vishwamitra",
  "Gautam",
  "Jamadagni",
  "Atri",
  "Agastya",
  "Sandilya",
  "Kaushik",
  "Parashar",
  "Harita",
  "Srivatsa",
  "Garg",
  "Kaundinya",
  "Mudgal",
  "Angirasa",
  "Vatsa",
  "Katyayan",
  "Shunaka",
  "Other",
] as const;

// ---------------------------------------------------------------------------
// Horoscope / Jyotish
//
// Moon sign (Rashi) and birth star (Nakshatra) drive the Ashtakoota Guna Milan
// score in src/lib/guna-milan.ts. The names here must match that module's
// RASHI_NAMES / NAKSHATRA_ORDER keys exactly, or scoring silently degrades to
// the Nakshatra-derived fallback.
// ---------------------------------------------------------------------------

/** Moon signs (Chandra Rashi) with the Sanskrit name first, as members say them. */
export const RASHIS = [
  "Mesha (Aries)",
  "Vrishabha (Taurus)",
  "Mithuna (Gemini)",
  "Karka (Cancer)",
  "Simha (Leo)",
  "Kanya (Virgo)",
  "Tula (Libra)",
  "Vrischika (Scorpio)",
  "Dhanu (Sagittarius)",
  "Makara (Capricorn)",
  "Kumbha (Aquarius)",
  "Meena (Pisces)",
] as const;

/** The 27 birth stars (Nakshatra). */
export const NAKSHATRAS = [
  "Ashwini",
  "Bharani",
  "Krittika",
  "Rohini",
  "Mrigashira",
  "Ardra",
  "Punarvasu",
  "Pushya",
  "Ashlesha",
  "Magha",
  "Purva Phalguni",
  "Uttara Phalguni",
  "Hasta",
  "Chitra",
  "Swati",
  "Vishakha",
  "Anuradha",
  "Jyeshtha",
  "Mula",
  "Purva Ashadha",
  "Uttara Ashadha",
  "Shravana",
  "Dhanishta",
  "Shatabhisha",
  "Purva Bhadrapada",
  "Uttara Bhadrapada",
  "Revati",
] as const;

/** Nakshatra quarter (Pada / Charan), 1..4. */
export const NAKSHATRA_PADAS = [1, 2, 3, 4] as const;

/** Mangal Dosha (Manglik) status. */
export const MANGALIK_OPTIONS = ["No", "Yes", "Anshik (partial)", "Don't know"] as const;

/**
 * Map a member-facing Rashi label ("Mesha (Aries)") back to the bare Sanskrit
 * name ("Mesha") the scoring engine keys on. Unknown labels pass through so a
 * future addition never crashes a profile render.
 */
export function rashiKey(label: string | null | undefined): string | null {
  if (!label) return null;
  const match = RASHIS.find((r) => r === label);
  if (match) return match.split(" ")[0]!;
  // Already a bare name, or a value we do not recognise — return as-is.
  return label.split(" ")[0] ?? label;
}

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

export const RELATIONS = [
  "Mother",
  "Father",
  "Brother",
  "Sister",
  "Sibling",
  "Uncle",
  "Aunt",
  "Cousin",
  "Guardian",
  "Close family",
  "Relative",
  "Friend",
  "Other",
];

/** Who filled in this profile. A cosmetic label only — the candidate still owns the account. */
export const PROFILE_CREATED_BY = ["Self", "Parent", "Sibling", "Relative", "Friend", "Other"];

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

export const REGIONS_BY_COUNTRY: Record<string, readonly string[]> = {
  Canada: [
    "Ontario",
    "British Columbia",
    "Alberta",
    "Quebec",
    "Manitoba",
    "Saskatchewan",
    "Nova Scotia",
    "New Brunswick",
    "Newfoundland and Labrador",
    "Other Canadian Province",
  ],
  US: [
    "California",
    "New York",
    "Washington",
    "Texas",
    "New Jersey",
    "Massachusetts",
    "Illinois",
    "Georgia",
    "Virginia",
    "North Carolina",
    "Pennsylvania",
    "Michigan",
    "Florida",
    "Other US State",
  ],
  "United Kingdom": [
    "Greater London",
    "South East England",
    "West Midlands",
    "North West England",
    "East of England",
    "Scotland",
    "Wales",
    "Other UK",
  ],
  Singapore: ["Singapore (Central)", "Singapore (East)", "Singapore (West)", "Singapore (North)"],
  "Middle East / UAE": [
    "Dubai",
    "Abu Dhabi",
    "Sharjah",
    "Doha (Qatar)",
    "Riyadh (Saudi Arabia)",
    "Other Middle East",
  ],
  Europe: ["Germany", "Netherlands", "Ireland", "Switzerland", "France", "Sweden", "Other Europe"],
  India: [
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
    "Other State / UT",
  ],
  "Other International": ["International"],
};

export const INDIAN_STATES = REGIONS_BY_COUNTRY["India"]!;

export const MAJOR_CITIES_BY_STATE: Record<string, string[]> = {
  // Canada Provinces
  Ontario: [
    "Toronto",
    "Ottawa",
    "Mississauga",
    "Brampton",
    "Waterloo",
    "Hamilton",
    "London",
    "Markham",
    "Vaughan",
  ],
  "British Columbia": ["Vancouver", "Surrey", "Burnaby", "Richmond", "Victoria", "Kelowna"],
  Alberta: ["Calgary", "Edmonton", "Red Deer"],
  Quebec: ["Montreal", "Quebec City", "Laval"],
  Manitoba: ["Winnipeg"],
  Saskatchewan: ["Saskatoon", "Regina"],
  "Nova Scotia": ["Halifax"],

  // US States
  California: [
    "San Francisco / Bay Area",
    "San Jose",
    "Sunnyvale",
    "Los Angeles",
    "San Diego",
    "Irvine",
  ],
  "New York": ["New York City", "Manhattan", "Brooklyn", "Queens", "Jersey City area"],
  Washington: ["Seattle", "Bellevue", "Redmond", "Kirkland"],
  Texas: ["Austin", "Dallas", "Houston", "Plano", "Frisco"],
  "New Jersey": ["Jersey City", "Edison", "Princeton", "Hoboken", "Newark"],
  Massachusetts: ["Boston", "Cambridge", "Somerville"],
  Illinois: ["Chicago", "Naperville", "Schaumburg"],
  Georgia: ["Atlanta", "Alpharetta", "Cumming"],
  Virginia: ["Arlington", "McLean", "Fairfax", "Richmond"],
  "North Carolina": ["Raleigh", "Charlotte", "Cary", "Durham"],
  Pennsylvania: ["Philadelphia", "Pittsburgh"],
  Michigan: ["Detroit", "Ann Arbor", "Troy"],
  Florida: ["Miami", "Tampa", "Orlando"],

  // UK & Global
  "Greater London": ["London", "Canary Wharf", "Westminster", "Croydon", "Harrow"],
  "West Midlands": ["Birmingham", "Coventry"],
  "North West England": ["Manchester", "Liverpool"],
  Scotland: ["Edinburgh", "Glasgow", "Aberdeen"],
  Dubai: ["Dubai", "Downtown", "Marina", "Deira"],
  "Abu Dhabi": ["Abu Dhabi"],
  "Singapore (Central)": ["Singapore"],
  Germany: ["Berlin", "Munich", "Frankfurt", "Hamburg"],
  Netherlands: ["Amsterdam", "Rotterdam", "The Hague", "Eindhoven"],
  Ireland: ["Dublin", "Cork", "Galway"],
  Switzerland: ["Zurich", "Geneva", "Basel"],

  // India
  "Madhya Pradesh": ["Bhopal", "Indore", "Gwalior", "Jabalpur", "Ujjain"],
  Maharashtra: ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Navi Mumbai"],
  "Delhi NCR": ["New Delhi", "Gurugram", "Noida", "Faridabad", "Ghaziabad"],
  Karnataka: ["Bengaluru", "Mysuru", "Mangaluru", "Hubli-Dharwad"],
  Telangana: ["Hyderabad", "Warangal", "Secunderabad"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli"],
  "Uttar Pradesh": ["Lucknow", "Noida", "Kanpur", "Varanasi", "Agra", "Prayagraj"],
  Gujarat: ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar"],
  "West Bengal": ["Kolkata", "Howrah", "Siliguri", "Durgapur"],
  Rajasthan: ["Jaipur", "Jodhpur", "Udaipur", "Kota"],
  Kerala: ["Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur"],
  Punjab: ["Chandigarh", "Ludhiana", "Amritsar", "Jalandhar", "Mohali"],
  Haryana: ["Gurugram", "Faridabad", "Panipat", "Ambala", "Panchkula"],
  Bihar: ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur"],
  Odisha: ["Bhubaneswar", "Cuttack", "Rourkela"],
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Tirupati"],
  Assam: ["Guwahati", "Silchar", "Dibrugarh"],
  Jharkhand: ["Ranchi", "Jamshedpur", "Dhanbad"],
  Chhattisgarh: ["Raipur", "Bhilai", "Bilaspur"],
  Uttarakhand: ["Dehradun", "Haridwar", "Rishikesh", "Nainital"],
  "Himachal Pradesh": ["Shimla", "Dharamshala", "Manali"],
  Goa: ["Panaji", "Margao", "Vasco da Gama"],
  Chandigarh: ["Chandigarh", "Mohali", "Panchkula"],
  "Jammu & Kashmir": ["Srinagar", "Jammu"],
};

export function getRegionsForCountry(
  residencyStatus: string | null | undefined,
): readonly string[] {
  if (!residencyStatus) return REGIONS_BY_COUNTRY["India"]!;
  if (residencyStatus === "Canada") return REGIONS_BY_COUNTRY["Canada"]!;
  if (residencyStatus.startsWith("US")) return REGIONS_BY_COUNTRY["US"]!;
  if (residencyStatus === "United Kingdom") return REGIONS_BY_COUNTRY["United Kingdom"]!;
  if (residencyStatus === "Singapore") return REGIONS_BY_COUNTRY["Singapore"]!;
  if (residencyStatus === "Middle East / UAE") return REGIONS_BY_COUNTRY["Middle East / UAE"]!;
  if (residencyStatus === "Europe") return REGIONS_BY_COUNTRY["Europe"]!;
  if (residencyStatus === "Other International") return REGIONS_BY_COUNTRY["Other International"]!;
  return REGIONS_BY_COUNTRY["India"]!;
}

export function detectCountryAndStateFromCity(city: string | null | undefined): {
  country: string;
  state: string;
} {
  if (!city) return { country: "India", state: "" };
  const clean = city.toLowerCase().trim();

  // Check Canada
  for (const prov of REGIONS_BY_COUNTRY["Canada"]!) {
    if (clean.includes(prov.toLowerCase())) return { country: "Canada", state: prov };
    const cities = MAJOR_CITIES_BY_STATE[prov] ?? [];
    if (cities.some((c) => clean.includes(c.toLowerCase())))
      return { country: "Canada", state: prov };
  }

  // Check US
  for (const st of REGIONS_BY_COUNTRY["US"]!) {
    if (clean.includes(st.toLowerCase())) return { country: "US (H-1B / O-1 / L-1)", state: st };
    const cities = MAJOR_CITIES_BY_STATE[st] ?? [];
    if (cities.some((c) => clean.includes(c.toLowerCase())))
      return { country: "US (H-1B / O-1 / L-1)", state: st };
  }

  // Check UK
  for (const r of REGIONS_BY_COUNTRY["United Kingdom"]!) {
    if (clean.includes(r.toLowerCase())) return { country: "United Kingdom", state: r };
    const cities = MAJOR_CITIES_BY_STATE[r] ?? [];
    if (cities.some((c) => clean.includes(c.toLowerCase())))
      return { country: "United Kingdom", state: r };
  }

  // Check India
  for (const st of REGIONS_BY_COUNTRY["India"]!) {
    if (clean.includes(st.toLowerCase())) return { country: "India", state: st };
    const cities = MAJOR_CITIES_BY_STATE[st] ?? [];
    if (cities.some((c) => clean.includes(c.toLowerCase()))) return { country: "India", state: st };
  }

  return { country: "India", state: "" };
}

export function detectStateFromCity(city: string | null | undefined): string {
  return detectCountryAndStateFromCity(city).state;
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
  // IITs
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
  "iitbhu.ac.in",
  "iith.ac.in",
  "iiti.ac.in",
  "iitgn.ac.in",
  "iitrpr.ac.in",
  "iitp.ac.in",
  "iitbbs.ac.in",
  "iitj.ac.in",
  "iitmandi.ac.in",
  "iitism.ac.in",
  "iittp.ac.in",
  "iitpkd.ac.in",
  "iitgoa.ac.in",
  "iitdh.ac.in",
  "iitbhilai.ac.in",
  "iitjammu.ac.in",

  // IIMs
  "iima.ac.in",
  "iimb.ac.in",
  "iimcal.ac.in",
  "iiml.ac.in",
  "iimk.ac.in",
  "iimidr.ac.in",
  "iimshillong.ac.in",
  "iimmumbai.ac.in",
  "iimrohtak.ac.in",
  "iimranchi.ac.in",
  "iimraipur.ac.in",
  "iimtrichy.ac.in",
  "iimu.ac.in",
  "iimkashipur.ac.in",
  "iimnagpur.ac.in",
  "iimv.ac.in",
  "iimbg.ac.in",
  "iimamritsar.ac.in",
  "iimsambalpur.ac.in",
  "iimsirmaur.ac.in",
  "iimj.ac.in",

  // Premier Business, Tech, Design & Law
  "isb.edu",
  "fms.edu",
  "jbims.edu",
  "xlri.ac.in",
  "pilani.bits-pilani.ac.in",
  "bits-pilani.ac.in",
  "nls.ac.in",
  "nift.ac.in",
  "iisc.ac.in",
  "isical.ac.in",

  // Global Premier
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
