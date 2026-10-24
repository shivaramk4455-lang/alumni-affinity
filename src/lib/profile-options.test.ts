import { describe, expect, it } from "vitest";
import { INSTITUTIONS, INSTITUTION_GROUPS } from "@/lib/profile-options";

describe("INSTITUTION_GROUPS", () => {
  it("covers major institution categories with non-empty lists", () => {
    expect(INSTITUTION_GROUPS.length).toBeGreaterThanOrEqual(4);
    for (const group of INSTITUTION_GROUPS) {
      expect(group.category).toBeTruthy();
      expect(group.options.length).toBeGreaterThan(0);
    }
  });

  it("accurately categorizes all 23 IITs and 21 IIMs", () => {
    const iitGroup = INSTITUTION_GROUPS.find((g) => g.category.includes("IIT"));
    const iimGroup = INSTITUTION_GROUPS.find((g) => g.category.includes("IIM"));

    expect(iitGroup).toBeDefined();
    expect(iitGroup?.options.length).toBe(23);
    expect(iitGroup?.options).toContain("IIT Bombay");
    expect(iitGroup?.options).toContain("IIT Delhi");

    expect(iimGroup).toBeDefined();
    expect(iimGroup?.options.length).toBe(21);
    expect(iimGroup?.options).toContain("IIM Ahmedabad");
    expect(iimGroup?.options).toContain("IIM Bangalore");
  });

  it("all group options exist in master INSTITUTIONS list", () => {
    const masterSet = new Set(INSTITUTIONS);
    for (const group of INSTITUTION_GROUPS) {
      for (const opt of group.options) {
        expect(masterSet.has(opt)).toBe(true);
      }
    }
  });
});
