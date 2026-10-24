import type { ApplyDraft } from "@/components/apply/types";

export function computeAgeFromDob(
  dobString: string,
  referenceDate: Date = new Date(),
): number | null {
  if (!dobString.trim()) return null;
  const dob = new Date(`${dobString.trim()}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;

  let age = referenceDate.getFullYear() - dob.getFullYear();
  if (
    referenceDate.getMonth() < dob.getMonth() ||
    (referenceDate.getMonth() === dob.getMonth() && referenceDate.getDate() < dob.getDate())
  ) {
    age -= 1;
  }
  return age;
}

export function validateApplyStep(
  stepIndex: number,
  draft: ApplyDraft,
  requiredFieldValues: Record<string, string> = {},
  referenceDate: Date = new Date(),
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [fieldName, val] of Object.entries(requiredFieldValues)) {
    if (!val || !val.trim()) {
      errors[fieldName] = "Please complete this field.";
    }
  }

  if (stepIndex === 0 && draft.dob.trim()) {
    const age = computeAgeFromDob(draft.dob, referenceDate);
    if (age === null) {
      errors["dob"] = "Enter your date of birth as a calendar date.";
    } else if (age < 21) {
      errors["dob"] = "Membership is open to members aged 21 or over.";
    }
  }

  if (
    stepIndex === 1 &&
    draft.alumniEmail.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.alumniEmail.trim())
  ) {
    errors["alumniEmail"] =
      "Enter a valid institutional email, or leave it blank and verify with a document later.";
  }

  if (
    stepIndex === 4 &&
    draft.invite &&
    draft.copilotEmail.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.copilotEmail.trim())
  ) {
    errors["copilot-email"] = "Enter a valid email for your co-pilot.";
  }

  if (stepIndex === 4 && !draft.adult) {
    errors["adult"] = "Please confirm the adult attestation to finish your application.";
  }

  return errors;
}
