import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { MyProfileRow } from "@/lib/profile-columns";

/** Shared cache key for the signed-in member's own profile. */
export const MY_PROFILE_KEY = ["my-profile"] as const;

/**
 * The caller's own profile, read from the `public.my_profile` security-definer
 * view. That view is hard-scoped to `auth.uid()` and is the only place the
 * client can read its own private columns (contact details, alumni email, desk
 * note, admin flag), because those columns are revoked on `public.profiles`.
 */
export function useMyProfile() {
  return useQuery({
    queryKey: MY_PROFILE_KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<MyProfileRow | null> => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const user = sessionData.session?.user;
      if (!user) return null;

      const { data, error } = await supabase.from("my_profile").select("*").maybeSingle();
      if (error) throw error;
      return (data as MyProfileRow | null) ?? null;
    },
  });
}

export type RevealedContact = {
  profile_id: string;
  contact_phone: string;
  linkedin_url: string;
};

/** Contact coordinates for members with a mutually accepted introduction. */
export function useRevealedContacts(profileIds: string[]) {
  const key = [...new Set(profileIds)].sort().join(",");
  return useQuery<RevealedContact[]>({
    queryKey: ["revealed-contacts", key],
    enabled: key.length > 0,
    queryFn: async (): Promise<RevealedContact[]> => {
      const { data, error } = await supabase.rpc("reveal_contacts", { _profiles: key.split(",") });
      if (error) throw error;
      return (data ?? []) as RevealedContact[];
    },
  });
}
