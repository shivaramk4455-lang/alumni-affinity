import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SearchResultRow } from "@/lib/profile-columns";
import { formatHeight } from "@/lib/profile-options";
import type { Alignment } from "@/lib/alignment";

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Small round thumbnail for a search card.
 *
 * Checks `photo_visibility` first and degrades gracefully to initials when
 * photo is withheld or pending an accepted introduction.
 */
export function AvatarPhoto({
  path,
  name,
  visibility,
}: {
  path?: string | null | undefined;
  name: string;
  visibility?: string | null | undefined;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const withheld = !path || visibility === "hidden" || visibility === "accepted_only";

  const { data } = useQuery({
    queryKey: ["search-photo", path],
    enabled: !!path && !withheld,
    staleTime: 4 * 60 * 1000,
    queryFn: async () => {
      const { data: signedData, error } = await supabase.storage
        .from("profile-photos")
        .createSignedUrl(path!, 300);
      if (error) return null;
      return signedData.signedUrl;
    },
  });

  if (withheld || !data) {
    return (
      <span
        aria-hidden="true"
        title={path ? "Photograph withheld until an introduction is accepted" : undefined}
        className="grid size-14 shrink-0 place-items-center rounded-full border border-border bg-secondary/60 text-xs font-semibold text-muted-foreground"
      >
        {initials || <UserRound className="size-5" />}
      </span>
    );
  }

  return (
    <img
      src={data}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className="size-14 shrink-0 rounded-full border border-border object-cover"
    />
  );
}

export interface MemberCardProps {
  member: SearchResultRow;
  alignment: Alignment;
}

export function MemberCard({ member, alignment }: MemberCardProps) {
  const age = member.birth_year ? CURRENT_YEAR - member.birth_year : null;
  const firstName = member.full_name.split(" ")[0] || "Member";

  const attributes = [
    formatHeight(member.height_cm),
    member.diet,
    member.marital_status && member.marital_status !== "Never married"
      ? member.marital_status
      : null,
    member.religion,
    member.caste,
  ].filter(Boolean);

  return (
    <li className="list-none">
      <Link
        to="/members/$id"
        params={{ id: member.id }}
        className="block h-full border border-border bg-card p-6 transition-colors hover:border-brass hover:shadow-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              {firstName}
              {age !== null ? `, ${age}` : ""}
            </h2>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {member.profession || "Alumni Member"}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
              <ShieldCheck className="size-4" /> Verified
            </span>
            <AvatarPhoto
              path={member.photo_path}
              name={member.full_name}
              visibility={member.photo_visibility}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <GraduationCap className="size-3.5 shrink-0" />
            <span className="truncate">
              {member.degree}, {member.institution} ’{String(member.grad_year ?? "").slice(-2)}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">
              {member.city} · {member.relocation}
            </span>
          </span>
          {attributes.length > 0 && (
            <span className="truncate text-xs text-muted-foreground">{attributes.join(" · ")}</span>
          )}
        </div>

        {alignment.badges.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {alignment.badges.slice(0, 3).map((b) => (
              <span
                key={b.label}
                aria-label={`${b.label}: ${b.detail}`}
                className="border border-brass/50 bg-brass/5 px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-brass-strong"
              >
                {b.label}
              </span>
            ))}
            {alignment.badges.length > 3 && (
              <span className="px-1 py-0.5 text-xs font-semibold text-muted-foreground">
                +{alignment.badges.length - 3} more
              </span>
            )}
          </div>
        )}
      </Link>
    </li>
  );
}
