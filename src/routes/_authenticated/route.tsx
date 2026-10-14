import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { startDemoSession } from "@/lib/demo-access.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({
    location,
    context,
  }: {
    location: { pathname: string; searchStr?: string };
    context: { queryClient: { invalidateQueries: () => Promise<void> } };
  }) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) return { user: sessionData.session.user };
      const { data } = await supabase.auth.getUser();
      if (data?.user) return { user: data.user };
    } catch {
      /* fall through to redirect */
    }
    // Launch gate: Guest preview bypass is OFF by default. It runs only in
    // non-production builds when VITE_ENABLE_DEMO_MODE=true is explicitly set
    // alongside server-side ENABLE_DEMO_MODE=true and DEMO_GUEST_PASSWORD.
    if (!import.meta.env["PROD"] && import.meta.env["VITE_ENABLE_DEMO_MODE"] === "true") {
      try {
        const tokens = await startDemoSession();
        const { data: s } = await supabase.auth.setSession(tokens);
        if (s.user) {
          await context.queryClient.invalidateQueries();
          return { user: s.user };
        }
      } catch {
        /* fall through to sign-in */
      }
    }
    const redirectUrl = location.pathname + (location.searchStr || "");
    throw redirect({ to: "/auth", search: { redirect: redirectUrl } });
  },
  component: () => <Outlet />,
});
