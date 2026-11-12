import { describe, expect, it } from "vitest";
import {
  INSTITUTIONS,
  INSTITUTION_GROUPS,
  RESIDENCY_STATUSES,
  canSubmitForReview,
  getRegionsForCountry,
  verificationLabel,
  verificationPhase,
  verificationStepsDone,
} from "@/lib/profile-options";

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

  it("includes global countries including Australia, New Zealand, Ireland, and France", () => {
    expect(RESIDENCY_STATUSES).toContain("Australia");
    expect(RESIDENCY_STATUSES).toContain("New Zealand");
    expect(RESIDENCY_STATUSES).toContain("Ireland");
    expect(RESIDENCY_STATUSES).toContain("France");
    expect(RESIDENCY_STATUSES).toContain("Canada");

    expect(getRegionsForCountry("Australia")).toContain("New South Wales");
    expect(getRegionsForCountry("New Zealand")).toContain("Auckland");
    expect(getRegionsForCountry("Ireland")).toContain("Dublin");
    expect(getRegionsForCountry("France")).toContain("Île-de-France (Paris)");
  });
});

describe("verificationPhase", () => {
  it("maps each known status to its phase", () => {
    expect(verificationPhase("verified")).toBe("verified");
    expect(verificationPhase("pending_review")).toBe("in_review");
    expect(verificationPhase("needs_resubmission")).toBe("needs_work");
    expect(verificationPhase("rejected")).toBe("needs_work");
    expect(verificationPhase("unverified")).toBe("not_started");
  });

  it("defaults unknown and null statuses to not_started", () => {
    expect(verificationPhase(null)).toBe("not_started");
    expect(verificationPhase(undefined)).toBe("not_started");
    expect(verificationPhase("suspended")).toBe("not_started");
  });
});

describe("verificationLabel", () => {
  it("returns a safe fallback for unknown statuses", () => {
    expect(verificationLabel("suspended").label).toBe("Verification under review");
  });

  it("uses unverified for null", () => {
    expect(verificationLabel(null).label).toBe("Not yet submitted");
  });
});

describe("canSubmitForReview", () => {
  it("allows unverified, needs_resubmission, rejected only", () => {
    expect(canSubmitForReview("unverified")).toBe(true);
    expect(canSubmitForReview("needs_resubmission")).toBe(true);
    expect(canSubmitForReview("rejected")).toBe(true);
    expect(canSubmitForReview("pending_review")).toBe(false);
    expect(canSubmitForReview("verified")).toBe(false);
    expect(canSubmitForReview(null)).toBe(false);
  });
});

describe("verificationStepsDone", () => {
  it("mirrors the dashboard arithmetic", () => {
    expect(verificationStepsDone({})).toBe(0);
    expect(
      verificationStepsDone({ alumni_email: "a@iitb.ac.in", verification_status: "unverified" }),
    ).toBe(1);
    expect(
      verificationStepsDone({
        verification_doc_path: "doc.pdf",
        verification_status: "pending_review",
      }),
    ).toBe(2);
    expect(
      verificationStepsDone({
        alumni_email: "a@iitb.ac.in",
        verification_status: "verified",
      }),
    ).toBe(3);
  });
});
