import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/**
 * Single owner for the "who is signed in" question.
 *
 * Prefer `useAuth().user` (React state) over calling `supabase.auth.getUser()`
 * afresh. `getUser()` hits the network; `getSession()` reads local storage and
 * can be stale across a token refresh. `useAuth` already subscribes to
 * `onAuthStateChange`, so its `user` is the most current identity in the SPA.
 *
 * The verifier path (edge functions, server tasks) must still use
 * `supabase.auth.getUser()` / `auth.getClaims()` — never trust a client-supplied
 * id. This helper is for browser-side query gates and mutation pre-checks only.
 */
export async function requireUser(): Promise<User> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("session unavailable");
  return data.user;
}

/**
 * Guard that never throws the raw auth error shape into a query: returns the
 * user or throws the uniform "session unavailable" the codebase already
 * standardizes on (dismissals, photo-requests, notification-prefs, subscription).
 */
export async function requireUserId(): Promise<string> {
  const user = await requireUser();
  return user.id;
}
