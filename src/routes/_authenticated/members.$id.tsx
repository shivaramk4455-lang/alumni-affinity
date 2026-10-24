import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Check,
  Eye,
  EyeOff,
  Flag,
  Heart,
  Mail,
  MessageSquare,
  Phone,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MemberPhoto } from "@/components/member-photo";
import { useMyProfile } from "@/hooks/use-my-profile";
import { recordProfileView } from "@/lib/access-log";
import { supabase } from "@/integrations/supabase/client";
import { alignCandidate, EMPTY_PREFERENCES, type Alignment } from "@/lib/alignment";
import {
  BASE_DIRECTORY_COLUMNS,
  DIRECTORY_COLUMNS,
  type MemberDirectoryProfile,
} from "@/lib/profile-columns";
import { formatHeight } from "@/lib/profile-options";
import { computeGunaMilan, gunaVerdict } from "@/lib/guna-milan";
import { PhotoSlideshow } from "@/components/photo-gallery";
import { useMemberGallery } from "@/lib/gallery";
import { useMyPhotoRequest, useRequestPhoto } from "@/lib/photo-requests";
import { useDismissProfile } from "@/lib/dismissals";

export const Route = createFileRoute("/_authenticated/members/$id")({
  head: () => ({
    meta: [
      { title: "Member profile — The Merit Circle" },
      {
        name: "description",
        content: "A verified member profile, visible only to signed-in members.",
      },
      { property: "og:title", content: "Member profile — The Merit Circle" },
      { property: "og:description", content: "Private verified member profile." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MemberProfile,
});

function MemberProfile() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [openInterest, setOpenInterest] = useState(false);
  const [familyNote, setFamilyNote] = useState("");
  const [openSuggest, setOpenSuggest] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [openReport, setOpenReport] = useState(false);

  const me = useMyProfile();
  const matchSignals = useQuery({
    queryKey: ["member-match-signal", me.data?.id, id],
    enabled: !!me.data && me.data.id !== id && me.data.verification_status === "verified",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("directory_match_signals", {
        _candidate_ids: [id],
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  // The member's own partner preferences ("Looking for in a partner / Desired Partner Profile")
  const candidatePrefs = useQuery({
    queryKey: ["candidate-partner-preferences", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_profile_partner_preferences", {
        _profile: id,
      });
      if (error) return null;
      return data?.[0] ?? null;
    },
  });

  // Never request private columns directly: post-hardening they are revoked
  // from `authenticated`, and selecting them errors instead of leaking.
  const isViewingSelf = Boolean(me.data && me.data.id === id);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["member", id, isViewingSelf],
    initialData:
      me.data && me.data.id === id
        ? ({
            ...me.data,
            religion: me.data.religion ?? null,
            caste: me.data.caste ?? null,
            gotra: me.data.gotra ?? null,
          } as MemberDirectoryProfile)
        : undefined,
    queryFn: async (): Promise<MemberDirectoryProfile | null> => {
      // 1. If viewing own profile and me.data is available, immediately return it
      if (me.data && me.data.id === id) {
        return {
          ...me.data,
          religion: me.data.religion ?? null,
          caste: me.data.caste ?? null,
          gotra: me.data.gotra ?? null,
        } as MemberDirectoryProfile;
      }

      // Check if session user is the profile owner (handles initial direct load or refresh)
      const { data: sessionData } = await supabase.auth.getSession();
      const currentUserId = sessionData.session?.user?.id;
      if (currentUserId && currentUserId === id) {
        const { data: myData, error: myError } = await supabase
          .from("my_profile")
          .select("*")
          .maybeSingle();
        if (!myError && myData) {
          return {
            ...myData,
            religion: (myData as { religion?: string | null }).religion ?? null,
            caste: (myData as { caste?: string | null }).caste ?? null,
            gotra: (myData as { gotra?: string | null }).gotra ?? null,
          } as MemberDirectoryProfile;
        }
      }

      // 2. Query directory columns for another member
      const res = await supabase
        .from("profiles")
        .select(DIRECTORY_COLUMNS)
        .eq("id", id)
        .maybeSingle();

      if (!res.error && res.data) {
        return res.data as MemberDirectoryProfile;
      }

      // 3. Graceful fallback if unmigrated community columns caused failure
      if (res.error) {
        console.warn("Retrying profile query with BASE_DIRECTORY_COLUMNS:", res.error.message);
        const fallback = await supabase
          .from("profiles")
          .select(BASE_DIRECTORY_COLUMNS)
          .eq("id", id)
          .maybeSingle();

        if (!fallback.error && fallback.data) {
          return {
            ...fallback.data,
            religion: null,
            caste: null,
            gotra: null,
          } as MemberDirectoryProfile;
        }

        // If fallback also failed, and this is self, try me.data as infallible source
        if (me.data && me.data.id === id) {
          return {
            ...me.data,
            religion: me.data.religion ?? null,
            caste: me.data.caste ?? null,
            gotra: me.data.gotra ?? null,
          } as MemberDirectoryProfile;
        }

        if (fallback.error) {
          throw fallback.error;
        }
      }

      // If res.data is null, but this is self, return me.data if available
      if (me.data && me.data.id === id) {
        return {
          ...me.data,
          religion: me.data.religion ?? null,
          caste: me.data.caste ?? null,
          gotra: me.data.gotra ?? null,
        } as MemberDirectoryProfile;
      }

      return (res.data as MemberDirectoryProfile | null) ?? null;
    },
  });

  // Access audit: record that I opened this profile. Fire-and-forget, never
  // gates the view, and skips self-views entirely.
  useEffect(() => {
    if (data && me.data && me.data.id !== id) {
      void recordProfileView(id);
    }
  }, [data, me.data, id]);

  const interest = useQuery({
    queryKey: ["interest", id],
    enabled: !!me.data && me.data.id !== id,
    queryFn: async () => {
      // A reverse pair can exist: both sides sent before either answered, and
      // the (sender, recipient) unique index is direction-ordered, so it does
      // not prevent (A->B) + (B->A). Two rows broke the old maybeSingle (406),
      // which hid an ACCEPTED row behind an error — contact details and the
      // message link vanished while an accepted introduction existed.
      // Prefer the row that unlocks the most: accepted, then actionable (I am
      // the recipient), then newest. Whether a mutual send should auto-accept
      // is a product decision — this only degrades gracefully until it is made.
      const { data, error } = await supabase
        .from("interests")
        .select("id, sender_id, recipient_id, status, message")
        .or(
          `and(sender_id.eq.${me.data!.id},recipient_id.eq.${id}),and(sender_id.eq.${id},recipient_id.eq.${me.data!.id})`,
        )
        .order("updated_at", { ascending: false })
        .limit(2);
      if (error) throw error;
      const rows = data ?? [];
      const rank = (status: string, iAmRecipient: boolean) =>
        status === "blocked"
          ? -1
          : status === "accepted"
            ? 0
            : status === "pending" && iAmRecipient
              ? 1
              : status === "pending"
                ? 2
                : 3;
      return (
        rows
          .slice()
          .sort(
            (a, b) =>
              rank(a.status, a.recipient_id === me.data!.id) -
              rank(b.status, b.recipient_id === me.data!.id),
          )[0] ?? null
      );
    },
  });

  // Contact coordinates come from the desk-grade RPC, which only returns them
  // for a mutually accepted introduction.
  const accepted = interest.data?.status === "accepted";
  const contact = useQuery({
    queryKey: ["contact", id, interest.data?.status],
    enabled: !!me.data && accepted && me.data.id !== id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("reveal_contact", { _profile: id });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const myCopilotFor = useQuery({
    queryKey: ["copiloting"],
    enabled: !!me.data && me.data.id !== id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("copilots")
        // The name columns are needed to give each suggestion button a distinct
        // accessible name — with only ids, every button reads "Share suggestion".
        .select("id, candidate_id, copilot_name, copilot_email")
        .eq("copilot_user_id", me.data!.id)
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [slideIndex, setSlideIndex] = useState(0);
  const memberGallery = useMemberGallery(id, data?.photo_path);

  const send = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("interests")
        .insert({
          sender_id: me.data!.id,
          recipient_id: id,
          message: note.trim() || null,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      void data;

      // Server-composed via notify_counterparty (requires the pending row we
      // just created); the personalised opener stays in the interest itself.
      //
      // The notification is NOT part of the mutation's success condition. The
      // interest row is already committed by the time this runs, so throwing
      // here reported a committed introduction as a failure — the member was
      // told it had not been sent, and their retry then hit the unique pair
      // constraint and failed the same way, stranding the introduction with
      // both parties unable to see it. A failed alert is now logged, and the
      // member is told the introduction WAS sent.
      const { error: notifyError } = await supabase.rpc("notify_counterparty", {
        _user: id,
        _event: "interest_received",
      });
      if (notifyError) {
        console.error("members: interest alert failed:", notifyError.message);
        toast.error("Your introduction was sent, but the notification could not be delivered.");
      }
    },
    onSuccess: () => {
      setOpenInterest(false);
      setNote("");
      qc.invalidateQueries({ queryKey: ["interest", id] });
      toast.success("Interest sent.");
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("outstanding introductions")) {
        toast.error(
          "You have reached your limit of active introductions. Answering the ones you received raises this limit; withdrawing one frees a slot.",
        );
      } else if (msg.includes("Verification required before you may send")) {
        toast.error("Your verification must be complete before you may send introductions.");
      } else if (msg.includes("Monthly introduction allowance used")) {
        toast.error(
          "You have used this month's introduction allowance. Answering introductions raises it; otherwise it resets at the next billing period.",
        );
      } else {
        toast.error("Could not send interest. You may have already reached out.");
      }
    },
  });

  const suggest = useMutation({
    mutationFn: async (copilot: { id: string; candidate_id: string }) => {
      const { error } = await supabase.from("copilot_recommendations").insert({
        candidate_id: copilot.candidate_id,
        copilot_id: copilot.id,
        recommended_profile_id: id,
        family_note: familyNote.trim() || null,
      });
      if (error) throw error;
      // Server-composed via notify_counterparty (caller must be an active
      // co-pilot of this candidate); the private family note stays in the
      // recommendation row, never in the inbox copy.
      //
      // As with the interest above: the recommendation row is already
      // committed, so a failed alert must not be reported as a failed
      // suggestion.
      const { error: notifyError } = await supabase.rpc("notify_counterparty", {
        _user: copilot.candidate_id,
        _event: "suggestion_received",
      });
      if (notifyError) {
        console.error("members: suggestion alert failed:", notifyError.message);
        toast.error("Your suggestion was shared, but the notification could not be delivered.");
      }
    },
    onSuccess: () => {
      setOpenSuggest(false);
      setFamilyNote("");
      toast.success("Suggestion shared with your family member.");
    },
    onError: () => toast.error("Could not share this suggestion. It may already be on their list."),
  });

  /**
   * Private, one-way dismissal — deliberately NOT a report (desk alert) and NOT
   * a block (terminal, ends the introduction). Nothing reaches the other
   * member in either direction, and Settings undoes it.
   */
  const dismiss = useDismissProfile();

  const report = useMutation({
    mutationFn: async () => {
      const reason = reportReason.trim();
      if (reason.length < 10) throw new Error("Please describe the concern in a sentence or two.");
      const { error } = await supabase.from("reports").insert({
        reporter_id: me.data!.id,
        reported_profile_id: id,
        reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setOpenReport(false);
      setReportReason("");
      qc.invalidateQueries({ queryKey: ["my-reports"] });
      toast.success(
        "Reported. The membership desk will review, and this profile is hidden from your search.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not file the report."),
  });

  // Shortlist: a private tray of profiles to consider before reaching out.
  const saved = useQuery({
    queryKey: ["saved"],
    enabled: !!me.data,
    queryFn: async () => {
      // Bounded: RLS scopes this to the member's own shortlist, but it grows
      // over a lifetime.
      const { data, error } = await supabase.from("saved_profiles").select("profile_id").limit(500);
      if (error) throw error;
      return (data ?? []).map((r) => r.profile_id);
    },
  });
  const isSaved = (saved.data ?? []).includes(id);
  const toggleSave = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = next
        ? await supabase.from("saved_profiles").insert({ user_id: me.data!.id, profile_id: id })
        : await supabase.from("saved_profiles").delete().eq("profile_id", id);
      if (error) throw error;
    },
    onSuccess: (_result, next) => {
      qc.invalidateQueries({ queryKey: ["saved"] });
      toast.success(next ? "Saved to your shortlist." : "Removed from your shortlist.");
    },
    onError: () => toast.error("Could not update your shortlist."),
  });

  const canSeePhoto =
    data?.photo_visibility === "all_members" || (accepted && data?.photo_visibility !== "hidden");

  const myPrefs = useQuery({
    queryKey: ["partner-preferences"],
    enabled: !!me.data && me.data.id !== id,
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("partner_preferences")
        .select(
          "min_age, max_age, min_height_cm, max_height_cm, genders, marital_statuses, diets, religions, caste_preference, manglik_preference, institutions, cities, relocations, shield_employer",
        )
        .maybeSingle();
      if (error || !row) return { ...EMPTY_PREFERENCES };
      return {
        min_age: row.min_age,
        max_age: row.max_age,
        min_height_cm: row.min_height_cm,
        max_height_cm: row.max_height_cm,
        genders: row.genders ?? [],
        marital_statuses: row.marital_statuses ?? [],
        diets: row.diets ?? [],
        religions: row.religions ?? [],
        caste_preference: row.caste_preference ?? null,
        manglik_preference: row.manglik_preference ?? null,
        institutions: row.institutions ?? [],
        cities: row.cities ?? [],
        relocations: row.relocations ?? [],
        shield_employer: row.shield_employer ?? false,
      };
    },
  });

  const detailAlignment =
    data && me.data && me.data.id !== id
      ? alignCandidate(
          myPrefs.data ?? EMPTY_PREFERENCES,
          { city: me.data.city ?? null, institution: me.data.institution ?? null },
          data,
        )
      : { score: 0, badges: [], reasons: [] };

  const alignment: Alignment = {
    score: detailAlignment.score,
    reasons: detailAlignment.reasons,
    badges: [
      ...(matchSignals.data?.mutual_match
        ? [
            {
              label: "Mutual preference match",
              detail: "You both meet each other's stated preferences",
            },
          ]
        : []),
      ...(matchSignals.data?.matches_their_preferences && !matchSignals.data?.mutual_match
        ? [
            {
              label: "You fit what they're looking for",
              detail: "You meet this member's stated preferences",
            },
          ]
        : []),
      ...detailAlignment.badges,
    ],
  };
  const watermark = me.data?.full_name
    ? `${me.data.full_name} · ${me.data.id?.slice(0, 8)}`
    : "Verified member view";
  const copilotLinks = myCopilotFor.data ?? [];
  const galleryList = (memberGallery.data ?? []).map((p) => ({ path: p.path }));
  const visiblePhotos = canSeePhoto
    ? galleryList.length > 0
      ? galleryList
      : data?.photo_path
        ? [{ path: data.photo_path }]
        : []
    : [];

  const isSelf = me.data?.id === id;

  /**
   * Photograph consent flow. Only `accepted_only` is requestable: that is the
   * setting that means "wait until we are properly introduced". `hidden` means
   * nobody including matches, so offering a request there would quietly weaken
   * the strongest setting the product offers.
   */
  const photoRequestable =
    !isSelf && !!data?.photo_path && !canSeePhoto && data?.photo_visibility === "accepted_only";
  const myPhotoRequest = useMyPhotoRequest(photoRequestable ? id : null);
  const requestPhoto = useRequestPhoto();

  const cp = candidatePrefs.data;
  const hasCandidatePrefs = Boolean(
    cp &&
    (cp.min_age !== null ||
      cp.max_age !== null ||
      cp.min_height_cm !== null ||
      cp.max_height_cm !== null ||
      cp.genders.length ||
      cp.marital_statuses.length ||
      cp.diets.length ||
      cp.religions.length ||
      cp.institutions.length ||
      cp.cities.length ||
      cp.relocations.length ||
      cp.caste_preference ||
      (cp as { manglik_preference?: string | null }).manglik_preference),
  );
  const viewerMatchesCandidate = matchSignals.data?.matches_their_preferences === true;
  const mutualMatch = matchSignals.data?.mutual_match === true;

  const displayName = data
    ? isSelf
      ? data.full_name
      : (data.full_name?.split(" ")[0] ?? data.full_name)
    : "";
  const age = data?.birth_year ? new Date().getFullYear() - data.birth_year : null;
  const educationParts = [data?.degree, data?.institution].filter(Boolean).join(", ");
  const educationDisplay = educationParts
    ? data?.grad_year
      ? `${educationParts} (${data.grad_year})`
      : educationParts
    : data?.grad_year
      ? `Graduated ${data.grad_year}`
      : null;
  const subtitleParts = [data?.profession, data?.employer, data?.city].filter(Boolean);
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : null;

  // Horoscope: show this member's chart details, and — when both they and the
  // viewer have a birth star — a live Ashtakoota Guna Milan score. Computed
  // client-side from Nakshatra + Rashi (see src/lib/guna-milan.ts); nothing is
  // stored for the score. Returns null until both sides opt in, so a member who
  // never fills a horoscope never sees a misleading "0/36".
  const theirHoroscope = {
    rashi: data?.rashi ?? null,
    nakshatra: data?.nakshatra ?? null,
    manglik: data?.manglik ?? null,
  };
  const hasTheirHoroscope = Boolean(theirHoroscope.nakshatra || theirHoroscope.rashi);
  const myHoroscope = {
    rashi: me.data?.rashi ?? null,
    nakshatra: me.data?.nakshatra ?? null,
    manglik: me.data?.manglik ?? null,
  };
  const guna =
    !isSelf && hasTheirHoroscope && myHoroscope.nakshatra
      ? computeGunaMilan(myHoroscope, theirHoroscope)
      : null;
  const gunaBand = guna ? gunaVerdict(guna.total) : null;

  return (
    <main className="mx-auto max-w-4xl px-5 py-12 md:px-8 md:py-16">
      <Link
        to="/members"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to search
      </Link>
      {isLoading ? (
        // Skeleton in the profile's own shape: a slow read must not look like
        // "this profile is not available", which is a different, real answer.
        <div className="mt-8 border border-border bg-card p-6 md:p-10" aria-busy="true">
          <span className="sr-only">Loading this member profile…</span>
          <div className="flex flex-col md:flex-row items-stretch md:items-start gap-8 md:gap-10 lg:gap-12">
            <div className="w-full max-w-[280px] md:w-[280px] lg:w-[300px] shrink-0 mx-auto md:mx-0">
              <Skeleton className="aspect-[4/5] w-full rounded" />
            </div>
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="mt-3 h-9 w-60" />
              <Skeleton className="mt-2 h-4 w-48" />
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 border-t border-border/60 pt-5">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </div>
        </div>
      ) : isError ? (
        // The query failed. That is not the same as "no such member" — telling
        // someone a real profile does not exist because the network dropped is
        // a lie with real consequences in a directory like this.
        <div role="alert" className="mt-8 border border-destructive/40 bg-destructive/5 p-6">
          <p className="flex items-center gap-2 font-serif text-xl">
            <AlertTriangle className="size-5 text-destructive" />
            This profile could not be loaded
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your connection to the membership directory failed, so we cannot tell you whether this
            member exists. Nothing has been shared or changed by this attempt.
          </p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Retrying…" : "Try again"}
          </Button>
        </div>
      ) : !data ? (
        <div className="mt-8 border border-dashed border-border p-10 text-center">
          <p className="font-serif text-2xl">This profile is not available</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The member may have paused their profile, left the directory, or the link may be out of
            date. Try the{" "}
            <Link
              to="/members"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              member search
            </Link>{" "}
            instead.
          </p>
        </div>
      ) : (
        <article className="mt-8 border border-border bg-card p-6 md:p-10">
          {isSelf && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-brass/40 bg-brass/10 p-4">
              <div className="flex items-center gap-2.5">
                <Eye className="size-5 shrink-0 text-brass" />
                <div>
                  <p className="font-serif text-base font-semibold text-foreground">
                    Your Profile Preview
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This is how your profile and photographs appear to other verified members in the
                    directory.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/onboarding">Edit Details</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/verification" hash="photos">
                    Manage Photos
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/settings">Settings</Link>
                </Button>
              </div>
            </div>
          )}
          {memberGallery.isError && (
            <p
              role="alert"
              className="mb-5 border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
            >
              This member&rsquo;s gallery could not be loaded, so only the primary photograph is
              shown — this is not an empty gallery.{" "}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => void memberGallery.refetch()}
                disabled={memberGallery.isFetching}
              >
                {memberGallery.isFetching ? "Retrying…" : "Retry"}
              </button>
            </p>
          )}
          <div className="flex flex-col md:flex-row items-stretch md:items-start gap-8 md:gap-10 lg:gap-12">
            <div className="w-full max-w-[280px] md:w-[280px] lg:w-[300px] shrink-0 mx-auto md:mx-0">
              {visiblePhotos.length > 0 ? (
                <PhotoSlideshow
                  photos={visiblePhotos}
                  active={slideIndex}
                  onActive={setSlideIndex}
                  watermark={watermark}
                  name={data.full_name}
                />
              ) : (
                <div className="grid gap-3">
                  <MemberPhoto
                    path={null}
                    watermark={watermark}
                    name={data.full_name}
                    className="aspect-[4/5] w-full"
                  />
                  {photoRequestable && (
                    <div className="border border-border bg-secondary/40 p-3">
                      {myPhotoRequest.data?.status === "pending" ? (
                        <p className="text-xs leading-5 text-muted-foreground">
                          Photograph requested. You will see it here if they allow.
                        </p>
                      ) : myPhotoRequest.data?.status === "declined" ? (
                        <p className="text-xs leading-5 text-muted-foreground">
                          They chose not to share this photograph. You can ask once more later.
                        </p>
                      ) : (
                        <>
                          <p className="text-xs leading-5 text-muted-foreground">
                            They share their photograph only with members they choose.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 w-full"
                            disabled={requestPhoto.isPending || myPhotoRequest.isLoading}
                            onClick={() => requestPhoto.mutate(id)}
                          >
                            {requestPhoto.isPending ? "Sending…" : "Request photograph"}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  {!photoRequestable && data.photo_visibility === "hidden" && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      This member keeps their photograph private, including from matches. That
                      setting is not requestable.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-success">
                <ShieldCheck className="size-4 shrink-0" />
                {data.verification_status === "verified"
                  ? "Verified member"
                  : "Verification under way"}
              </div>
              <div className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
                <h1 className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
                  {displayName}
                </h1>
                {age !== null && (
                  <span className="font-serif text-2xl sm:text-3xl font-normal text-muted-foreground">
                    · {age} yrs
                  </span>
                )}
              </div>
              {subtitle && (
                <p className="mt-1.5 text-sm sm:text-base text-muted-foreground">{subtitle}</p>
              )}
              <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 border-t border-border/60 pt-5 text-sm">
                <Row k="Education" v={educationDisplay} />
                <Row k="City" v={data.city} />
                <Row k="Age" v={age !== null ? `${age} yrs` : null} />
                <Row k="Relocation" v={data.relocation} />
                {data.height_cm && <Row k="Height" v={formatHeight(data.height_cm)} />}
                {data.marital_status && <Row k="Marital status" v={data.marital_status} />}
                {data.diet && <Row k="Diet" v={data.diet} />}
                {data.mother_tongue && <Row k="Mother tongue" v={data.mother_tongue} />}
                {data.religion && <Row k="Religion" v={data.religion} />}
                {data.caste && <Row k="Caste / Community" v={data.caste} />}
                {data.gotra && <Row k="Gotra" v={data.gotra} />}
                {data.residency_status && <Row k="Residency" v={data.residency_status} />}
                {data.created_by && (
                  <Row
                    k="Profile created by"
                    v={data.created_by === "Self" ? "Self (Candidate)" : data.created_by}
                  />
                )}
              </dl>

              {alignment.badges.length > 0 && (
                <div className="mt-6 border-t border-border pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
                    Shared ground
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {alignment.badges.map((b) => (
                      <span
                        key={b.label}
                        title={b.detail}
                        className="border border-brass/50 bg-brass/5 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-brass-strong"
                      >
                        {b.label}
                        {b.detail && b.label !== "Age in range" ? ` · ${b.detail}` : ""}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Mutual matches reflect both members’ stated preferences. Only visible to you.
                  </p>
                </div>
              )}

              {hasTheirHoroscope && (
                <section className="mt-6 border-t border-border pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
                    Horoscope
                  </p>
                  <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
                    {data?.nakshatra && (
                      <Row
                        k="Birth star (Nakshatra)"
                        v={
                          data.nakshatra_pada
                            ? `${data.nakshatra} · Pada ${data.nakshatra_pada}`
                            : data.nakshatra
                        }
                      />
                    )}
                    {data?.rashi && <Row k="Moon sign (Rashi)" v={data.rashi} />}
                    {data?.manglik && <Row k="Manglik" v={data.manglik} />}
                    {data?.birth_time && <Row k="Time of birth" v={data.birth_time} />}
                    {data?.birth_place && <Row k="Place of birth" v={data.birth_place} />}
                  </dl>

                  {!isSelf && (
                    <div className="mt-4 border border-brass/40 bg-brass/5 p-4">
                      {guna && gunaBand ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="font-serif text-lg font-semibold">Guna Milan</p>
                            <span
                              className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold ${
                                gunaBand.tone === "excellent" || gunaBand.tone === "good"
                                  ? "border-success/40 bg-success/10 text-success"
                                  : gunaBand.tone === "fair"
                                    ? "border-brass/50 bg-brass/10 text-brass-strong"
                                    : "border-border bg-secondary/40 text-muted-foreground"
                              }`}
                            >
                              {gunaBand.label}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            <span className="font-serif text-2xl font-semibold text-foreground">
                              {guna.total}
                            </span>
                            <span className="text-muted-foreground"> / {guna.max} Ashtakoota</span>
                          </p>
                          <ul className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
                            {guna.kootas.map((k) => (
                              <li key={k.name} className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">{k.name}</span>
                                <span className="font-semibold tabular-nums">
                                  {k.score}/{k.max}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {guna.manglikDosha === "present" && (
                            <p className="mt-3 text-xs leading-5 text-destructive">
                              One of you is Manglik. Families often look for remedies or a Manglik
                              partner — please discuss this with the desk.
                            </p>
                          )}
                          {guna.manglikDosha === "cancelled" && (
                            <p className="mt-3 text-xs leading-5 text-muted-foreground">
                              Both of you are Manglik, so the dosha is traditionally considered
                              cancelled.
                            </p>
                          )}
                          <p className="mt-3 text-xs leading-5 text-muted-foreground">
                            Ashtakoota is guidance, not a verdict — only visible to you, and best
                            read alongside a jyotishi.
                          </p>
                        </>
                      ) : !myHoroscope.nakshatra ? (
                        <p className="text-sm leading-6 text-muted-foreground">
                          Add your own birth star in{" "}
                          <Link
                            to="/onboarding"
                            className="font-semibold text-brass underline underline-offset-2"
                          >
                            your profile
                          </Link>{" "}
                          to see a Guna Milan compatibility score with this member.
                        </p>
                      ) : null}
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>

          {(hasCandidatePrefs || data.values_statement) && (
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
                  {(cp.min_age !== null || cp.max_age !== null) && (
                    <Row
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
                  {(cp.min_height_cm !== null || cp.max_height_cm !== null) && (
                    <Row
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
                    <Row k="Marital status" v={cp.marital_statuses.join(", ")} />
                  )}
                  {cp.diets && cp.diets.length > 0 && (
                    <Row k="Dietary habit" v={cp.diets.join(", ")} />
                  )}
                  {cp.genders && cp.genders.length > 0 && (
                    <Row k="Preferred gender" v={cp.genders.join(", ")} />
                  )}
                  {cp.institutions && cp.institutions.length > 0 && (
                    <Row k="Education / Institutions" v={cp.institutions.join(", ")} />
                  )}
                  {cp.cities && cp.cities.length > 0 && (
                    <Row k="Preferred cities" v={cp.cities.join(", ")} />
                  )}
                  {cp.relocations && cp.relocations.length > 0 && (
                    <Row k="Relocation preference" v={cp.relocations.join(", ")} />
                  )}
                  {cp.religions && cp.religions.length > 0 && (
                    <Row k="Preferred religion" v={cp.religions.join(", ")} />
                  )}
                  {cp.caste_preference && <Row k="Community / Caste" v={cp.caste_preference} />}
                  {(cp as { manglik_preference?: string | null }).manglik_preference && (
                    <Row
                      k="Manglik preference"
                      v={(cp as { manglik_preference?: string | null }).manglik_preference ?? null}
                    />
                  )}
                </dl>
              )}

              {data.values_statement && (
                <div className="mt-5 border-l-2 border-brass/60 bg-secondary/30 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
                    In their own words
                  </p>
                  <p className="mt-2 text-sm leading-7">{data.values_statement}</p>
                </div>
              )}
            </section>
          )}
          {data.bio && (
            <section className="mt-8">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
                Introduction
              </h2>
              <p className="mt-3 leading-7">{data.bio}</p>
            </section>
          )}

          {accepted && (
            <section className="mt-8 border border-success/40 bg-success/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
                  <Check className="size-4 text-success" /> Introduction accepted
                </h2>
                {interest.data && (
                  <Button asChild size="sm">
                    <Link to="/messages/$interestId" params={{ interestId: interest.data.id }}>
                      <MessageSquare className="size-4" /> Message
                    </Link>
                  </Button>
                )}
              </div>
              {contact.isError ? (
                <p role="alert" className="mt-4 text-sm text-destructive">
                  Contact details could not be loaded — this is not the same as “not shared”.{" "}
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2"
                    onClick={() => void contact.refetch()}
                    disabled={contact.isFetching}
                  >
                    {contact.isFetching ? "Retrying…" : "Retry"}
                  </button>
                </p>
              ) : (
                <div className="mt-4 grid gap-2 text-sm">
                  <p className="flex items-center gap-2">
                    <Phone className="size-4 text-brass" />
                    {contact.data?.contact_phone || "Phone not shared"}
                  </p>
                  <p className="flex items-center gap-2">
                    <Mail className="size-4 text-brass" />
                    {contact.data?.linkedin_url || "LinkedIn not shared"}
                  </p>
                </div>
              )}
            </section>
          )}

          {!isSelf && (
            <section className="mt-8 border-t border-border pt-6">
              {/* Co-pilot mode notice */}
              {me.data?.verification_status !== "verified" && (
                <div className="mb-4 rounded border border-border bg-secondary/30 p-4 text-xs text-muted-foreground">
                  <p>
                    <strong>Co-pilot browsing mode.</strong> Expressing interest is reserved for
                    verified candidates. You can suggest this profile to your family member below.
                  </p>
                </div>
              )}

              {/* Status notice when interest already exists */}
              {interest.data && (
                <p className="mb-4 text-sm text-muted-foreground">
                  {interest.data.status === "pending" &&
                    interest.data.sender_id === me.data?.id &&
                    "Your interest is awaiting a reply."}
                  {interest.data.status === "pending" &&
                    interest.data.recipient_id === me.data?.id && (
                      <>
                        This member has expressed interest in you.{" "}
                        <Link
                          to="/connections"
                          className="font-semibold text-foreground underline underline-offset-4"
                        >
                          Reply in introductions
                        </Link>
                        .
                      </>
                    )}
                  {interest.data.status === "declined" && "This introduction was declined."}
                  {interest.data.status === "withdrawn" && "This interest was withdrawn."}
                  {interest.data.status === "accepted" && "Contact details are shown above."}
                  {interest.data.status === "blocked" && "This connection has ended."}
                </p>
              )}

              {/* Unified Ergonomic Action Toolbar */}
              <div className="flex flex-wrap items-center gap-3">
                {me.data?.verification_status === "verified" && !interest.data && (
                  <Button
                    size="lg"
                    onClick={() => {
                      setOpenInterest((v) => !v);
                      setOpenSuggest(false);
                      setOpenReport(false);
                    }}
                    aria-expanded={openInterest}
                    aria-controls="interest-note-panel"
                  >
                    <Heart /> Express interest
                  </Button>
                )}

                <Button
                  variant="outline"
                  size={
                    !interest.data && me.data?.verification_status === "verified" ? "lg" : "default"
                  }
                  disabled={toggleSave.isPending}
                  onClick={() => toggleSave.mutate(!isSaved)}
                  aria-pressed={isSaved}
                >
                  {isSaved ? (
                    <>
                      <BookmarkCheck /> Shortlisted
                    </>
                  ) : (
                    <>
                      <Bookmark /> Shortlist
                    </>
                  )}
                </Button>

                {copilotLinks.length > 0 && (
                  <Button
                    variant="outline"
                    size={
                      !interest.data && me.data?.verification_status === "verified"
                        ? "lg"
                        : "default"
                    }
                    onClick={() => {
                      setOpenSuggest((v) => !v);
                      setOpenInterest(false);
                      setOpenReport(false);
                    }}
                    aria-expanded={openSuggest}
                    aria-controls="family-note-panel"
                  >
                    <UsersRound /> Suggest to family
                  </Button>
                )}

                <Button
                  variant="outline"
                  size={
                    !interest.data && me.data?.verification_status === "verified" ? "lg" : "default"
                  }
                  disabled={dismiss.isPending}
                  onClick={() =>
                    dismiss.mutate(id, {
                      onSuccess: () => navigate({ to: "/members" }),
                    })
                  }
                  aria-label={`Hide ${data.full_name ?? "this member"} from your search`}
                >
                  <EyeOff className="size-4" />
                  {dismiss.isPending ? "Hiding…" : "Not for me"}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setOpenReport((v) => !v);
                    setOpenInterest(false);
                    setOpenSuggest(false);
                  }}
                  aria-expanded={openReport}
                  aria-controls="report-reason-panel"
                >
                  <Flag /> Report
                </Button>
              </div>

              {/* Action Form Panels */}
              {openInterest && !interest.data && (
                <div
                  id="interest-note-panel"
                  className="mt-4 grid gap-3 border border-border bg-secondary/15 p-4"
                >
                  <label htmlFor="interest-note" className="text-sm font-semibold">
                    A short note (optional)
                  </label>
                  <Textarea
                    id="interest-note"
                    rows={4}
                    maxLength={600}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Say something specific about why you are writing."
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={() => send.mutate()} disabled={send.isPending}>
                      {send.isPending ? "Sending…" : "Send interest"}
                    </Button>
                    <Button variant="ghost" onClick={() => setOpenInterest(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {openSuggest && copilotLinks.length > 0 && (
                <div
                  id="family-note-panel"
                  role="group"
                  aria-label="Suggest this profile to a family co-pilot"
                  className="mt-4 grid gap-3 border border-border bg-secondary/15 p-4"
                >
                  <label htmlFor="family-note" className="text-sm font-semibold">
                    Suggest to your family member
                  </label>
                  <Textarea
                    id="family-note"
                    rows={3}
                    maxLength={600}
                    value={familyNote}
                    onChange={(e) => setFamilyNote(e.target.value)}
                    placeholder="Why you think this profile is worth a look."
                  />
                  <div className="flex flex-wrap gap-3">
                    {copilotLinks.map((c) => (
                      <Button
                        key={c.id}
                        variant="outline"
                        onClick={() => suggest.mutate(c)}
                        disabled={suggest.isPending}
                        aria-label={`Share this suggestion with ${c.copilot_name || c.copilot_email || "your family member"}`}
                      >
                        Share with {c.copilot_name || c.copilot_email || "family"}
                      </Button>
                    ))}
                    <Button variant="ghost" onClick={() => setOpenSuggest(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {openReport && (
                <div
                  id="report-reason-panel"
                  role="group"
                  aria-label="Report this profile"
                  className="mt-4 grid gap-3 border border-border bg-secondary/15 p-4"
                >
                  <label htmlFor="report-reason" className="text-sm font-semibold">
                    Report this profile
                  </label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Tell the membership desk what felt wrong. Reports are private, and the profile
                    is hidden from your search immediately.
                  </p>
                  <Input
                    id="report-reason"
                    maxLength={300}
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    placeholder="A sentence or two about the concern"
                    aria-required="true"
                    aria-invalid={report.isError ? true : undefined}
                    aria-describedby="report-reason-hint"
                  />
                  <p id="report-reason-hint" className="sr-only">
                    At least ten characters.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="destructive"
                      onClick={() => report.mutate()}
                      disabled={report.isPending}
                    >
                      {report.isPending ? "Submitting…" : "Submit report"}
                    </Button>
                    <Button variant="ghost" onClick={() => setOpenReport(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </article>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{k}</dt>
      <dd className="mt-1 font-medium text-foreground break-words">{v || "—"}</dd>
    </div>
  );
}
