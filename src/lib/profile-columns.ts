import type { Database } from "@/integrations/supabase/types";

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type MyProfileView = Database["public"]["Views"]["my_profile"]["Row"];
/** View columns are reported nullable; the underlying profile columns are NOT NULL. */
export type MyProfileRow = Omit<
  MyProfileView,
  | "id"
  | "full_name"
  | "is_visible"
  | "onboarded"
  | "is_admin"
  | "verification_status"
  | "photo_visibility"
> & {
  id: string;
  full_name: string;
  is_visible: boolean;
  onboarded: boolean;
  is_admin: boolean;
  verification_status: string;
  photo_visibility: string;
};

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
  "id, full_name, city, institution, degree, grad_year, profession, employer, relocation, birth_year, gender, values_statement, bio, photo_path, photo_visibility, verification_status, is_visible, onboarded, height_cm, marital_status, diet, mother_tongue, residency_status, religion, caste, gotra";

/** The lighter projection used for search result cards. */
export const SEARCH_COLUMNS =
  // photo_path was missing here, so search cards could not render a photograph
  // at all even though the profile page leads with one. In a matrimonial
  // directory that was the largest single gap in the product.
  //
  // photo_visibility rides along so a card can skip the signed-URL request
  // outright when the member has not opened their photo to us, instead of
  // firing a request that storage RLS will refuse. Both columns are inside the
  // existing column-level GRANT on profiles.
  "id, full_name, city, institution, degree, grad_year, profession, relocation, birth_year, gender, height_cm, marital_status, diet, mother_tongue, residency_status, photo_path, photo_visibility, religion, caste, gotra";
