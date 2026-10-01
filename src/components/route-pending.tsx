import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shell shown while a route's pending data resolves. A blank frame reads as a
 * broken page; a skeleton keeps the layout honest.
 */
export function RoutePending() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-4 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
    </div>
  );
}
