export const APPLY_DRAFT_KEY = "merit-circle-apply-draft";

export interface ApplyDraft {
  name: string;
  dob: string;
  email: string;
  phone: string;
  institution: string;
  degree: string;
  gradYear: string;
  alumniEmail: string;
  profession: string;
  country: string;
  state: string;
  city: string;
  relocation: string;
  chapter?: string;
  values: string;
  ghost: boolean;
  photosAfterInterest: boolean;
  invite: boolean;
  copilotName: string;
  copilotEmail: string;
  /** Adult age attestation: required before the application can finish. */
  adult: boolean;
}

export const emptyApplyDraft: ApplyDraft = {
  name: "",
  dob: "",
  email: "",
  phone: "",
  institution: "",
  degree: "",
  gradYear: "",
  alumniEmail: "",
  profession: "",
  country: "India",
  state: "",
  city: "",
  relocation: "",
  values: "",
  ghost: true,
  photosAfterInterest: true,
  invite: true,
  copilotName: "",
  copilotEmail: "",
  adult: false,
};

export function loadApplyDraft(): ApplyDraft {
  try {
    const raw = localStorage.getItem(APPLY_DRAFT_KEY);
    if (raw) return { ...emptyApplyDraft, ...(JSON.parse(raw) as Partial<ApplyDraft>) };
  } catch {
    /* fresh draft */
  }
  return emptyApplyDraft;
}

export const APPLY_STEPS = ["Identity", "Education", "Trajectory", "Profile", "Co-pilot"] as const;
