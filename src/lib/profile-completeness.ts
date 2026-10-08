import type { MyProfileRow } from "@/lib/profile-columns";

/**
 * Profile completeness, weighted rather than counted.
 *
 * A flat "12 of 20 fields" meter lies: it reaches 100% for a member with no
 * photograph and no values statement, and tells them they are finished when
 * the directory will ignore them. So substance carries the score — a
 * photograph, the values statement, the introduction — while the small filter
 * fields move it barely at all.
 *
 * Every gap is named, because the point of the meter is to tell a member what
 * to do next, not to hand them a number.
 */

export type CompletenessItem = {
  /** Shown to the member when missing. */
  label: string;
  /** Why it matters, in one line. */
  hint: string;
  weight: number;
  filled: boolean;
  to?: "/verification" | "/onboarding" | "/settings";
  hash?: string;
  actionLabel?: string;
};

function has(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

/** The values statement carries a length floor in onboarding (20 chars). */
function hasStatement(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length >= 20;
}

export function profileCompleteness(p: MyProfileRow | null | undefined): {
  percent: number;
  earned: number;
  total: number;
  missing: CompletenessItem[];
} {
  const items: CompletenessItem[] = [
    {
      label: "Add a photograph",
      hint: "Watermarked with the viewer’s identity and protected by your privacy settings. Members with portraits are introduced far more often.",
      weight: 30,
      // photo_path is mirrored from the gallery primary, so this follows the
      // real portrait rather than a separate "did you visit the uploader" flag.
      filled: !!p?.photo_path,
    },
    {
      label: "Write what you are looking for",
      hint: "The desk reads this to shortlist introductions for you.",
      weight: 20,
      filled: hasStatement(p?.values_statement),
      to: "/onboarding",
      actionLabel: "Edit values",
    },
    {
      label: "Add a short introduction",
      hint: "Two or three sentences about your everyday life.",
      weight: 15,
      filled: has(p?.bio),
      to: "/onboarding",
      actionLabel: "Add intro",
    },
    {
      label: "Confirm your institution and degree",
      hint: "Verification is checked against these.",
      weight: 15,
      filled: has(p?.institution) && has(p?.degree) && has(p?.grad_year),
      to: "/onboarding",
      actionLabel: "Edit education",
    },
    {
      label: "Add your profession",
      hint: "Shown on your card in search.",
      weight: 10,
      filled: has(p?.profession),
      to: "/onboarding",
      actionLabel: "Edit profession",
    },
    {
      label: "Add your city",
      hint: "Used for relocation and city matching.",
      weight: 5,
      filled: has(p?.city),
      to: "/onboarding",
      actionLabel: "Edit city",
    },
    {
      label: "Add height and dietary preference",
      hint: "These drive the filters members actually use.",
      weight: 3,
      filled: has(p?.height_cm) && has(p?.diet),
      to: "/onboarding",
      actionLabel: "Edit preferences",
    },
    {
      label: "Add marital status, mother tongue and residency",
      hint: "Detail that helps the desk place you accurately.",
      weight: 2,
      filled: has(p?.marital_status) && has(p?.mother_tongue) && has(p?.residency_status),
      to: "/onboarding",
      actionLabel: "Edit details",
    },
  ];

  const total = items.reduce((sum, i) => sum + i.weight, 0);
  const earned = items.reduce((sum, i) => sum + (i.filled ? i.weight : 0), 0);
  const percent = Math.round((earned / total) * 100);

  return { percent, earned, total, missing: items.filter((i) => !i.filled) };
}
