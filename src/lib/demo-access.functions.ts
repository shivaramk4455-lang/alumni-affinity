import { createServerFn } from "@tanstack/react-start";

const DEMO_EMAIL = "guest.demo@meritcircle.example";

/**
 * The production Supabase project. A guest session must never be minted against
 * it: the shared guest account is onboarded AND verified, so a session for it
 * can browse the whole directory and fetch every all_members photograph. An
 * unconfigured build falls back to this project (see vite.config.ts), which
 * makes "a staging host pointing at production" a realistic misconfiguration
 * rather than a hypothetical one — so it is refused outright, not merely
 * discouraged in a comment.
 */
const PRODUCTION_PROJECT_ID = "beetszutyuihbnzzmokr";

function usesProductionProject(): boolean {
  // import.meta.env is the value the bundle was built with; process.env is the
  // runtime value. Either one pointing at production is enough to refuse.
  const values = [
    process.env["SUPABASE_PROJECT_ID"],
    process.env["SUPABASE_URL"],
    import.meta.env["VITE_SUPABASE_PROJECT_ID"],
    import.meta.env["VITE_SUPABASE_URL"],
  ];
  return values.some((value) => typeof value === "string" && value.includes(PRODUCTION_PROJECT_ID));
}

/**
 * Guest preview: ensures one shared, verified demo member exists and returns a
 * session for it. The password never leaves the server.
 *
 * SECURITY: the password is an operator-supplied secret, never derived from
 * anything public. It previously came from a formula over the project URL, which
 * is public, so the credential was reconstructible by anyone reading the client
 * bundle. Requiring `DEMO_GUEST_PASSWORD` means no usable secret exists unless
 * an operator deliberately sets one.
 */
export const startDemoSession = createServerFn({ method: "POST" }).handler(async () => {
  // SECURITY: The demo path must never be reachable in a deployed environment
  // unless the operator has explicitly set ENABLE_DEMO_MODE=true. Gating on
  // NODE_ENV is insufficient because staging deployments can have NODE_ENV
  // set to values other than 'production' (e.g. 'staging', 'test').
  // Both checks must pass: ENABLE_DEMO_MODE must be 'true' AND NODE_ENV must
  // not be 'production'. Either restriction alone can be misconfigured.
  // The production database is refused separately: the shared guest account is
  // verified, so a session minted against production would read real members'
  // data.
  const demoEnabled = process.env["ENABLE_DEMO_MODE"] === "true";
  if (!demoEnabled || process.env["NODE_ENV"] === "production" || usesProductionProject()) {
    throw new Error("Guest preview is unavailable right now.");
  }
  const password = process.env["DEMO_GUEST_PASSWORD"];
  if (!password) throw new Error("Guest preview is not configured.");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Guest Preview", adult_attested: true },
  });
  if (createError && !/already been registered/i.test(createError.message)) {
    console.error("demo create", createError);
    throw new Error("Could not start the guest preview.");
  }

  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"]!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  let { data: signed, error } = await anon.auth.signInWithPassword({ email: DEMO_EMAIL, password });
  if (error || !signed.session) {
    // Existing account with a different password: find it and reset.
    for (let page = 1; page <= 20; page++) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
      const found = list?.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);
      if (found) {
        await supabaseAdmin.auth.admin.updateUserById(found.id, { password, email_confirm: true });
        break;
      }
      if (!list || list.users.length < 100) break;
    }
    ({ data: signed, error } = await anon.auth.signInWithPassword({ email: DEMO_EMAIL, password }));
  }
  if (error || !signed.session) {
    console.error("demo signin", error);
    throw new Error("Could not start the guest preview.");
  }

  await supabaseAdmin
    .from("profiles")
    .update({
      full_name: "Guest Preview",
      onboarded: true,
      verification_status: "verified",
      is_visible: false,
    } as never)
    .eq("id", signed.session.user.id);

  return {
    access_token: signed.session.access_token,
    refresh_token: signed.session.refresh_token,
  };
});
