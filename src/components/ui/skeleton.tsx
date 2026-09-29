import { cn } from "@/lib/utils";

/**
 * Loading placeholder.
 *
 * A skeleton (rather than a bare "Loading…" string) keeps the page's shape
 * stable while data arrives, so a slow query cannot be mistaken for an empty
 * result — the failure mode the error states in this app exist to prevent.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn("animate-pulse rounded-sm bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
