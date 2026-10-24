import { Check, SlidersHorizontal } from "lucide-react";
import { formatHeight } from "@/lib/profile-options";
import type { PartnerPreferences } from "@/lib/alignment";
import { DetailRow } from "./detail-row";

interface LookingForCardProps {
  cp?:
    | (Partial<PartnerPreferences> & { manglik_preference?: string | null | undefined })
    | null
    | undefined;
  hasCandidatePrefs: boolean;
  valuesStatement?: string | null | undefined;
  mutualMatch: boolean;
  viewerMatchesCandidate: boolean;
  isSelf: boolean;
}

export function LookingForCard({
  cp,
  hasCandidatePrefs,
  valuesStatement,
  mutualMatch,
  viewerMatchesCandidate,
  isSelf,
}: LookingForCardProps) {
  if (!hasCandidatePrefs && !valuesStatement) return null;

  return (
    <section className="mt-8 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
          <SlidersHorizontal className="size-5 text-brass" /> Looking for in a partner
        </h2>
        {mutualMatch && !isSelf && (
          <span className="inline-flex items-center gap-1.5 border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
            <Check className="size-3.5" /> Mutual preference match
          </span>
        )}
        {viewerMatchesCandidate && !mutualMatch && !isSelf && (
          <span className="inline-flex items-center gap-1.5 border border-brass/50 bg-brass/5 px-2.5 py-1 text-xs font-semibold text-brass-strong">
            <Check className="size-3.5" /> You fit what they’re looking for
          </span>
        )}
      </div>

      {hasCandidatePrefs && cp && (
        <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          {((cp.min_age !== null && cp.min_age !== undefined) ||
            (cp.max_age !== null && cp.max_age !== undefined)) && (
            <DetailRow
              k="Age range"
              v={
                cp.min_age && cp.max_age
                  ? `${cp.min_age} – ${cp.max_age} years`
                  : cp.min_age
                    ? `${cp.min_age}+ years`
                    : `Up to ${cp.max_age} years`
              }
            />
          )}
          {((cp.min_height_cm !== null && cp.min_height_cm !== undefined) ||
            (cp.max_height_cm !== null && cp.max_height_cm !== undefined)) && (
            <DetailRow
              k="Height range"
              v={
                cp.min_height_cm && cp.max_height_cm
                  ? `${formatHeight(cp.min_height_cm)} – ${formatHeight(cp.max_height_cm)}`
                  : cp.min_height_cm
                    ? `Min ${formatHeight(cp.min_height_cm)}`
                    : `Up to ${formatHeight(cp.max_height_cm)}`
              }
            />
          )}
          {cp.marital_statuses && cp.marital_statuses.length > 0 && (
            <DetailRow k="Marital status" v={cp.marital_statuses.join(", ")} />
          )}
          {cp.diets && cp.diets.length > 0 && (
            <DetailRow k="Dietary habit" v={cp.diets.join(", ")} />
          )}
          {cp.genders && cp.genders.length > 0 && (
            <DetailRow k="Preferred gender" v={cp.genders.join(", ")} />
          )}
          {cp.institutions && cp.institutions.length > 0 && (
            <DetailRow k="Education / Institutions" v={cp.institutions.join(", ")} />
          )}
          {cp.cities && cp.cities.length > 0 && (
            <DetailRow k="Preferred cities" v={cp.cities.join(", ")} />
          )}
          {cp.relocations && cp.relocations.length > 0 && (
            <DetailRow k="Relocation preference" v={cp.relocations.join(", ")} />
          )}
          {cp.religions && cp.religions.length > 0 && (
            <DetailRow k="Preferred religion" v={cp.religions.join(", ")} />
          )}
          {cp.caste_preference && <DetailRow k="Community / Caste" v={cp.caste_preference} />}
          {cp.manglik_preference && <DetailRow k="Manglik preference" v={cp.manglik_preference} />}
        </dl>
      )}

      {valuesStatement && (
        <div className="mt-5 border-l-2 border-brass/60 bg-secondary/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
            In their own words
          </p>
          <p className="mt-2 text-sm leading-7">{valuesStatement}</p>
        </div>
      )}
    </section>
  );
}
