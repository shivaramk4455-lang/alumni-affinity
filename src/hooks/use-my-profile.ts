import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { requireUser } from "@/lib/require-user";
import type { MyProfileRow } from "@/lib/profile-columns";

/** Shared cache key for the signed-in member's own profile. */
export const MY_PROFILE_KEY = ["my-profile"] as const;

/**
 * The caller's own profile, read from the `public.my_profile` security-definer
 * view. That view is hard-scoped to `auth.uid()` and is the only place the
 * client can read its own private columns (contact details, alumni email, desk
 * note, admin flag), because those columns are revoked on `public.profiles`.
 *
 * Session gating is delegated to `useAuth()` (the single session owner). This
 * hook never calls `getSession()` itself — the queryFn still re-checks via
 * `requireUser()` so a stale cache entry can never surface a profile after
 * sign-out, but the `enabled` flag comes from React state.
 */
export function useMyProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: MY_PROFILE_KEY,
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<MyProfileRow | null> => {
      // Server-verified read: requireUser() calls getUser() (network) rather
      // than getSession() (local), so a just-expired token returns null here
      // instead of a stale profile.
      try {
        await requireUser();
      } catch {
        return null;
      }

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
