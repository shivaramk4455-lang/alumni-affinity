import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { startDemoSession } from "@/lib/demo-access.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };
    // Demo bypass: signed-out visitors are signed in to the shared guest account.
    // Remove before real members join.
    try {
      const tokens = await startDemoSession();
      const { data: s } = await supabase.auth.setSession(tokens);
      if (s.user) return { user: s.user };
    } catch {
      /* fall through to sign-in */
    }
    throw redirect({ to: "/auth", search: { redirect: location.href } });
  },
  component: () => <Outlet />,
});
