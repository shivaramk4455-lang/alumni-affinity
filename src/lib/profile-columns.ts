import type { Database } from "@/integrations/supabase/types";

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type MyProfileRow = Database["public"]["Views"]["my_profile"]["Row"];

/**
 * Columns of another member's profile that any verified member may read.
 *
 * `contact_phone`, `linkedin_url`, `alumni_email`, `verification_note` and
 * `verification_doc_path` are NOT readable here — they are revoked from the
 * `authenticated` role and served through public.reveal_contact(s) and the
 * public.my_profile view instead. Selecting them fails loudly rather than
 * leaking quietly, so never add them back to this list.
 */
// Written as string literals on purpose: supabase-js infers the row type from
// the literal type of the argument, so a `.join(", ")` (widened to `string`)
// would degrade every result to `GenericStringError`.
export const DIRECTORY_COLUMNS =
  "id, full_name, city, institution, degree, grad_year, profession, employer, relocation, birth_year, gender, values_statement, bio, photo_path, photo_visibility, verification_status, is_visible, onboarded, height_cm, marital_status, diet, mother_tongue, residency_status";

/** The lighter projection used for search result cards. */
export const SEARCH_COLUMNS =
  "id, full_name, city, institution, degree, grad_year, profession, relocation, birth_year, gender, height_cm, marital_status, diet, mother_tongue, residency_status";
