/**
 * Guna Milan — Ashtakoota (Ashta-Koota) compatibility, the 36-point system
 * used across Indian matrimony.
 *
 * The score is derived deterministically from two members' Moon sign (Rashi)
 * and birth star (Nakshatra) — no ephemeris, no birth-time maths, no vendor.
 * The eight Kootas and their maxima:
 *
 *   1. Varna        (1)   — temperament/ego, from Moon sign
 *   2. Vashya       (2)   — mutual attraction/dominance, from Moon sign
 *   3. Tara         (3)   — birth-star fortune, from Nakshatra
 *   4. Yoni         (4)   — physical/mental symbiosis, from Nakshatra
 *   5. Graha Maitri (5)   — planetary friendship of the Moon-sign lords
 *   6. Gana         (6)   — temperament, from Nakshatra
 *   7. Bhakoot      (7)   — Moon-sign axis health (2/12 and 6/8 are dosha)
 *   8. Nadi         (8)   — the heaviest koota; same Nadi is the classic dosha
 *
 * This is an approximation of the classical system, not a substitute for a
 * jyotishi's reading: the app presents it as guidance and always shows the
 * per-koota breakdown so nothing is a black box. Manglik (Mangal Dosha) is
 * reported separately because it is a compatibility gate in its own right.
 *
 * The score is directional only where the classical system requires it
 * (Varna); everything else is symmetric, so it does not assume a groom/bride
 * role and works for any pairing.
 */

export type HoroscopeInput = {
  rashi: string | null | undefined;
  nakshatra: string | null | undefined;
  manglik?: string | null | undefined;
};

export type Koota = {
  name: string;
  max: number;
  score: number;
  detail: string;
};

export type GunaResult = {
  /** Total earned, out of 36. May be fractional (Tara can award 1.5). */
  total: number;
  max: number;
  kootas: Koota[];
  manglikDosha: "none" | "cancelled" | "present" | "unknown";
};

/** The 27 birth stars with the attributes each koota needs. */
type NakshatraInfo = {
  lord: string; // dasha lord / ruling planet
  gana: "Deva" | "Manushya" | "Rakshasa";
  yoni: string; // animal
  nadi: "Aadi" | "Madhya" | "Antya";
  rashi: RashiName; // the sign the star primarily falls in
};

export const RASHI_NAMES = [
  "Mesha",
  "Vrishabha",
  "Mithuna",
  "Karka",
  "Simha",
  "Kanya",
  "Tula",
  "Vrischika",
  "Dhanu",
  "Makara",
  "Kumbha",
  "Meena",
] as const;
export type RashiName = (typeof RASHI_NAMES)[number];

/** Moon-sign lord, used for Graha Maitri (planetary friendship). */
const RASHI_LORD: Record<RashiName, string> = {
  Mesha: "Mars",
  Vrishabha: "Venus",
  Mithuna: "Mercury",
  Karka: "Moon",
  Simha: "Sun",
  Kanya: "Mercury",
  Tula: "Venus",
  Vrischika: "Mars",
  Dhanu: "Jupiter",
  Makara: "Saturn",
  Kumbha: "Saturn",
  Meena: "Jupiter",
};

/** Varna (temperament) by Moon sign; lower index = "higher". */
const RASHI_VARNA: Record<RashiName, number> = {
  Karka: 0,
  Vrischika: 0,
  Meena: 0,
  Mesha: 1,
  Simha: 1,
  Dhanu: 1,
  Vrishabha: 2,
  Kanya: 2,
  Makara: 2,
  Mithuna: 3,
  Tula: 3,
  Kumbha: 3,
};

/** Vashya (dominance) category by Moon sign. */
const RASHI_VASHYA: Record<RashiName, string> = {
  Mesha: "Quadruped",
  Vrishabha: "Quadruped",
  Mithuna: "Human",
  Karka: "Water",
  Simha: "Wild",
  Kanya: "Human",
  Tula: "Human",
  Vrischika: "Insect",
  Dhanu: "Human",
  Makara: "Quadruped",
  Kumbha: "Human",
  Meena: "Water",
};

