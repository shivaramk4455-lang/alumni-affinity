import { describe, expect, it } from "vitest";

import {
  alignCandidate,
  EMPTY_PREFERENCES,
  hasAnyPreferences,
  type DirectoryCandidate,
  type PartnerPreferences,
} from "@/lib/alignment";

describe("hasAnyPreferences", () => {
  it("returns false for EMPTY_PREFERENCES", () => {
    expect(hasAnyPreferences(EMPTY_PREFERENCES)).toBe(false);
  });

  it("returns false when only shield_employer is set (privacy setting, not matching criterion)", () => {
    expect(hasAnyPreferences({ ...EMPTY_PREFERENCES, shield_employer: true })).toBe(false);
  });

  it("returns true when any matching criterion is set", () => {
    expect(hasAnyPreferences({ ...EMPTY_PREFERENCES, min_age: 25 })).toBe(true);
    expect(hasAnyPreferences({ ...EMPTY_PREFERENCES, max_age: 35 })).toBe(true);
    expect(hasAnyPreferences({ ...EMPTY_PREFERENCES, institutions: ["IIT Bombay"] })).toBe(true);
    expect(hasAnyPreferences({ ...EMPTY_PREFERENCES, cities: ["Bengaluru"] })).toBe(true);
    expect(hasAnyPreferences({ ...EMPTY_PREFERENCES, diets: ["Vegetarian"] })).toBe(true);
    expect(hasAnyPreferences({ ...EMPTY_PREFERENCES, religions: ["Hindu"] })).toBe(true);
    expect(hasAnyPreferences({ ...EMPTY_PREFERENCES, caste_preference: "Brahmin" })).toBe(true);
  });
});

describe("alignCandidate", () => {
  const currentYear = new Date().getFullYear();

  const candidate: DirectoryCandidate = {
    id: "candidate-1",
    full_name: "Priya Sharma",
    city: "Bengaluru",
    institution: "IIT Delhi",
    degree: "B.Tech Computer Science",
    grad_year: 2019,
    profession: "Software Architect",
    relocation: "Open to relocating within India",
    birth_year: currentYear - 28,
    gender: "Female",
    height_cm: 168,
    diet: "Vegetarian",
    marital_status: "Never Married",
    religion: "Hindu",
    caste: "Brahmin",
    manglik: "Non-Manglik",
  };

  it("surfaces shared alma mater and same city even without preferences", () => {
    const viewer = { city: "Bengaluru", institution: "IIT Delhi" };
    const res = alignCandidate(EMPTY_PREFERENCES, viewer, candidate);

    expect(res.score).toBe(0);
    expect(res.badges).toEqual([
      { label: "Shared alma mater", detail: "IIT Delhi" },
      { label: "Same city", detail: "Bengaluru" },
    ]);
    expect(res.reasons).toContain("shared-alma-mater");
    expect(res.reasons).toContain("city:Bengaluru");
  });

  it("scores institution, city, age, height, and diet matches against saved preferences", () => {
    const viewer = { city: "Mumbai", institution: "IIT Bombay" };
    const preferences: Omit<PartnerPreferences, "user_id"> = {
      ...EMPTY_PREFERENCES,
      institutions: ["IIT Delhi"],
      cities: ["Bengaluru"],
      min_age: 26,
      max_age: 30,
      min_height_cm: 160,
      max_height_cm: 175,
      diets: ["Vegetarian"],
      religions: ["Hindu"],
      relocations: ["Open to relocating within India"],
    };

    const res = alignCandidate(preferences, viewer, candidate);

    // Score calculation:
    // +3 (institution match)
    // +2 (city match)
    // +2 (relocation match)
    // +2 (age in range)
    // +2 (height in range)
    // +2 (diet match)
    // +2 (religion match)
    // Total = 15
    expect(res.score).toBe(15);
    expect(res.badges.some((b) => b.label === "Institution match")).toBe(true);
    expect(res.badges.some((b) => b.label === "Preferred city")).toBe(true);
    expect(res.badges.some((b) => b.label === "Age in range")).toBe(true);
    expect(res.badges.some((b) => b.label === "Height in range")).toBe(true);
    expect(res.badges.some((b) => b.label === "Diet aligned")).toBe(true);
    expect(res.badges.some((b) => b.label === "Relocation aligned")).toBe(true);
  });

  it("does not award points when criteria are outside candidate values", () => {
    const viewer = { city: "Mumbai", institution: "IIT Bombay" };
    const preferences: Omit<PartnerPreferences, "user_id"> = {
      ...EMPTY_PREFERENCES,
      min_age: 35,
      max_age: 40,
      cities: ["London", "New York"],
      diets: ["Eggetarian"],
    };

    const res = alignCandidate(preferences, viewer, candidate);
    expect(res.score).toBe(0);
    expect(res.badges).toHaveLength(0);
  });
});
