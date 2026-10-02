import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { isDemoBypass, startDemoSessionClient } from "@/lib/demo-access-dev";
import { startDemoSession } from "@/lib/demo-access.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };
    // Pre-launch demo bypass (DEV ONLY): signed-out dev visitors are dropped
    // into the shared guest account so every member page can be eyeballed
    // without a login. The guard is deliberately inert in any build that is
    // not a dev server — see isDemoBypass. Remove before real members join.
    try {
      if (isDemoBypass()) {
        if (await startDemoSessionClient()) {
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
      }
    } catch {
      /* fall through to sign-in */
    }
    throw redirect({ to: "/auth", search: { redirect: location.href } });
  },
  component: () => <Outlet />,
});
