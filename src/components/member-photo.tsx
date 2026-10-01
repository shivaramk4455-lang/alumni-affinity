import { useQuery } from "@tanstack/react-query";
import { EyeOff, UserRound } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

/**
 * Renders a member photograph from the private photo store with a visible
 * viewer-identity overlay and the moment of viewing.
 *
 * HONEST LIMIT (C-4): the overlay is a DOM deterrent, not a forensic mark —
 * the signed URL still serves the original file, so a saved copy carries no
 * stamp. The privacy policy and consent copy now say exactly this. A baked-in
 * watermark needs a server-side image pipeline (out of scope for this fix).
 */
export function MemberPhoto({
  path,
  watermark,
  className = "aspect-[4/5] w-full",
  name,
}: {
  path: string | null | undefined;
  watermark: string;
  className?: string;
  name?: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["photo", path],
    enabled: !!path,
    staleTime: 4 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("profile-photos")
        .createSignedUrl(path!, 300);
      if (error) return null;
      return data.signedUrl;
    },
  });

  if (!path || (!isLoading && !data)) {
    return (
      <div
        className={`grid place-items-center border border-border bg-secondary/50 text-center ${className}`}
      >
        <div className="px-4 py-6 text-muted-foreground">
          {path ? <EyeOff className="mx-auto size-6" /> : <UserRound className="mx-auto size-6" />}
          <p className="mt-3 text-xs leading-5">
            {path
              ? "Photograph withheld until an introduction is accepted."
              : "No photograph shared."}
          </p>
        </div>
      </div>
    );
  }

  const stamp = `${watermark} · ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;

  return (
    <div className={`relative overflow-hidden border border-border bg-secondary/40 ${className}`}>
      {data && (
        <img
          src={data}
          alt={name ? `Photograph of ${name}` : "Member photograph"}
          className="size-full object-cover"
          draggable={false}
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 grid select-none content-center justify-items-center gap-6 opacity-30"
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="-rotate-[24deg] whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.2em] text-background mix-blend-difference"
          >
            {stamp}
          </span>
        ))}
      </div>
    </div>
  );
}
