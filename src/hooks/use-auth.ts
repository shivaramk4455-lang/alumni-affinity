import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { MY_PROFILE_KEY } from "@/hooks/use-my-profile";

/**
 * Session-level auth state only — it never reads the profile row, so it stays
 * cheap and safe to mount in the site chrome on every route.
 *
 * For the signed-in member's own profile use `useMyProfile()` from
 * `@/hooks/use-my-profile` (reads the security-definer `my_profile` view).
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED")) {
        void supabase.rpc("record_member_activity");
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void queryClient.invalidateQueries({ queryKey: MY_PROFILE_KEY });
      } else if (event === "SIGNED_OUT") {
        // A sign-out can arrive from another tab (expiry, revocation, deletion
        // elsewhere) without ever passing through the header's signOut(), which
        // is the only place that called clear(). setQueryData(null) alone left
        // revealed contacts, messages, member rows and gallery caches alive for
        // whoever touches the device next — drop everything, not just my own row.
        await queryClient.cancelQueries();
        queryClient.clear();
        queryClient.setQueryData(MY_PROFILE_KEY, null);
      }
    });
    void supabase.auth.getSession().then(({ data: { session } }) => {
      // The auth-state listener may already have resolved to signed-out while
      // this was in flight; without the guard a late response resurrects a
      // session the user just dropped.
      if (cancelled) return;
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) void supabase.rpc("record_member_activity");
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  return { user, loading };
}
