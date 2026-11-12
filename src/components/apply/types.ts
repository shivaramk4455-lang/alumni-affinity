import { APPLY_DRAFT_KEY } from "@/lib/draft-storage";

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

/**
 * Error-key remap: the validate() collector reads DOM `[name]` attributes
 * (kebab-case for multi-word fields, e.g. `copilot-email`), while the React
 * state keys are camelCase (`copilotEmail`). `handleChange` uses this table
 * to clear both spellings so a stale error never survives an edit.
 */
export const ERROR_KEY_REMAP: Partial<Record<keyof ApplyDraft, string[]>> = {
  copilotEmail: ["copilot-email"],
  copilotName: ["copilot-name", "custom-copilot-name"],
  city: ["custom-city"],
  profession: ["custom-profession"],
  degree: ["custom-degree"],
};

export function errorKeysFor(field: keyof ApplyDraft): string[] {
  return [field as string, ...(ERROR_KEY_REMAP[field] ?? [])];
}

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
