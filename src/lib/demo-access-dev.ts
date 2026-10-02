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
  if (!import.meta.env.DEV) return false;
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
