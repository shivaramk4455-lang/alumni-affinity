import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { RoutePending } from "@/components/route-pending";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Keep preloaded (hovered) routes warm for 30s instead of throwing the data
    // away instantly, so hover-then-click does not refetch from scratch.
    defaultPreloadStaleTime: 30_000,
    defaultPendingComponent: RoutePending,
  });

  return router;
};
