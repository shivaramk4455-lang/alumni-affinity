import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * Consent capture for the DPDP ledger.
 *
 * Bump POLICY_VERSION whenever the privacy notice or membership terms change:
 * every ledger row stores the version that was in force, so a later dispute can
 * be answered with "you agreed to v2026-09, on this date, for this purpose".
 */
export const POLICY_VERSION = "2026-09";

export type ConsentPurpose =
  | "terms_and_privacy"
  | "partnership_criteria"
  | "document_review"
  | "photo_watermarking"
  | "contact_disclosure"
  | "sabbatical_visibility"
  | "profile_views_display"
  | "account_deletion";

export const CONSENT_LABELS: Record<ConsentPurpose, string> = {
  terms_and_privacy: "Membership terms & privacy notice",
  partnership_criteria: "Partnership criteria used for matching",
  document_review: "Credential document review by the desk",
  photo_watermarking: "On-screen viewer-identity photo overlay (deterrent, not in-file)",
  contact_disclosure: "Contact coordinates shared on accepted introductions",
  sabbatical_visibility: "Sabbatical visibility (paused discovery)",
  profile_views_display: "Visitor log displayed to me",
  account_deletion: "Account deletion request",
};

/**
 * Fire-and-forget by design: a consent record must never block or fail the
 * member's actual action, but a failure is logged rather than swallowed so the
 * desk can tell that a ledger entry is missing.
 */
export async function recordConsent(
  purpose: ConsentPurpose,
  granted = true,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc("record_consent", {
    _purpose: purpose,
    _granted: granted,
    _policy_version: POLICY_VERSION,
    _note: note,
  });
  if (error) console.error("consent ledger", error);
}

export type ConsentEvent = {
  id: string;
  purpose: string;
  granted: boolean;
  policy_version: string;
  note: string | null;
  recorded_at: string;
};

/** Newest first, capped: the ledger is a receipt, not a browsing surface. */
export function useConsentLog() {
  return useQuery({
    queryKey: ["consent-events"],
    queryFn: async (): Promise<ConsentEvent[]> => {
      const { data, error } = await supabase
        .from("consent_events")
        .select("id, purpose, granted, policy_version, note, recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });
}
