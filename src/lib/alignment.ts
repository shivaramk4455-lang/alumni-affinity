export type PartnerPreferences = {
  user_id: string;
  min_age: number | null;
  max_age: number | null;
  genders: string[];
  institutions: string[];
  cities: string[];
  relocations: string[];
  shield_employer: boolean;
};

export const EMPTY_PREFERENCES: Omit<PartnerPreferences, "user_id"> = {
  min_age: null,
  max_age: null,
  genders: [],
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
    p.genders.length > 0 ||
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

  if (mine.genders.length > 0 && them.gender) {
    if (mine.genders.includes(them.gender)) {
      score += 1;
      reasons.push(`gender:${them.gender}`);
    }
  }

  return { score, badges, reasons };
}