/** Natural planetary friendship for Graha Maitri. */
const PLANET_FRIENDS: Record<string, string[]> = {
  Sun: ["Moon", "Mars", "Jupiter"],
  Moon: ["Sun", "Mercury"],
  Mars: ["Sun", "Moon", "Jupiter"],
  Mercury: ["Sun", "Venus"],
  Jupiter: ["Sun", "Moon", "Mars"],
  Venus: ["Mercury", "Saturn"],
  Saturn: ["Mercury", "Venus"],
};
const PLANET_ENEMIES: Record<string, string[]> = {
  Sun: ["Venus", "Saturn"],
  Moon: [],
  Mars: ["Mercury"],
  Mercury: ["Moon"],
  Jupiter: ["Mercury", "Venus"],
  Venus: ["Sun", "Moon"],
  Saturn: ["Sun", "Moon", "Mars"],
};

/** Yoni enmity pairs — the classic "sworn enemy" animal combinations. */
const YONI_ENEMIES: Array<[string, string]> = [
  ["Horse", "Buffalo"],
  ["Elephant", "Lion"],
  ["Sheep", "Monkey"],
  ["Serpent", "Mongoose"],
  ["Dog", "Deer"],
  ["Cat", "Rat"],
  ["Cow", "Tiger"],
];

const NAKSHATRAS: Record<string, NakshatraInfo> = {
  Ashwini: { lord: "Ketu", gana: "Deva", yoni: "Horse", nadi: "Aadi", rashi: "Mesha" },
  Bharani: { lord: "Venus", gana: "Manushya", yoni: "Elephant", nadi: "Madhya", rashi: "Mesha" },
  Krittika: { lord: "Sun", gana: "Rakshasa", yoni: "Sheep", nadi: "Antya", rashi: "Mesha" },
  Rohini: { lord: "Moon", gana: "Manushya", yoni: "Serpent", nadi: "Antya", rashi: "Vrishabha" },
  Mrigashira: { lord: "Mars", gana: "Deva", yoni: "Serpent", nadi: "Madhya", rashi: "Vrishabha" },
  Ardra: { lord: "Rahu", gana: "Manushya", yoni: "Dog", nadi: "Aadi", rashi: "Mithuna" },
  Punarvasu: { lord: "Jupiter", gana: "Deva", yoni: "Cat", nadi: "Aadi", rashi: "Mithuna" },
  Pushya: { lord: "Saturn", gana: "Deva", yoni: "Sheep", nadi: "Madhya", rashi: "Karka" },
  Ashlesha: { lord: "Mercury", gana: "Rakshasa", yoni: "Cat", nadi: "Antya", rashi: "Karka" },
  Magha: { lord: "Ketu", gana: "Rakshasa", yoni: "Rat", nadi: "Antya", rashi: "Simha" },
  "Purva Phalguni": { lord: "Venus", gana: "Manushya", yoni: "Rat", nadi: "Aadi", rashi: "Simha" },
  "Uttara Phalguni": { lord: "Sun", gana: "Manushya", yoni: "Cow", nadi: "Madhya", rashi: "Simha" },
  Hasta: { lord: "Moon", gana: "Deva", yoni: "Buffalo", nadi: "Aadi", rashi: "Kanya" },
  Chitra: { lord: "Mars", gana: "Rakshasa", yoni: "Tiger", nadi: "Aadi", rashi: "Kanya" },
  Swati: { lord: "Rahu", gana: "Deva", yoni: "Buffalo", nadi: "Madhya", rashi: "Tula" },
  Vishakha: { lord: "Jupiter", gana: "Rakshasa", yoni: "Tiger", nadi: "Madhya", rashi: "Tula" },
  Anuradha: { lord: "Saturn", gana: "Deva", yoni: "Deer", nadi: "Madhya", rashi: "Vrischika" },
  Jyeshtha: { lord: "Mercury", gana: "Rakshasa", yoni: "Deer", nadi: "Antya", rashi: "Vrischika" },
  Mula: { lord: "Ketu", gana: "Rakshasa", yoni: "Dog", nadi: "Aadi", rashi: "Dhanu" },
  "Purva Ashadha": {
    lord: "Venus",
    gana: "Manushya",
    yoni: "Monkey",
    nadi: "Madhya",
    rashi: "Dhanu",
  },
  "Uttara Ashadha": {
    lord: "Sun",
    gana: "Manushya",
    yoni: "Mongoose",
    nadi: "Madhya",
    rashi: "Makara",
  },
  Shravana: { lord: "Moon", gana: "Deva", yoni: "Monkey", nadi: "Antya", rashi: "Makara" },
  Dhanishta: { lord: "Mars", gana: "Rakshasa", yoni: "Lion", nadi: "Antya", rashi: "Kumbha" },
  Shatabhisha: { lord: "Rahu", gana: "Rakshasa", yoni: "Horse", nadi: "Antya", rashi: "Kumbha" },
  "Purva Bhadrapada": {
    lord: "Jupiter",
    gana: "Manushya",
    yoni: "Lion",
    nadi: "Aadi",
    rashi: "Meena",
  },
  "Uttara Bhadrapada": {
    lord: "Saturn",
    gana: "Manushya",
    yoni: "Cow",
    nadi: "Madhya",
    rashi: "Meena",
  },
  Revati: { lord: "Mercury", gana: "Deva", yoni: "Elephant", nadi: "Madhya", rashi: "Meena" },
};

