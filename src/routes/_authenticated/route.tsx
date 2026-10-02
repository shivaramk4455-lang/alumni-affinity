import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { startDemoSession } from "@/lib/demo-access.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };
    // Pre-launch demo bypass: signed-out visitors are dropped into the shared
    // guest account so member pages can be eyeballed without a login.
    //
    // The session is minted SERVER-SIDE only. A client-side sign-in would need
    // the guest password in the browser, and Vite inlines every VITE_* value
    // into the public bundle — i.e. the credential would ship. The server path
    // refuses in production and requires DEMO_GUEST_PASSWORD to be set.
    try {
      const tokens = await startDemoSession();
      const { data: s } = await supabase.auth.setSession(tokens);
      if (s.user) {
        // Chrome may have cached a signed-out profile while we were signing in.
        await context.queryClient.invalidateQueries();
        return { user: s.user };
      }
    } catch {
      /* fall through to sign-in */
    }
    throw redirect({ to: "/auth", search: { redirect: location.href } });
  },
  component: () => <Outlet />,
});
