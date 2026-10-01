import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

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

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return { user, loading };
}