export const NAKSHATRA_ORDER = Object.keys(NAKSHATRAS);

/**
 * The Moon sign (Rashi) a given birth star falls in, as a bare name ("Mesha").
 * Returns null for an unknown star so a typo can never crash a profile form.
 */
export function starRashi(nakshatra: string | null | undefined): RashiName | null {
  if (!nakshatra) return null;
  return NAKSHATRAS[nakshatra.trim()]?.rashi ?? null;
}

function planetRelation(a: string, b: string): "same" | "friend" | "neutral" | "enemy" {
  if (a === b) return "same";
  if (PLANET_FRIENDS[a]?.includes(b)) return "friend";
  if (PLANET_ENEMIES[a]?.includes(b)) return "enemy";
  return "neutral";
}

function resolveRashi(input: HoroscopeInput): RashiName | null {
  const r = input.rashi?.trim();
  if (r && (RASHI_NAMES as readonly string[]).includes(r)) return r as RashiName;
  // Derive from the birth star when the Moon sign was not captured.
  const n = input.nakshatra?.trim();
  if (n && NAKSHATRAS[n]) return NAKSHATRAS[n]!.rashi;
  return null;
}

function kootaVarna(a: RashiName, b: RashiName): Koota {
  // Directional: the "higher" varna earns the point (viewer treated as groom).
  const score = RASHI_VARNA[a]! <= RASHI_VARNA[b]! ? 1 : 0;
  return { name: "Varna", max: 1, score, detail: "Temperament and ego compatibility" };
}

function kootaVashya(a: RashiName, b: RashiName): Koota {
  const ca = RASHI_VASHYA[a]!;
  const cb = RASHI_VASHYA[b]!;
  const score = ca === cb ? 2 : 0;
  return {
    name: "Vashya",
    max: 2,
    score,
    detail: ca === cb ? "Matching dominance nature" : "Different dominance natures",
  };
}

function kootaTara(idxA: number, idxB: number): Koota {
  // Benefic tara numbers: Sampat(2), Kshema(4), Sadhaka(6), Mitra(8), Parama Mitra(9).
  const benefic = new Set([2, 4, 6, 8, 9]);
  const tara = (from: number, to: number) => {
    const count = ((to - from + 27) % 27) + 1; // 1..27
    const t = count % 9;
    return t === 0 ? 9 : t;
  };
  const ab = benefic.has(tara(idxA, idxB));
  const ba = benefic.has(tara(idxB, idxA));
  const score = ab && ba ? 3 : ab || ba ? 1.5 : 0;
  return { name: "Tara", max: 3, score, detail: "Luck and well-being from the birth stars" };
}

function kootaYoni(a: string, b: string): Koota {
  let score = 2;
  if (a === b) score = 4;
  else if (YONI_ENEMIES.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) score = 0;
  return { name: "Yoni", max: 4, score, detail: `Yoni: ${a} · ${b}` };
}

function kootaGrahaMaitri(a: RashiName, b: RashiName): Koota {
  const la = RASHI_LORD[a]!;
  const lb = RASHI_LORD[b]!;
  const ab = planetRelation(la, lb);
  const ba = planetRelation(lb, la);
  let score: number;
  if (ab === "same") score = 5;
  else if (ab === "friend" && ba === "friend") score = 5;
  else if (ab === "friend" || ba === "friend") score = ab === "neutral" || ba === "neutral" ? 4 : 1;
  else if (ab === "neutral" && ba === "neutral") score = 3;
  else score = 0; // any enemy relationship
  return { name: "Graha Maitri", max: 5, score, detail: `${la} · ${lb}` };
}

