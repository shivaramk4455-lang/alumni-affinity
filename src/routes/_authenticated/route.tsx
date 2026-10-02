import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { startDemoSessionClient } from "@/lib/demo-access-dev";
import { startDemoSession } from "@/lib/demo-access.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };
    // Demo bypass: signed-out visitors are signed in to the shared guest account.
    // Remove before real members join.
    //
    // In local dev the service-role key is absent, so the server path throws;
    // the client fallback below signs into that same account directly.
    try {
      if (import.meta.env.DEV && (await startDemoSessionClient())) {
        const { data: s } = await supabase.auth.getUser();
        if (s.user) return { user: s.user };
      }
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
