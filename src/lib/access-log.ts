import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * Access-audit trail: who looked at which profile, and when the coordinates
 * of an accepted introduction were actually opened.
 *
 * Views are recorded fire-and-forget through a SECURITY DEFINER RPC — a
 * missing authorisation context simply no-ops, so browsing never breaks when
 * the ledger is unavailable. The desk sees the full log; a member only ever
 * sees rows where they are the visited party (RLS).
 */
export type ProfileViewRow = {
  id: string;
  viewer_id: string;
  viewed_at: string;
};

export async function recordProfileView(viewedId: string): Promise<void> {
  const { error } = await supabase.rpc("record_profile_view", { _viewed: viewedId });
  if (error) console.error("view audit", error);
}

export type ContactRevealRow = {
  id: string;
  viewer_id: string;
  first_revealed_at: string;
  last_revealed_at: string;
  access_count: number;
};

export function useVisitorLog(enabled: boolean) {
  return useQuery({
    queryKey: ["profile-visitors"],
    enabled,
    queryFn: async (): Promise<ProfileViewRow[]> => {
      const { data, error } = await supabase
        .from("profile_views")
        .select("id, viewer_id, viewed_at")
        .order("viewed_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useContactAccessLog(myId: string | null | undefined) {
  return useQuery({
    queryKey: ["contact-access", myId],
    enabled: !!myId,
    queryFn: async (): Promise<ContactRevealRow[]> => {
      const { data, error } = await supabase
        .from("contact_reveals")
        .select("id, viewer_id, first_revealed_at, last_revealed_at, access_count")
        .eq("revealed_id", myId!)
        .order("last_revealed_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Display names for a set of visitor ids. The visitor's own profile is
 * directory-readable, so this succeeds for every row a member can already see;
 * a name that cannot be resolved simply renders as "A member".
 */
export function useProfileNames(ids: string[]) {
  const key = [...new Set(ids)].sort().join(",");
  return useQuery({
    queryKey: ["profile-names", key],
    enabled: key.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, city, institution")
        .in("id", key.split(","));
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}
