import { createFileRoute, Link, useNavigate, useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Crown,
  Eye,
  Lock,
  LogOut,
  Pause,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { MY_PROFILE_KEY, useMyProfile } from "@/hooks/use-my-profile";
import { EMPTY_PREFERENCES, hasAnyPreferences } from "@/lib/alignment";
import { CONSENT_LABELS, useConsentLog, recordConsent, type ConsentPurpose } from "@/lib/consent";
import { GENDERS, INSTITUTIONS, PHOTO_VISIBILITY, RELOCATION } from "@/lib/profile-options";
import { useContactAccessLog, useProfileNames, useVisitorLog } from "@/lib/access-log";
import { PhotoGalleryManager } from "@/components/photo-gallery";
import { useDecidePhotoRequest, useIncomingPhotoRequests } from "@/lib/photo-requests";
import { profileCompleteness } from "@/lib/profile-completeness";

import {
  inr,
  useCancelSubscription,
  useMySubscription,
  usePlans,
  useStartCheckout,
} from "@/lib/subscription";
import {
  DEFAULT_PREFERENCES,
  useNotificationPreferences,
  useSaveNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/notification-prefs";

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

/** Must match the confirmation string the delete-account function expects. */
const DELETE_CONFIRMATION = "DELETE MY ACCOUNT";

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
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  // "Clear all" wipes every stored criterion, so it takes a second click.
  const [clearOpen, setClearOpen] = useState(false);

  // Sabbatical (restrict processing) and account deletion (right to erasure).
  const [pauseUntil, setPauseUntil] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [pauseSeeded, setPauseSeeded] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  // Partner preferences (private, owner-only row).
  const [prefSeeded, setPrefSeeded] = useState(false);
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [prefGenders, setPrefGenders] = useState<string[]>([]);
  const [prefInstitutions, setPrefInstitutions] = useState<string[]>([]);
  const [prefCities, setPrefCities] = useState("");
  const [prefRelocations, setPrefRelocations] = useState<string[]>([]);
  const [prefShieldEmployer, setPrefShieldEmployer] = useState(false);

  const me = useMyProfile();
  const p = me.data;
  // Same weighted score as the dashboard, so the two never disagree.
  const completeness = profileCompleteness(p);

  const prefs = useQuery({
    queryKey: ["partner-preferences"],
    enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_preferences")
        .select("min_age, max_age, genders, institutions, cities, relocations, shield_employer")
        .maybeSingle();
      if (error) throw error;
      if (!data) return { ...EMPTY_PREFERENCES };
      return {
        min_age: data.min_age,
        max_age: data.max_age,
        genders: data.genders ?? [],
        institutions: data.institutions ?? [],
        cities: data.cities ?? [],
        relocations: data.relocations ?? [],
        shield_employer: data.shield_employer ?? false,
      };
    },
  });

  useEffect(() => {
    if (prefs.data && !prefSeeded) {
      setPrefSeeded(true);
      setMinAge(prefs.data.min_age?.toString() ?? "");
      setMaxAge(prefs.data.max_age?.toString() ?? "");
      setPrefGenders(prefs.data.genders);
      setPrefInstitutions(prefs.data.institutions);
      setPrefCities(prefs.data.cities.join(", "));
      setPrefRelocations(prefs.data.relocations);
      setPrefShieldEmployer(prefs.data.shield_employer);
    }
  }, [prefs.data, prefSeeded]);

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

  const consentLog = useConsentLog();

  /**
   * Unsaved-changes guard. Contact coordinates, the sabbatical fields and all
   * seven partner preferences live in local state until an explicit Save, and
   * this page carries links that navigate away mid-form — so a stray click
   * used to discard real edits with no warning.
   */
  const dirty =
    phone !== (p?.contact_phone ?? "") ||
    linkedin !== (p?.linkedin_url ?? "") ||
    pauseUntil !== (p?.paused_until?.slice(0, 10) ?? "") ||
    pauseReason !== (p?.paused_reason ?? "") ||
    minAge !== (prefs.data?.min_age?.toString() ?? "") ||
    maxAge !== (prefs.data?.max_age?.toString() ?? "") ||
    prefGenders.join() !== (prefs.data?.genders ?? []).join() ||
    prefInstitutions.join() !== (prefs.data?.institutions ?? []).join() ||
    prefCities !== (prefs.data?.cities ?? []).join(", ") ||
    prefRelocations.join() !== (prefs.data?.relocations ?? []).join() ||
    prefShieldEmployer !== (prefs.data?.shield_employer ?? false);

  // `enableBeforeUnload` covers tab close/reload; `shouldBlockFn` covers
  // in-app navigation. Either alone would leave a gap.
  useBlocker({
    shouldBlockFn: () =>
      dirty && window.confirm("You have unsaved changes on this page. Leave without saving them?"),
    enableBeforeUnload: () => dirty,
  });

  // Access audit surfaces (visitor log is opt-in; the reveal log is always
  // available to the member whose coordinates were opened).
  const visitorLog = useVisitorLog(p?.show_profile_views === true);
  const contactLog = useContactAccessLog(p?.id);
  const names = useProfileNames([
    ...(visitorLog.data ?? []).map((v) => v.viewer_id),
    ...(contactLog.data ?? []).map((r) => r.viewer_id),
  ]);
  /**
   * First name + institution only: the audit log never needs a full record.
   * A failed name read must read differently from a name we simply do not have,
   * so a transient outage is not mistaken for an anonymous stranger.
   */
  const who = (id: string): string => {
    const row = names.data?.find((n) => n.id === id);
    if (!row) return names.isError ? "Identity unavailable" : "A member";
    const first = row.full_name?.split(" ")[0] || "Member";
    return row.institution ? `${first} · ${row.institution}` : first;
  };
  const saveViewPref = useMutation({
    mutationFn: async (next: boolean) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not-signed-in");
      const { error } = await supabase
        .from("profiles")
        .update({ show_profile_views: next })
        .eq("id", u.user.id);
      if (error) throw error;
      // View tracking itself is unaffected — this records the member's choice
      // about having the log shown back to them. The ledger result flows back to
      // onSuccess so a missing receipt is warned about, not swallowed.
      return recordConsent(
        "profile_views_display",
        next,
        next ? "Visitor log display enabled" : "Visitor log display disabled",
      );
    },
    onSuccess: (consent) => {
      qc.invalidateQueries({ queryKey: MY_PROFILE_KEY });
      qc.invalidateQueries({ queryKey: ["consent-events"] });
      if (consent.ok) toast.success("Visibility preference saved.");
      else toast.warning(CONSENT_RECEIPT_WARNING, { duration: 8000 });
    },
    onError: () => toast.error("Could not update the visitor log setting."),
  });

  const notifPrefs = useNotificationPreferences();
  const saveNotifPrefs = useSaveNotificationPreferences();

  // Photograph consent: incoming requests for the owner to allow or decline.
  const photoRequests = useIncomingPhotoRequests();
  const decidePhoto = useDecidePhotoRequest();

  const plans = usePlans();
  const subscription = useMySubscription();
  const checkout = useStartCheckout();
  const cancelSub = useCancelSubscription();

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

  const requestDeletion = useMutation({
    mutationFn: async () => {
      // Server-side: purges both storage buckets, then the profile row (which
      // cascades), then the auth user. A client can never do this alone.
      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { confirm: deleteConfirm },
      });
      if (error) throw error;
      const payload = data as { error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
    },
    onSuccess: async () => {
      await qc.cancelQueries();
      qc.clear();
      await supabase.auth.signOut();
      toast.success("Your account and uploaded documents have been deleted.");
      navigate({ to: "/", replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete the account."),
  });

  const save = useMutation({
    mutationFn: async (patch: Database["public"]["Tables"]["profiles"]["Update"]) => {
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

  const savePrefs = useMutation({
    mutationFn: async (patch: {
      min_age: number | null;
      max_age: number | null;
      genders: string[];
      institutions: string[];
      cities: string[];
      relocations: string[];
      shield_employer: boolean;
    }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not-signed-in");
      const { error } = await supabase
        .from("partner_preferences")
        .upsert({ user_id: u.user.id, ...patch }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner-preferences"] });
      toast.success("Partner preferences saved.");
    },
    onError: () => toast.error("Could not save your preferences. Please try again."),
  });

  function savePreferences() {
    const lo = minAge.trim() === "" ? null : Number(minAge);
    const hi = maxAge.trim() === "" ? null : Number(maxAge);
    if (lo !== null && (!Number.isInteger(lo) || lo < 21 || lo > 80)) {
      toast.error("Minimum age must be between 21 and 80.");
      return;
    }
    if (hi !== null && (!Number.isInteger(hi) || hi < 21 || hi > 80)) {
      toast.error("Maximum age must be between 21 and 80.");
      return;
    }
    if (lo !== null && hi !== null && lo > hi) {
      toast.error("Minimum age cannot be greater than maximum age.");
      return;
    }
    const cities = [
      ...new Set(
        prefCities
          .split(",")
          .map((c) => c.trim())
          .filter((c) => c.length > 0),
      ),
    ].slice(0, 20);
    savePrefs.mutate({
      min_age: lo,
      max_age: hi,
      genders: prefGenders.slice(0, 5),
      institutions: prefInstitutions.slice(0, 20),
      cities,
      relocations: prefRelocations.slice(0, 5),
      shield_employer: prefShieldEmployer,
    });
  }

  function clearPreferences() {
    setMinAge("");
    setMaxAge("");
    setPrefGenders([]);
    setPrefInstitutions([]);
    setPrefCities("");
    setPrefRelocations([]);
    savePrefs.mutate({
      min_age: null,
      max_age: null,
      genders: [],
      institutions: [],
      cities: [],
      relocations: [],
      // The shield is a privacy toggle rather than a matching criterion, so
      // "clear all" deliberately leaves it exactly as the member set it.
      shield_employer: prefShieldEmployer,
    });
  }

  const withdraw = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not-signed-in");
      const { error } = await supabase
        .from("profiles")
        .update({ is_visible: false })
        .eq("id", u.user.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: MY_PROFILE_KEY });
      toast.success("Your profile is withdrawn from discovery.");
      setWithdrawOpen(false);
    },
    onError: () => toast.error("Could not withdraw. Please try again."),
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
        Membership settings
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">Privacy & account</h1>
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
            {/* Weighted, same scorer as the dashboard. A count-based bar reaches
                100% on a photoless profile, which would be a false all-clear. */}
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
      </section>
      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Photograph gallery</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your portraits (up to 6). Reorder or set a primary photograph to appear in search
          and match cards.
        </p>
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
                    <span className="block font-medium">{who(r.requester_id)}</span>
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
                // Consent is recorded only once the write succeeds, so the
                // ledger never claims a disclosure that did not happen. A
                // missing receipt is warned about, never a rollback of the save.
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

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
          <SlidersHorizontal className="size-5 text-brass" /> Partner preferences
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          What you are looking for. These criteria are private to you — they are never shown to
          other members, and they only ever produce the alignment badges on your own search results.
          Leaving everything blank means no filtering, which is a perfectly respectable answer.
        </p>

        {/*
          Guard the whole editor. When this query fails, `prefs.data` is
          undefined, every field below renders as its blank default, and
          "Save preferences" would then write those blanks over the member's
          real stored row — silently erasing their criteria on a transient
          network error. Hiding the editor is the only safe option: we cannot
          distinguish "no preferences" from "preferences we failed to load".
        */}
        {prefs.isError ? (
          <p
            role="alert"
            className="mt-6 border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
          >
            Your partner preferences could not be loaded, so they are hidden rather than shown as
            empty — saving now would erase them.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void prefs.refetch()}
              disabled={prefs.isFetching}
            >
              {prefs.isFetching ? "Retrying…" : "Retry"}
            </button>
          </p>
        ) : prefs.isLoading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2" aria-busy="true">
            <span className="sr-only">Loading your partner preferences…</span>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full sm:col-span-2" />
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="pref-min-age">Minimum age</Label>
                <Input
                  id="pref-min-age"
                  inputMode="numeric"
                  placeholder="21"
                  value={minAge}
                  onChange={(e) => setMinAge(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pref-max-age">Maximum age</Label>
                <Input
                  id="pref-max-age"
                  inputMode="numeric"
                  placeholder="40"
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value)}
                />
              </div>
            </div>

            <fieldset className="mt-6">
              <legend className="text-sm font-semibold">Preferred gender</legend>
              <div className="mt-3 flex flex-wrap gap-4">
                {GENDERS.map((g) => (
                  <label key={g} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-6 accent-[var(--brass)]"
                      checked={prefGenders.includes(g)}
                      onChange={(e) =>
                        setPrefGenders((prev) =>
                          e.target.checked ? [...prev, g] : prev.filter((x) => x !== g),
                        )
                      }
                    />
                    {g}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-6">
              <legend className="text-sm font-semibold">Preferred relocation stance</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {RELOCATION.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-6 accent-[var(--brass)]"
                      checked={prefRelocations.includes(r)}
                      onChange={(e) =>
                        setPrefRelocations((prev) =>
                          e.target.checked ? [...prev, r] : prev.filter((x) => x !== r),
                        )
                      }
                    />
                    {r}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-6 grid gap-2">
              <Label htmlFor="pref-institutions">Preferred institutions (select any)</Label>
              <select
                id="pref-institutions"
                multiple
                size={6}
                className="w-full border border-input bg-background px-3 py-2 text-sm"
                value={prefInstitutions}
                onChange={(e) =>
                  setPrefInstitutions(Array.from(e.target.selectedOptions).map((o) => o.value))
                }
              >
                {INSTITUTIONS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal leading-5 text-muted-foreground">
                Hold ⌘/Ctrl to select more than one. Leave unselected to keep the whole directory
                open.
              </span>
            </div>

            <div className="mt-6 grid gap-2">
              <Label htmlFor="pref-cities">Preferred cities</Label>
              <Input
                id="pref-cities"
                placeholder="Mumbai, Bengaluru, London"
                value={prefCities}
                onChange={(e) => setPrefCities(e.target.value)}
              />
              <span className="text-xs font-normal leading-5 text-muted-foreground">
                Comma separated. Matched against the member&rsquo;s current city.
              </span>
            </div>

            <div className="mt-6 border-t border-border pt-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldAlert className="size-4 text-brass" /> Employer shield
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Hide profiles of members who currently work at the same organisation as you.
                    Applied server-side, so it also applies to counts and pagination.
                  </p>
                  {!p?.employer && (
                    <p className="mt-2 text-xs text-destructive">
                      Add your organisation under onboarding before this can take effect.
                    </p>
                  )}
                </div>
                <Switch
                  checked={prefShieldEmployer}
                  disabled={!p?.employer}
                  onCheckedChange={setPrefShieldEmployer}
                  aria-label="Employer shield"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                onClick={savePreferences}
                disabled={savePrefs.isPending}
                aria-busy={savePrefs.isPending}
              >
                {savePrefs.isPending ? "Saving…" : "Save preferences"}
              </Button>
              {clearOpen ? (
                <div
                  role="group"
                  aria-label="Confirm clearing partner preferences"
                  className="flex basis-full flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
                >
                  <p className="text-sm leading-6 text-destructive">
                    Clear every partner preference? Your age range, institutions, cities and
                    relocation choices will all be reset.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={savePrefs.isPending}
                    onClick={() => {
                      clearPreferences();
                      setClearOpen(false);
                    }}
                  >
                    {savePrefs.isPending ? "Clearing…" : "Yes, clear all"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setClearOpen(false)}>
                    Keep them
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => setClearOpen(true)}
                  disabled={savePrefs.isPending}
                >
                  Clear all
                </Button>
              )}
              {prefs.data && !hasAnyPreferences(prefs.data) && (
                <span className="text-sm text-muted-foreground">No criteria set yet.</span>
              )}
            </div>
          </>
        )}
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Session</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed in as {p?.full_name || "member"}. Sign out on shared devices.
        </p>
        <Button variant="outline" className="mt-5" onClick={signOut}>
          <LogOut /> Sign out
        </Button>
      </section>
      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
              <Eye className="size-5 text-brass" /> Access audit log
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Every profile view and every opening of your contact coordinates is recorded. Viewing
              is logged whether or not you choose to see it — the toggle only controls what is shown
              back to you.
            </p>
            {names.isError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                Some visitor names could not be loaded, so those rows read “Identity unavailable”.{" "}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={() => void names.refetch()}
                  disabled={names.isFetching}
                >
                  {names.isFetching ? "Retrying…" : "Retry"}
                </button>
              </p>
            )}
          </div>
          <label className="flex items-center gap-3 text-sm font-medium">
            <Switch
              checked={p?.show_profile_views === true}
              disabled={saveViewPref.isPending}
              onCheckedChange={(v) => saveViewPref.mutate(v)}
              aria-label="Show who viewed my profile"
            />
            Show visitors
          </label>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
              Profile visitors
            </p>
            <div className="mt-3 divide-y divide-border border border-border">
              {visitorLog.isLoading ? (
                <p className="p-3 text-xs text-muted-foreground">Loading…</p>
              ) : visitorLog.isError ? (
                <p role="alert" className="p-3 text-xs text-destructive">
                  Your visitor log could not be loaded. This is not the same as an empty log.{" "}
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2"
                    onClick={() => void visitorLog.refetch()}
                    disabled={visitorLog.isFetching}
                  >
                    {visitorLog.isFetching ? "Retrying…" : "Retry"}
                  </button>
                </p>
              ) : !visitorLog.data?.length ? (
                <p className="p-3 text-xs text-muted-foreground">
                  {p?.show_profile_views
                    ? "No visits recorded yet."
                    : "Turn on “Show visitors” to see this log."}
                </p>
              ) : (
                visitorLog.data.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {who(v.viewer_id)}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(v.viewed_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
              Contact coordinates opened
            </p>
            <div className="mt-3 divide-y divide-border border border-border">
              {contactLog.isLoading ? (
                <p className="p-3 text-xs text-muted-foreground">Loading…</p>
              ) : contactLog.isError ? (
                <p role="alert" className="p-3 text-xs text-destructive">
                  This log could not be loaded. This is not the same as nobody having looked.{" "}
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2"
                    onClick={() => void contactLog.refetch()}
                    disabled={contactLog.isFetching}
                  >
                    {contactLog.isFetching ? "Retrying…" : "Retry"}
                  </button>
                </p>
              ) : !contactLog.data?.length ? (
                <p className="p-3 text-xs text-muted-foreground">
                  Nobody has opened your contact details yet.
                </p>
              ) : (
                contactLog.data.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-col gap-1 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {who(r.viewer_id)}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {r.access_count} × · last{" "}
                      {new Date(r.last_revealed_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
          <Crown className="size-5 text-brass" /> Membership tier
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Introductions, messaging and one-to-one video calls are free and always will be. Paid
          membership buys the desk's time — curated shortlists and priority human replies — not a
          metered quota of introductions.
        </p>

        {subscription.isError ? (
          <p
            role="alert"
            className="mt-6 border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
          >
            Your membership could not be loaded, so your current tier is hidden rather than shown as
            the complimentary tier — we will not offer a member an upgrade they already hold.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void subscription.refetch()}
              disabled={subscription.isFetching}
            >
              {subscription.isFetching ? "Retrying…" : "Retry"}
            </button>
          </p>
        ) : subscription.isLoading ? (
          <div className="mt-6" aria-busy="true">
            <span className="sr-only">Loading your membership…</span>
            <Skeleton className="h-24 w-full" />
          </div>
        ) : subscription.data ? (
          <div className="mt-6 border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-semibold">
                  {plans.data?.find((pl) => pl.code === subscription.data?.plan_code)?.label ??
                    subscription.data.plan_code}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {subscription.data.requests_used > 0
                    ? `${subscription.data.requests_used} introduction${
                        subscription.data.requests_used === 1 ? "" : "s"
                      } sent this month.`
                    : "No introductions sent this month."}
                  {subscription.data.period_end
                    ? ` ${subscription.data.cancel_at_period_end ? "Expires" : "Renews"} ${new Date(
                        subscription.data.period_end,
                      ).toLocaleDateString("en-IN", {
                        dateStyle: "medium",
                      })}.`
                    : ""}
                </p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs capitalize text-muted-foreground">
                {subscription.data.cancel_at_period_end
                  ? "Cancelling at period end"
                  : subscription.data.status}
              </span>
            </div>
            {subscription.data.cancel_at_period_end ? (
              <div className="border-t border-border bg-secondary/30 p-4 text-xs text-muted-foreground">
                Cancellation scheduled. Your tier benefits remain active until the end of your
                current billing period.
              </div>
            ) : (
              <div className="border-t border-border p-4">
                {cancelConfirmOpen ? (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-destructive">
                      Cancel recurring membership?
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Your priority benefits will continue until the end of your billing cycle. You
                      will not be billed again, and your membership will smoothly revert to the
                      complimentary tier.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={cancelSub.isPending}
                        onClick={() => cancelSub.mutate()}
                      >
                        {cancelSub.isPending ? "Cancelling…" : "Confirm cancellation"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCancelConfirmOpen(false)}>
                        Keep subscription
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/30 text-destructive hover:bg-destructive/10"
                    onClick={() => setCancelConfirmOpen(true)}
                  >
                    Cancel recurring subscription
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {plans.data?.map((plan) => (
              <div key={plan.code} className="flex flex-col border border-border p-5">
                <p className="font-serif text-xl font-semibold">{plan.label}</p>
                <p className="mt-1 text-2xl font-semibold">{inr(plan.amount_paise)}</p>
                <p className="mt-1 text-xs text-muted-foreground">per month</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-sm text-muted-foreground">
                  <li>
                    {plan.intro_requests == null
                      ? "Introduction allowance set by the desk"
                      : `${plan.intro_requests} introduction requests each month`}
                  </li>
                  <li>
                    Reach is earned too: answering introductions you receive can raise your
                    effective allowance up to 1.5×; letting them lapse lowers it.
                  </li>
                  <li>Unlimited one-to-one video calls</li>
                  {plan.service_note && <li>{plan.service_note}</li>}
                </ul>
                {plan.sellable ? (
                  <Button
                    className="mt-5"
                    disabled={checkout.isPending}
                    onClick={() => checkout.mutate(plan.code)}
                  >
                    {checkout.isPending ? "Opening checkout…" : `Choose ${plan.label}`}
                  </Button>
                ) : (
                  <p className="mt-5 border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground">
                    No longer sold — existing members keep this tier.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

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

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
          <ScrollText className="size-5 text-brass" /> Consent & privacy ledger
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Under the Digital Personal Data Protection Act 2023, every consent you grant or revoke
          forms an immutable receipt. This record is private to you and the grievance desk.
        </p>

        <div className="mt-6 divide-y divide-border border border-border">
          {consentLog.isLoading ? (
            <div className="grid gap-2 p-4" aria-busy="true">
              <span className="sr-only">Loading consent trail…</span>
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ) : consentLog.isError ? (
            // Distinct from empty: a failed read is not proof that no consent
            // was ever recorded, and telling the member otherwise could lead
            // them to re-consent and create duplicate receipts.
            <p role="alert" className="p-4 text-sm leading-6 text-destructive">
              Your consent trail could not be loaded — this is not the same as having no entries.{" "}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => void consentLog.refetch()}
                disabled={consentLog.isFetching}
              >
                {consentLog.isFetching ? "Retrying…" : "Retry"}
              </button>
            </p>
          ) : !consentLog.data?.length ? (
            <p className="p-4 text-sm text-muted-foreground">
              No ledger entries yet. Actions like saving preferences or contact details write here.
            </p>
          ) : (
            consentLog.data.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {CONSENT_LABELS[c.purpose as ConsentPurpose] || c.purpose}
                  </p>
                  {c.note && (
                    <p className="break-words text-sm leading-5 text-muted-foreground">{c.note}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span
                    className={`font-semibold ${c.granted ? "text-success" : "text-destructive"}`}
                  >
                    {c.granted ? "Granted" : "Revoked"}
                  </span>
                  <span>v{c.policy_version}</span>
                  <span className="shrink-0">
                    {new Date(c.recorded_at).toLocaleDateString("en-IN", {
                      dateStyle: "medium",
                    })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-6 border border-destructive/40 bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold text-destructive">
          <Trash2 className="size-5" /> Delete account & erase all data
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Exercise your right to erasure (DPDP Act s.12). This permanently purges your profile,
          uploaded credentials, photographs, messages, introductions, and login credentials. This
          action is irreversible.
        </p>

        {deleteOpen ? (
          <div
            role="group"
            aria-label="Confirm permanent account deletion"
            className="mt-5 space-y-4 rounded-md border border-destructive/30 bg-destructive/5 p-4"
          >
            <p className="text-sm font-semibold uppercase tracking-wider text-destructive">
              Permanent Deletion Confirmation
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              To confirm, type <strong className="text-foreground">{DELETE_CONFIRMATION}</strong>{" "}
              below:
            </p>
            <Input
              id="delete-confirm"
              // The most destructive control in the app cannot rely on its
              // placeholder as a name — placeholders vanish on focus and are
              // not exposed as an accessible name.
              aria-label={`Type ${DELETE_CONFIRMATION} to confirm permanent deletion`}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={DELETE_CONFIRMATION}
              className="max-w-sm border-destructive/40 bg-background text-sm"
            />
            <div className="flex flex-wrap gap-3">
              <Button
                variant="destructive"
                disabled={deleteConfirm !== DELETE_CONFIRMATION || requestDeletion.isPending}
                onClick={() => requestDeletion.mutate()}
              >
                {requestDeletion.isPending ? "Erasing all data…" : "Permanently delete account"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirm("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="mt-5 border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => setDeleteOpen(true)}
          >
            Request complete erasure
          </Button>
        )}
      </section>

      <section className="mt-6 border border-destructive/40 bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
          <TriangleAlert className="size-5 text-destructive" /> Withdraw membership
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Withdrawing hides your profile from discovery immediately. Your account, verifications and
          introductions are retained so you can return. Contact the grievance desk for full
          deletion.
        </p>
        {withdrawOpen ? (
          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              variant="destructive"
              onClick={() => withdraw.mutate()}
              disabled={withdraw.isPending}
            >
              Confirm withdrawal
            </Button>
            <Button variant="ghost" onClick={() => setWithdrawOpen(false)}>
              Keep my profile
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="mt-5" onClick={() => setWithdrawOpen(true)}>
            Withdraw from discovery
          </Button>
        )}
      </section>
    </main>
  );
}
