import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { clearMemberDrafts } from "@/lib/draft-storage";
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
      if (
        session?.user &&
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED")
      ) {
        // The result was discarded: the PostgREST builder resolves with
        // { error } rather than rejecting, so a failed activity ping was
        // completely invisible — and it fires on every token refresh.
        void supabase.rpc("record_member_activity").then(({ error }) => {
          if (error) console.error("use-auth: activity ping failed:", error.message);
        });
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void queryClient.invalidateQueries({ queryKey: MY_PROFILE_KEY });
      } else if (event === "SIGNED_OUT") {
        // A sign-out can arrive from another tab (expiry, revocation, deletion
        // elsewhere) without ever passing through the header's signOut(), which
        // is the only place that called clear(). setQueryData(null) alone left
        // revealed contacts, messages, member rows and gallery caches alive for
        // whoever touches the device next — drop everything, not just my own row.
        // The application and onboarding drafts hold PII and are cleared for the
        // same reason: on a shared device they must not outlive the session.
        await queryClient.cancelQueries();
        queryClient.clear();
        queryClient.setQueryData(MY_PROFILE_KEY, null);
        clearMemberDrafts();
      }
    });
    void supabase.auth.getSession().then(({ data: { session } }) => {
      // The auth-state listener may already have resolved to signed-out while
      // this was in flight; without the guard a late response resurrects a
      // session the user just dropped.
      if (cancelled) return;
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) {
        void supabase.rpc("record_member_activity").then(({ error }) => {
          if (error) console.error("use-auth: activity ping failed:", error.message);
        });
      }
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  return { user, loading };
}

/**
 * Signing a member out and sanitising their slice of shared-device state —
 * the query cache (revealed contacts, messages, member rows, gallery) plus
 * the PII-holding localStorage drafts. Used by both the in-app sign-out
 * buttons and as the single place that defines what "signed out" means for
 * this client: the same discipline the `SIGNED_OUT` auth event applies.
 */
export async function signOutAndClear(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.clear();
  clearMemberDrafts();
  await supabase.auth.signOut();
}
