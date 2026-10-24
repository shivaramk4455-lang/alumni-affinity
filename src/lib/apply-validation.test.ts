import { describe, expect, it } from "vitest";
import { computeAgeFromDob, validateApplyStep } from "./apply-validation";
import { emptyApplyDraft } from "@/components/apply/types";

describe("apply-validation", () => {
  const refDate = new Date("2026-10-24T12:00:00");

  it("calculates age correctly from DOB string", () => {
    // 28 years old on refDate
    expect(computeAgeFromDob("1998-05-15", refDate)).toBe(28);
    // Exact birthday today (born 2000-10-24 -> 26)
    expect(computeAgeFromDob("2000-10-24", refDate)).toBe(26);
    // Birthday tomorrow (born 2000-10-25 -> 25)
    expect(computeAgeFromDob("2000-10-25", refDate)).toBe(25);
    // Invalid date returns null
    expect(computeAgeFromDob("not-a-date", refDate)).toBeNull();
    expect(computeAgeFromDob("", refDate)).toBeNull();
  });

  it("enforces 21+ age gate on step 0", () => {
    const underageDraft = {
      ...emptyApplyDraft,
      dob: "2007-01-01", // 19 years old in 2026
    };
    const errors = validateApplyStep(0, underageDraft, {}, refDate);
    expect(errors["dob"]).toBe("Membership is open to members aged 21 or over.");

    const adultDraft = {
      ...emptyApplyDraft,
      dob: "2000-01-01", // 26 years old
    };
    const okErrors = validateApplyStep(0, adultDraft, {}, refDate);
    expect(okErrors["dob"]).toBeUndefined();
  });

  it("flags malformed institutional email on step 1", () => {
    const invalidEmailDraft = {
      ...emptyApplyDraft,
      alumniEmail: "not-an-email",
    };
    const errors = validateApplyStep(1, invalidEmailDraft, {}, refDate);
    expect(errors["alumniEmail"]).toContain("Enter a valid institutional email");

    const validEmailDraft = {
      ...emptyApplyDraft,
      alumniEmail: "alumnus@alumni.iitb.ac.in",
    };
    const okErrors = validateApplyStep(1, validEmailDraft, {}, refDate);
    expect(okErrors["alumniEmail"]).toBeUndefined();
  });

  it("validates co-pilot email when invite is enabled on step 4", () => {
    const invalidCopilotDraft = {
      ...emptyApplyDraft,
      invite: true,
      copilotEmail: "bad-copilot-email",
      adult: true,
    };
    const errors = validateApplyStep(4, invalidCopilotDraft, {}, refDate);
    expect(errors["copilot-email"]).toBe("Enter a valid email for your co-pilot.");

    const validCopilotDraft = {
      ...emptyApplyDraft,
      invite: true,
      copilotEmail: "family@example.com",
      adult: true,
    };
    const okErrors = validateApplyStep(4, validCopilotDraft, {}, refDate);
    expect(okErrors["copilot-email"]).toBeUndefined();
  });

  it("requires adult attestation on step 4", () => {
    const unconfirmedDraft = {
      ...emptyApplyDraft,
      adult: false,
    };
    const errors = validateApplyStep(4, unconfirmedDraft, {}, refDate);
    expect(errors["adult"]).toBe(
      "Please confirm the adult attestation to finish your application.",
    );

    const confirmedDraft = {
      ...emptyApplyDraft,
      adult: true,
    };
    const okErrors = validateApplyStep(4, confirmedDraft, {}, refDate);
    expect(okErrors["adult"]).toBeUndefined();
  });
});
