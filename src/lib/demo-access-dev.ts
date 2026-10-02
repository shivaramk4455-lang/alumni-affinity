/**
 * DEV-ONLY guest sign-in.
 *
 * The server path (`demo-access.functions.ts`) mints the shared guest account
 * with the service-role key, which is deliberately absent locally — it must
 * never reach a browser bundle. The account already exists in the project, so
 * this signs straight into it from the browser instead.
 *
 * The whole module is gated on `import.meta.env.DEV`, so a production build
 * tree-shakes it to a no-op and cannot ship the bypass.
 *
 * NOTE: deliberately NOT named `*.client.ts` — TanStack Start reserves that
 * pattern for browser-only modules and refuses to resolve imports of it from
 * route files (import-protection plugin).
 */

const DEMO_EMAIL = "guest.demo@meritcircle.example";

/**
 * Single source of truth for "are we allowed to drop a signed-out visitor
 * into the shared guest account?".
 *
 * DEV-only by construction (the flag cannot be flicked on in a production
 * bundle), and the server entry point double-checks independently. Remove
 * before real members join.
 */
export const BYPASS_DISABLED_NOTE = "Demo bypass is disabled outside development builds.";
export const BYPASS_REMOVAL_NOTE = "Remove the demo bypass before real members join.";

export function isDemoBypass(): boolean {
  return import.meta.env.DEV === true && canBypass();
}

/**
 * Narrow escape hatch for tests. Production code never calls this; it exists
 * so the bypass's removal can itself be tested once it happens.
 */
let bypassLocked = false;
export function lockBypassForTests(): void {
  bypassLocked = true;
}
function canBypass(): boolean {
  return !bypassLocked;
}

/**
 * Same derivation the server function uses, so both paths agree on the
 * password for the shared account.
 */
function demoPassword(): string {
  const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  return `Demo-${url?.slice(8, 20) ?? "circle"}-Guest!2026`;
}

/**
 * Signs the browser into the shared guest account.
 *
 * Returns true only when a real session was established, so a caller can fall
 * through to the sign-in page rather than assume success.
 */
export async function startDemoSessionClient(): Promise<boolean> {
  if (!isDemoBypass()) return false;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.auth.signInWithPassword({
      email: DEMO_EMAIL,
      password: demoPassword(),
    });
    return !error && !!data.session;
  } catch {
    return false;
  }
}
