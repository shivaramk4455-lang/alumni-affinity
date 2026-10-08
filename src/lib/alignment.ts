export type PartnerPreferences = {
  user_id: string;
  min_age: number | null;
  max_age: number | null;
  min_height_cm: number | null;
  max_height_cm: number | null;
  genders: string[];
  marital_statuses: string[];
  diets: string[];
  religions: string[];
  caste_preference: string | null;
  institutions: string[];
  cities: string[];
  relocations: string[];
  shield_employer: boolean;
};

export const EMPTY_PREFERENCES: Omit<PartnerPreferences, "user_id"> = {
  min_age: null,
  max_age: null,
  min_height_cm: null,
  max_height_cm: null,
  genders: [],
  marital_statuses: [],
  diets: [],
  religions: [],
  caste_preference: null,
  institutions: [],
  cities: [],
  relocations: [],
  shield_employer: false,
};

/** Empty preference lists mean "no constraint", never "match nothing". */
export function hasAnyPreferences(p: Omit<PartnerPreferences, "user_id">): boolean {
  return (
    p.min_age !== null ||
    p.max_age !== null ||
    p.min_height_cm !== null ||
    p.max_height_cm !== null ||
    p.genders.length > 0 ||
    p.marital_statuses.length > 0 ||
    p.diets.length > 0 ||
    p.religions.length > 0 ||
    Boolean(p.caste_preference) ||
    p.institutions.length > 0 ||
    p.cities.length > 0 ||
    p.relocations.length > 0 ||
    p.shield_employer
  );
}

export type DirectoryCandidate = {
  id: string;
  full_name: string;
  city: string | null;
  institution: string | null;
  degree: string | null;
  grad_year: number | null;
  profession: string | null;
  relocation: string | null;
  birth_year: number | null;
  gender: string | null;
  height_cm?: number | null;
  diet?: string | null;
  marital_status?: string | null;
  religion?: string | null;
  caste?: string | null;
};

export type AlignmentBadge = { label: string; detail: string };

const nowYear = new Date().getFullYear();

export type Alignment = { score: number; badges: AlignmentBadge[]; reasons: string[] };

/**
 * Deterministic compatibility scoring over directory-visible fields only.
 * Weights are deliberately legible (and shown in the UI) rather than a black
 * box: institution affinity 3, city 2, relocation 2, age band 2, gender 1.
 * Returns 0 with an empty badge list when the member has set no preferences,
 * so "best match" degrades gracefully to the existing recency order.
 */
export function alignCandidate(
  mine: Omit<PartnerPreferences, "user_id">,
  me: { city: string | null; institution: string | null },
  them: DirectoryCandidate,
): Alignment {
  if (!hasAnyPreferences(mine)) return { score: 0, badges: [], reasons: [] };

  let score = 0;
  const badges: AlignmentBadge[] = [];
  const reasons: string[] = [];

  if (mine.institutions.length > 0 && them.institution) {
    if (mine.institutions.includes(them.institution)) {
      score += 3;
      badges.push({ label: "Institution match", detail: them.institution });
      reasons.push(`institution:${them.institution}`);
    }
  }

  // Shared alma mater with the viewer is its own badge (not just a filter hit).
  if (me.institution && them.institution && me.institution === them.institution) {
    badges.push({ label: "Shared alma mater", detail: them.institution });
    reasons.push("shared-alma-mater");
  }

  if (mine.cities.length > 0 && them.city) {
    if (mine.cities.includes(them.city)) {
      score += 2;
      badges.push({ label: "Same city", detail: them.city });
      reasons.push(`city:${them.city}`);
    }
  }

  if (me.city && them.city && me.city === them.city) {
    if (!badges.some((b) => b.label === "Same city")) {
      badges.push({ label: "Same city", detail: them.city });
      reasons.push(`city:${them.city}`);
    }
  }

  if (mine.relocations.length > 0 && them.relocation) {
    if (mine.relocations.includes(them.relocation)) {
      score += 2;
      badges.push({ label: "Relocation aligned", detail: them.relocation });
      reasons.push(`relocation:${them.relocation}`);
    }
  }

  if ((mine.min_age !== null || mine.max_age !== null) && them.birth_year) {
    const age = nowYear - them.birth_year;
    const lo = mine.min_age ?? -Infinity;
    const hi = mine.max_age ?? Infinity;
    if (age >= lo && age <= hi) {
      score += 2;
      badges.push({ label: "Age in range", detail: `${age}` });
      reasons.push(`age:${age}`);
    }
  }

  if ((mine.min_height_cm !== null || mine.max_height_cm !== null) && them.height_cm) {
    const h = them.height_cm;
    const lo = mine.min_height_cm ?? -Infinity;
    const hi = mine.max_height_cm ?? Infinity;
    if (h >= lo && h <= hi) {
      score += 2;
      badges.push({ label: "Height in range", detail: `${h} cm` });
      reasons.push(`height:${h}`);
    }
  }

  if (mine.diets.length > 0 && them.diet) {
    if (mine.diets.includes(them.diet)) {
      score += 2;
      badges.push({ label: "Diet aligned", detail: them.diet });
      reasons.push(`diet:${them.diet}`);
    }
  }

  if (mine.marital_statuses.length > 0 && them.marital_status) {
    if (mine.marital_statuses.includes(them.marital_status)) {
      score += 1;
      badges.push({ label: "Marital status aligned", detail: them.marital_status });
      reasons.push(`marital:${them.marital_status}`);
    }
  }

  if (mine.religions.length > 0 && them.religion) {
    if (mine.religions.includes(them.religion)) {
      score += 2;
      badges.push({ label: "Religion match", detail: them.religion });
      reasons.push(`religion:${them.religion}`);
    }
  }

  if (mine.genders.length > 0 && them.gender) {
    if (mine.genders.includes(them.gender)) {
      score += 1;
      reasons.push(`gender:${them.gender}`);
    }
  }

  return { score, badges, reasons };
}
