import { createServerFn } from "@tanstack/react-start";

const DEMO_EMAIL = "guest.demo@meritcircle.example";

/**
 * Guest preview: ensures one shared, verified demo member exists and returns a
 * session for it. The password never leaves the server.
 */
export const startDemoSession = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const password = `Demo-${process.env.SUPABASE_URL?.slice(8, 20) ?? "circle"}-Guest!2026`;

  const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let user = list?.users.find((u) => u.email === DEMO_EMAIL);
  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Guest Preview", adult_attested: true },
    });
    if (error || !data.user) throw new Error("Could not start the guest preview.");
    user = data.user;
  } else {
    await supabaseAdmin.auth.admin.updateUserById(user.id, { password });
  }

  await supabaseAdmin
    .from("profiles")
    .update({
      full_name: "Guest Preview",
      onboarded: true,
      verification_status: "verified",
      is_visible: false,
    } as never)
    .eq("id", user.id);

  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signed, error } = await anon.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password,
  });
  if (error || !signed.session) throw new Error("Could not start the guest preview.");
  return {
    access_token: signed.session.access_token,
    refresh_token: signed.session.refresh_token,
  };
});
