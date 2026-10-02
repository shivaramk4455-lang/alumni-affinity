import { createServerFn } from "@tanstack/react-start";

const DEMO_EMAIL = "guest.demo@meritcircle.example";

/**
 * Guest preview: ensures one shared, verified demo member exists and returns a
 * session for it. The password never leaves the server.
 */
// DEV-ONLY entry point. Also enforces the bypass guard server-side, so an
// accidental client import can never mint a guest session from production.
export const startDemoSession = createServerFn({ method: "POST" }).handler(async () => {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("Guest preview is unavailable right now.");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const password = `Demo-${process.env["SUPABASE_URL"]?.slice(8, 20) ?? "circle"}-Guest!2026`;

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