function kootaGana(a: string, b: string): Koota {
  let score: number;
  if (a === b) score = 6;
  else if (a === "Rakshasa" || b === "Rakshasa") score = a === "Rakshasa" && b === "Deva" ? 1 : 0;
  else score = 6; // Deva & Manushya
  return { name: "Gana", max: 6, score, detail: `${a} · ${b}` };
}

function kootaBhakoot(a: RashiName, b: RashiName): Koota {
  const ia = RASHI_NAMES.indexOf(a);
  const ib = RASHI_NAMES.indexOf(b);
  const d = (((ib - ia) % 12) + 12) % 12; // 0..11, one direction
  // Dosha axes: 2/12 (Dwidwadash) = {1, 11}; 6/8 (Shadashtak) = {5, 7}.
  const dosha = new Set([1, 5, 7, 11]);
  const score = dosha.has(d) ? 0 : 7;
  return {
    name: "Bhakoot",
    max: 7,
    score,
    detail: dosha.has(d) ? "2/12 or 6/8 axis (Bhakoot dosha)" : "Favourable Moon-sign axis",
  };
}

function kootaNadi(a: string, b: string): Koota {
  const score = a === b ? 0 : 8;
  return {
    name: "Nadi",
    max: 8,
    score,
    detail: a === b ? "Same Nadi (Nadi dosha)" : `${a} · ${b}`,
  };
}

function manglikOf(input: HoroscopeInput): "none" | "present" | "unknown" {
  const m = input.manglik?.trim().toLowerCase();
  if (!m || m === "don't know" || m === "dont know") return "unknown";
  if (m === "no" || m === "non-manglik") return "none";
  return "present";
}

/**
 * Compute Ashtakoota compatibility. Returns `null` when either member lacks a
 * birth star (the one input every koota depends on), so callers can show a
 * "add your horoscope to see a match" prompt instead of a misleading 0.
 */
export function computeGunaMilan(a: HoroscopeInput, b: HoroscopeInput): GunaResult | null {
  const na = a.nakshatra?.trim();
  const nb = b.nakshatra?.trim();
  if (!na || !nb || !NAKSHATRAS[na] || !NAKSHATRAS[nb]) return null;

  const infoA = NAKSHATRAS[na]!;
  const infoB = NAKSHATRAS[nb]!;
  const rashiA = resolveRashi(a) ?? infoA.rashi;
  const rashiB = resolveRashi(b) ?? infoB.rashi;
  const idxA = NAKSHATRA_ORDER.indexOf(na);
  const idxB = NAKSHATRA_ORDER.indexOf(nb);

  const kootas: Koota[] = [
    kootaVarna(rashiA, rashiB),
    kootaVashya(rashiA, rashiB),
    kootaTara(idxA, idxB),
    kootaYoni(infoA.yoni, infoB.yoni),
    kootaGrahaMaitri(rashiA, rashiB),
    kootaGana(infoA.gana, infoB.gana),
    kootaBhakoot(rashiA, rashiB),
    kootaNadi(infoA.nadi, infoB.nadi),
  ];

  const total = Math.round(kootas.reduce((s, k) => s + k.score, 0) * 10) / 10;

  const ma = manglikOf(a);
  const mb = manglikOf(b);
  let manglikDosha: GunaResult["manglikDosha"];
  if (ma === "unknown" || mb === "unknown") manglikDosha = "unknown";
  else if (ma === "present" && mb === "present")
    manglikDosha = "cancelled"; // both cancels out
  else if (ma === "present" || mb === "present") manglikDosha = "present";
  else manglikDosha = "none";

  return { total, max: 36, kootas, manglikDosha };
}

/** A short human verdict band for the 36-point score. */
export function gunaVerdict(total: number): {
  label: string;
  tone: "low" | "fair" | "good" | "excellent";
} {
  if (total < 18) return { label: "Below the usual threshold", tone: "low" };
  if (total < 24) return { label: "Acceptable", tone: "fair" };
  if (total < 30) return { label: "Good match", tone: "good" };
  return { label: "Excellent match", tone: "excellent" };
}
