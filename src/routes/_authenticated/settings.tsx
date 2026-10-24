import { createFileRoute, Link, useNavigate, useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Eye, LogOut, Pause, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { MY_PROFILE_KEY, useMyProfile } from "@/hooks/use-my-profile";
import {
  MANGALIK_OPTIONS,
  NAKSHATRAS,
  NAKSHATRA_PADAS,
  PHOTO_VISIBILITY,
  PROFILE_CREATED_BY,
  RASHIS,
} from "@/lib/profile-options";
import { starRashi } from "@/lib/guna-milan";
import { recordConsent } from "@/lib/consent";
import { useProfileNames } from "@/lib/access-log";
import { PhotoGalleryManager } from "@/components/photo-gallery";
import { useDecidePhotoRequest, useIncomingPhotoRequests } from "@/lib/photo-requests";
import { profileCompleteness } from "@/lib/profile-completeness";
import { useDismissedIds, useRestoreProfile } from "@/lib/dismissals";

import {
  DEFAULT_PREFERENCES,
  useNotificationPreferences,
  useSaveNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/notification-prefs";

import { BillingSection } from "@/components/settings/billing-section";
import { PartnerPreferencesSection } from "@/components/settings/partner-preferences-section";
import { AccessAuditLogsSection } from "@/components/settings/access-audit-logs-section";
import { ConsentLedgerSection } from "@/components/settings/consent-ledger-section";
import { AccountDangerZone } from "@/components/settings/account-danger-zone";

/** One switch per channel, in the order they read most naturally. */
const CHANNEL_ROWS: {
  key: keyof NotificationPreferences;
  label: string;
  hint: string;
  fallback: boolean;
  needsPhone?: boolean;
}[] = [
  {
    key: "email_alerts",
    label: "Email alerts",
    hint: "Introduction requests, decisions on your own requests, and verification updates.",
    fallback: DEFAULT_PREFERENCES.email_alerts,
  },
  {
    key: "sms_alerts",
    label: "SMS alerts",
    hint: "Short text messages for the same events. Carrier rates apply.",
    fallback: DEFAULT_PREFERENCES.sms_alerts,
    needsPhone: true,
  },
  {
    key: "whatsapp_alerts",
    label: "WhatsApp alerts",
    hint: "The same alerts, delivered through WhatsApp.",
    fallback: DEFAULT_PREFERENCES.whatsapp_alerts,
    needsPhone: true,
  },
  {
    key: "email_digest",
    label: "Weekly digest",
    hint: "A Monday summary of new introductions, accepted matches and profile views.",
    fallback: DEFAULT_PREFERENCES.email_digest,
  },
  {
    key: "digest_skip_when_empty",
    label: "Skip the digest when nothing happened",
    hint: "On by default — an empty week is the fastest way to lose a subscriber.",
    fallback: DEFAULT_PREFERENCES.digest_skip_when_empty,
  },
];

/**
 * The member's action still succeeded, but the DPDP consent receipt did not
 * land. Blocking the action would be worse than the missing row, so we warn
 * loudly instead and point at the retry path.
 */
const CONSENT_RECEIPT_WARNING =
  "Saved, but the consent receipt could not be written — retry from Settings.";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — The Merit Circle" },
      {
        name: "description",
        content: "Manage your visibility, photograph privacy, contact details and membership.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Settings,
});

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";

function Settings() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [seeded, setSeeded] = useState(false);

  // Sabbatical (restrict processing).
  const [pauseUntil, setPauseUntil] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [pauseSeeded, setPauseSeeded] = useState(false);

  // Preferences dirty tracker for the unsaved changes blocker.
  const [prefDirty, setPrefDirty] = useState(false);

  const me = useMyProfile();
  const p = me.data;
  // Same weighted score as the dashboard, so the two never disagree.
  const completeness = profileCompleteness(p);

  useEffect(() => {
    if (me.data && !seeded) {
      setSeeded(true);
      setPhone(me.data.contact_phone ?? "");
      setLinkedin(me.data.linkedin_url ?? "");
    }
  }, [me.data, seeded]);

  useEffect(() => {
    if (me.data && !pauseSeeded) {
      setPauseSeeded(true);
      // <input type="date"> wants a bare yyyy-mm-dd, not an ISO timestamp.
      setPauseUntil(me.data.paused_until ? me.data.paused_until.slice(0, 10) : "");
      setPauseReason(me.data.paused_reason ?? "");
    }
  }, [me.data, pauseSeeded]);

  /**
   * Unsaved-changes guard. Contact coordinates, the sabbatical fields and
   * partner preferences live in local state until an explicit Save, and
   * this page carries links that navigate away mid-form — so a stray click
   * used to discard real edits with no warning.
   */
  const dirty =
    prefDirty ||
    phone !== (p?.contact_phone ?? "") ||
    linkedin !== (p?.linkedin_url ?? "") ||
    pauseUntil !== (p?.paused_until?.slice(0, 10) ?? "") ||
    pauseReason !== (p?.paused_reason ?? "");

  // `enableBeforeUnload` covers tab close/reload; `shouldBlockFn` covers
  // in-app navigation. Either alone would leave a gap.
  useBlocker({
    shouldBlockFn: () =>
      dirty && window.confirm("You have unsaved changes on this page. Leave without saving them?"),
    enableBeforeUnload: () => dirty,
  });

  const notifPrefs = useNotificationPreferences();
  const saveNotifPrefs = useSaveNotificationPreferences();

  // Photograph consent: incoming requests for the owner to allow or decline.
  const photoRequests = useIncomingPhotoRequests();
  const decidePhoto = useDecidePhotoRequest();
  const requesterNames = useProfileNames(photoRequests.data?.map((r) => r.requester_id) ?? []);
  const whoRequester = (id: string): string => {
    const row = requesterNames.data?.find((n) => n.id === id);
    if (!row) return requesterNames.isError ? "Identity unavailable" : "A member";
    const first = row.full_name?.split(" ")[0] || "Member";
    return row.institution ? `${first} · ${row.institution}` : first;
  };

  // "Not for me" profiles, so a private dismissal has one place to be undone.
  const dismissedIds = useDismissedIds();
  const restoreProfile = useRestoreProfile();
  const dismissedPeople = useQuery({
    queryKey: ["dismissed-people", (dismissedIds.data ?? []).join(",")],
    enabled: dismissedIds.isSuccess && (dismissedIds.data?.length ?? 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, profession, city")
        .in("id", dismissedIds.data ?? []);
      if (error) throw error;
      return data ?? [];
    },
  });

  const savePause = useMutation({
    mutationFn: async ({ until, reason }: { until: string | null; reason: string | null }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not-signed-in");
      const { error } = await supabase
        .from("profiles")
        .update({ paused_until: until, paused_reason: reason })
        .eq("id", u.user.id);
      if (error) throw error;
      return recordConsent(
        "sabbatical_visibility",
        until !== null,
        until ? `Paused until ${until}` : "Resumed discovery",
      );
    },
    onSuccess: (consent) => {
      qc.invalidateQueries({ queryKey: MY_PROFILE_KEY });
      qc.invalidateQueries({ queryKey: ["consent-events"] });
      if (consent.ok) toast.success("Visibility preference saved.");
      else toast.warning(CONSENT_RECEIPT_WARNING, { duration: 8000 });
    },
    onError: () => toast.error("Could not save your pause. Please try again."),
  });

  const save = useMutation({
    mutationFn: async (patch: Database["public"]["Tables"]["profiles"]["Update"]) => {
      // F-12: Validate the LinkedIn URL server-side before writing it.
      // The field is rendered as text now, but any future <a href> must not
      // accept javascript: or arbitrary URLs. We also reject non-LinkedIn
      // domains so the field stays semantically correct.
      if (patch.linkedin_url) {
        const url = patch.linkedin_url.trim();
        const ok =
          url === "" ||
          url.startsWith("https://linkedin.com/") ||
          url.startsWith("https://www.linkedin.com/");
        if (!ok) {
          throw new Error(
            "LinkedIn URL must start with https://linkedin.com/ or https://www.linkedin.com/",
          );
        }
      }
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("profiles").update(patch).eq("id", u.user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_PROFILE_KEY });
      toast.success("Settings saved.");
    },
    onError: () => toast.error("Could not save. Please try again."),
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
            Membership settings
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold md:text-4xl">Privacy & account</h1>
        </div>
        {p?.id && (
          <Button asChild variant="outline" className="gap-2 border-brass/40 hover:bg-brass/5">
            <Link to="/members/$id" params={{ id: p.id }}>
              <Eye className="size-4 text-brass" />
              Preview My Profile
            </Link>
          </Button>
        )}
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Most controls save the moment you change them. Contact details, the sabbatical and partner
        preferences each need an explicit Save.
      </p>

      {/* So the blocker prompt above is never a surprise. */}
      {dirty && (
        <p
          role="status"
          className="mt-4 flex items-center gap-2 border-l-2 border-brass bg-secondary/40 px-4 py-3 text-sm text-foreground"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-brass" aria-hidden="true" />
          You have unsaved changes on this page. Save each section before you leave.
        </p>
      )}

      <section className="mt-9 border border-border bg-card p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
              <UserRound className="size-5 text-brass" /> Member profile
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {p?.full_name ? `${p.full_name} · ` : ""}
              {p?.degree ? `${p.degree}, ` : ""}
              {p?.institution ? `${p.institution} · ` : ""}
              {p?.city || "Profile setup"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Profile {completeness.percent}% complete
              {completeness.missing.length > 0 &&
                ` — next: ${completeness.missing[0]?.label ?? ""}`}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/onboarding">Edit profile details</Link>
          </Button>
        </div>
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Discovery</h2>
        <div className="mt-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Visible to verified members</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Turn off for ghost mode — browse privately, appear only to people you choose or
              accept.
            </p>
          </div>
          <Switch
            checked={p?.is_visible ?? true}
            onCheckedChange={(v) => save.mutate({ is_visible: v })}
            aria-label="Visible to members"
          />
        </div>
        <div className="mt-6 grid gap-2">
          <Label htmlFor="photo-visibility" className="text-sm font-semibold">
            Who may see your photograph
          </Label>
          <select
            id="photo-visibility"
            className={selectCls}
            value={p?.photo_visibility ?? "accepted_only"}
            onChange={(e) => save.mutate({ photo_visibility: e.target.value })}
            aria-describedby="photo-visibility-detail"
          >
            {PHOTO_VISIBILITY.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span
            id="photo-visibility-detail"
            className="text-xs font-normal leading-5 text-muted-foreground"
          >
            {
              PHOTO_VISIBILITY.find((o) => o.value === (p?.photo_visibility ?? "accepted_only"))
                ?.detail
            }
          </span>
        </div>
        <div className="mt-5">
          <Label htmlFor="created-by" className="text-sm font-semibold">
            Profile created by
          </Label>
          <select
            id="created-by"
            className={selectCls}
            value={p?.created_by ?? "Self"}
            onChange={(e) => save.mutate({ created_by: e.target.value })}
            aria-describedby="created-by-detail"
          >
            {PROFILE_CREATED_BY.map((c) => (
              <option key={c} value={c}>
                {c === "Self" ? "Myself" : c}
              </option>
            ))}
          </select>
          <span
            id="created-by-detail"
            className="text-xs font-normal leading-5 text-muted-foreground"
          >
            Indicates whether this profile is managed directly by the candidate or a family member.
          </span>
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <h3 className="font-serif text-xl font-semibold">Horoscope</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Optional. Your birth star lets us show a Guna Milan (Ashtakoota) compatibility score
            with other members who have shared theirs.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="settings-nakshatra">Birth star (Nakshatra)</Label>
              <select
                id="settings-nakshatra"
                className={selectCls}
                value={p?.nakshatra ?? ""}
                onChange={(e) => {
                  const star = e.target.value || null;
                  const patch: Database["public"]["Tables"]["profiles"]["Update"] = {
                    nakshatra: star,
                  };
                  const derived = star ? starRashi(star) : null;
                  if (derived) {
                    const label = RASHIS.find((r) => r.split(" ")[0] === derived);
                    if (label) patch.rashi = label;
                  }
                  save.mutate(patch);
                }}
              >
                <option value="">Not shared</option>
                {NAKSHATRAS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settings-pada">Birth star quarter (Pada)</Label>
              <select
                id="settings-pada"
                className={selectCls}
                value={p?.nakshatra_pada?.toString() ?? ""}
                onChange={(e) =>
                  save.mutate({ nakshatra_pada: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">Not shared</option>
                {NAKSHATRA_PADAS.map((n) => (
                  <option key={n} value={String(n)}>
                    Pada {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settings-rashi">Moon sign (Rashi)</Label>
              <select
                id="settings-rashi"
                className={selectCls}
                value={p?.rashi ?? ""}
                onChange={(e) => save.mutate({ rashi: e.target.value || null })}
              >
                <option value="">Not shared</option>
                {RASHIS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settings-manglik">Manglik / Mangal Dosha</Label>
              <select
                id="settings-manglik"
                className={selectCls}
                value={p?.manglik ?? ""}
                onChange={(e) => save.mutate({ manglik: e.target.value || null })}
              >
                <option value="">Not shared</option>
                {MANGALIK_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settings-birth-time">Time of birth</Label>
              <Input
                id="settings-birth-time"
                type="time"
                value={p?.birth_time ?? ""}
                onChange={(e) => save.mutate({ birth_time: e.target.value || null })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settings-birth-place">Place of birth</Label>
              <Input
                id="settings-birth-place"
                placeholder="e.g. Pune, Maharashtra"
                maxLength={120}
                value={p?.birth_place ?? ""}
                onChange={(e) => save.mutate({ birth_place: e.target.value.trim() || null })}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-semibold">Photograph gallery</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Manage your portraits (up to 6). Reorder or set a primary photograph to appear in
              search and match cards.
            </p>
          </div>
          {p?.id && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="gap-1.5 border-brass/40 hover:bg-brass/5"
            >
              <Link to="/members/$id" params={{ id: p.id }}>
                <Eye className="size-3.5 text-brass" />
                Preview Profile
              </Link>
            </Button>
          )}
        </div>
        <div className="mt-6">
          <PhotoGalleryManager watermark="Your own view" name={p?.full_name ?? null} />
        </div>
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Photograph requests</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Members asking to see your photograph. This only applies while your photographs are set to
          “After an accepted introduction” — allowing a request lets that one member see them
          without an introduction. They are never sent the file itself; access is granted request by
          request and can be ended by declining later requests.
        </p>

        {photoRequests.isError ? (
          <p role="alert" className="mt-5 text-sm text-destructive">
            Requests could not be loaded — this is not the same as having none.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void photoRequests.refetch()}
              disabled={photoRequests.isFetching}
            >
              {photoRequests.isFetching ? "Retrying…" : "Retry"}
            </button>
          </p>
        ) : photoRequests.isLoading ? (
          <div className="mt-5 grid gap-3" aria-busy="true">
            <span className="sr-only">Loading photograph requests…</span>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !photoRequests.data?.length ? (
          <p className="mt-5 text-sm text-muted-foreground">
            No pending requests. Nobody has asked to see your photographs.
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-border border border-border">
            {photoRequests.data.map((r) => {
              const pending = decidePhoto.isPending && decidePhoto.variables?.id === r.id;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{whoRequester(r.requester_id)}</span>
                    <span className="text-xs text-muted-foreground">
                      Asked{" "}
                      {new Date(r.created_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={decidePhoto.isPending}
                      onClick={() => decidePhoto.mutate({ id: r.id, status: "accepted" })}
                    >
                      {pending ? "Working…" : "Allow"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={decidePhoto.isPending}
                      onClick={() => decidePhoto.mutate({ id: r.id, status: "declined" })}
                    >
                      Decline
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Hidden from search</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Profiles you chose <em>Not for me</em>. They are never told, and nothing about any
          introduction changes — restore one and it reappears in your next search.
        </p>

        {dismissedIds.isError ? (
          <p role="alert" className="mt-5 text-sm text-destructive">
            This list could not be loaded — hidden profiles are still being filtered.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void dismissedIds.refetch()}
              disabled={dismissedIds.isFetching}
            >
              {dismissedIds.isFetching ? "Retrying…" : "Retry"}
            </button>
          </p>
        ) : dismissedIds.isLoading ? (
          <div className="mt-5 grid gap-3" aria-busy="true">
            <span className="sr-only">Loading hidden profiles…</span>
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !(dismissedIds.data?.length ?? 0) ? (
          <p className="mt-5 text-sm text-muted-foreground">
            Nothing hidden. Use <em>Not for me</em> on a profile to keep it out of your search.
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-border border border-border">
            {(dismissedPeople.data ?? []).map((person) => {
              const restoring = restoreProfile.isPending && restoreProfile.variables === person.id;
              return (
                <li
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{person.full_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[person.profession, person.city].filter(Boolean).join(" · ") || "Member"}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restoreProfile.isPending}
                    onClick={() => restoreProfile.mutate(person.id)}
                    aria-label={`Show ${person.full_name} in your search again`}
                  >
                    {restoring ? "Restoring…" : "Show again"}
                  </Button>
                </li>
              );
            })}
            {dismissedIds.data?.some(
              (id) => !(dismissedPeople.data ?? []).some((person) => person.id === id),
            ) && (
              <li className="p-4 text-xs text-muted-foreground">
                Some hidden profiles could not be named, so they are not listed. Their dismissal
                still applies.
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Contact coordinates</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Shared only with members whose introduction you have accepted. Also editable from{" "}
          <Link
            to="/verification"
            className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
          >
            Verification
          </Link>{" "}
          — edit them in one place or the other, not both.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="contact-phone">Phone</Label>
            <Input
              id="contact-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contact-linkedin">LinkedIn</Label>
            <Input
              id="contact-linkedin"
              type="url"
              inputMode="url"
              autoComplete="url"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="linkedin.com/in/…"
            />
          </div>
        </div>
        <Button
          variant="outline"
          className="mt-5"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              {
                contact_phone: phone.trim() || null,
                linkedin_url: linkedin.trim() || null,
              },
              {
                onSuccess: async () => {
                  const consent = await recordConsent(
                    "contact_disclosure",
                    true,
                    "Contact coordinates stored for accepted introductions",
                  );
                  if (!consent.ok) toast.warning(CONSENT_RECEIPT_WARNING, { duration: 8000 });
                },
              },
            )
          }
        >
          Save contact details
        </Button>
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
          <Pause className="size-5 text-brass" /> Sabbatical pause
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Stepping back for a season? A pause removes you from search until the date you choose
          while keeping every saved shortlist, introduction and message intact. Members you already
          have an accepted introduction with keep their access, so nothing in flight is cut off.
        </p>

        {p?.paused_until && new Date(p.paused_until) > new Date() && (
          <p className="mt-4 border-l-2 border-brass bg-secondary/40 px-4 py-3 text-sm">
            Currently paused until{" "}
            <strong>
              {new Date(p.paused_until).toLocaleDateString("en-IN", { dateStyle: "medium" })}
            </strong>
            .
          </p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="pause-until">Pause until</Label>
            <Input
              id="pause-until"
              type="date"
              value={pauseUntil}
              min={new Date().toISOString().slice(0, 10)}
              max={new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
              onChange={(e) => setPauseUntil(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pause-reason">Private note to the desk (optional)</Label>
            <Input
              id="pause-reason"
              maxLength={200}
              placeholder="Travelling, focusing on work…"
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              if (!pauseUntil) {
                toast.error("Choose the date you would like to return.");
                return;
              }
              const iso = new Date(`${pauseUntil}T00:00:00Z`);
              if (Number.isNaN(iso.getTime()) || iso.getTime() <= Date.now()) {
                toast.error("Choose a future date — or resume discovery instead.");
                return;
              }
              savePause.mutate({
                until: iso.toISOString(),
                reason: pauseReason.trim() || null,
              });
            }}
            disabled={savePause.isPending}
          >
            Pause discovery
          </Button>
          <Button
            variant="ghost"
            disabled={savePause.isPending}
            onClick={() => {
              setPauseUntil("");
              setPauseReason("");
              savePause.mutate({ until: null, reason: null });
            }}
          >
            Resume discovery
          </Button>
          <span className="text-xs text-muted-foreground">Maximum pause: one year.</span>
        </div>
      </section>

      {/* Extracted modular section: Partner Preferences */}
      <PartnerPreferencesSection employer={p?.employer} onDirtyChange={setPrefDirty} />

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Session</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed in as {p?.full_name || "member"}. Sign out on shared devices.
        </p>
        <Button variant="outline" className="mt-5" onClick={signOut}>
          <LogOut /> Sign out
        </Button>
      </section>

      {/* Extracted modular section: Access Audit Logs */}
      <AccessAuditLogsSection profile={p} />

      {/* Extracted modular section: Membership Tier & Billing */}
      <BillingSection />

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
          <Bell className="size-5 text-brass" /> Alerts &amp; digests
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Choose how you hear from us outside the app. Turning every channel off still leaves you
          the in-app notifications — you will simply not be emailed or texted.
        </p>

        {notifPrefs.isError ? (
          <p
            role="alert"
            className="mt-6 border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
          >
            Your alert settings could not be loaded, so they are hidden rather than shown with
            defaults you may never have chosen — flipping a switch now could overwrite them.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void notifPrefs.refetch()}
              disabled={notifPrefs.isFetching}
            >
              {notifPrefs.isFetching ? "Retrying…" : "Retry"}
            </button>
          </p>
        ) : notifPrefs.isLoading ? (
          <div className="mt-6 divide-y divide-border border border-border" aria-busy="true">
            <span className="sr-only">Loading your alert settings…</span>
            {CHANNEL_ROWS.map((row) => (
              <div key={row.key} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{row.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.hint}</p>
                </div>
                <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-6 divide-y divide-border border border-border">
            {CHANNEL_ROWS.map((row) => (
              <div key={row.key} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{row.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.hint}</p>
                  {row.needsPhone && !p?.contact_phone && (
                    <p className="mt-1 text-xs text-destructive">
                      Add a phone number below to use this channel.
                    </p>
                  )}
                </div>
                <Switch
                  checked={notifPrefs.data ? notifPrefs.data[row.key] : row.fallback}
                  disabled={saveNotifPrefs.isPending || (row.needsPhone && !p?.contact_phone)}
                  onCheckedChange={(v) => saveNotifPrefs.mutate({ [row.key]: v })}
                  aria-label={row.label}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Extracted modular section: DPDP Consent & Privacy Ledger */}
      <ConsentLedgerSection />

      {/* Extracted modular section: Account Deletion & Withdrawal */}
      <AccountDangerZone />
    </main>
  );
}
