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
import { EMPTY_PREFERENCES, alignCandidate, type Alignment } from "@/lib/alignment";
import { DIRECTORY_COLUMNS } from "@/lib/profile-columns";
import { formatHeight } from "@/lib/profile-options";
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

  // The viewer's own criteria (private) — used only to render "shared ground".
  const myPrefs = useQuery({
    queryKey: ["partner-preferences"],
    enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_preferences")
        .select(
          "min_age, max_age, min_height_cm, max_height_cm, genders, marital_statuses, diets, religions, caste_preference, institutions, cities, relocations, shield_employer",
        )
        .maybeSingle();
      if (error) throw error;
      if (!data) return { ...EMPTY_PREFERENCES };
      return {
        min_age: data.min_age,
        max_age: data.max_age,
        min_height_cm: data.min_height_cm,
        max_height_cm: data.max_height_cm,
        genders: data.genders ?? [],
        marital_statuses: data.marital_statuses ?? [],
        diets: data.diets ?? [],
        religions: data.religions ?? [],
        caste_preference: data.caste_preference ?? null,
        institutions: data.institutions ?? [],
        cities: data.cities ?? [],
        relocations: data.relocations ?? [],
        shield_employer: data.shield_employer ?? false,
      };
    },
  });

  // The member's own partner preferences ("Looking for in a partner / Desired Partner Profile")
  const candidatePrefs = useQuery({
    queryKey: ["candidate-partner-preferences", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_preferences")
        .select(
          "min_age, max_age, min_height_cm, max_height_cm, genders, marital_statuses, diets, religions, caste_preference, institutions, cities, relocations",
        )
        .eq("user_id", id)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });

  // Never request private columns directly: post-hardening they are revoked
  // from `authenticated`, and selecting them errors instead of leaking.
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["member", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(DIRECTORY_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
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
    enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interests")
        .select("id, sender_id, recipient_id, status, message")
        .or(
          `and(sender_id.eq.${me.data!.id},recipient_id.eq.${id}),and(sender_id.eq.${id},recipient_id.eq.${me.data!.id})`,
        )
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Contact coordinates come from the desk-grade RPC, which only returns them
  // for a mutually accepted introduction.
  const accepted = interest.data?.status === "accepted";
  const contact = useQuery({
    queryKey: ["contact", id, interest.data?.status],
    enabled: !!me.data && accepted,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("reveal_contact", { _profile: id });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const myCopilotFor = useQuery({
    queryKey: ["copiloting"],
    enabled: !!me.data,
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
      const { error: notifyError } = await supabase.rpc("notify_counterparty", {
        _user: id,
        _event: "interest_received",
      });
      if (notifyError) throw notifyError;
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
      const { error: notifyError } = await supabase.rpc("notify_counterparty", {
        _user: copilot.candidate_id,
        _event: "suggestion_received",
      });
      if (notifyError) throw notifyError;
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
      const { data, error } = await supabase.from("saved_profiles").select("profile_id");
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

  // "Shared ground" is computed from the viewer's own criteria against the
  // directory-visible projection of this member. Nothing is stored server-side.
  const alignment: Alignment = data
    ? alignCandidate(
        myPrefs.data ?? EMPTY_PREFERENCES,
        { city: me.data?.city ?? null, institution: me.data?.institution ?? null },
        data,
      )
    : { score: 0, badges: [], reasons: [] };
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
      (cp.genders && cp.genders.length > 0) ||
      (cp.marital_statuses && cp.marital_statuses.length > 0) ||
      (cp.diets && cp.diets.length > 0) ||
      (cp.institutions && cp.institutions.length > 0) ||
      (cp.cities && cp.cities.length > 0) ||
      (cp.relocations && cp.relocations.length > 0) ||
      Boolean(cp.caste_preference)),
  );

  const viewerMatchesCandidate = useMemo(() => {
    if (!hasCandidatePrefs || !cp || !me.data) return false;
    const currentYear = new Date().getFullYear();
    const myAge = me.data.birth_year ? currentYear - me.data.birth_year : null;
    let matchCount = 0;

    if (myAge !== null && (cp.min_age !== null || cp.max_age !== null)) {
      const minA = cp.min_age ?? 0;
      const maxA = cp.max_age ?? 120;
      if (myAge < minA || myAge > maxA) return false;
      matchCount++;
    }

    if (me.data.height_cm && (cp.min_height_cm !== null || cp.max_height_cm !== null)) {
      const minH = cp.min_height_cm ?? 0;
      const maxH = cp.max_height_cm ?? 300;
      if (me.data.height_cm < minH || me.data.height_cm > maxH) return false;
      matchCount++;
    }

    if (me.data.gender && cp.genders && cp.genders.length > 0) {
      if (!cp.genders.includes(me.data.gender)) return false;
      matchCount++;
    }

    if (me.data.diet && cp.diets && cp.diets.length > 0) {
      if (cp.diets.includes(me.data.diet)) matchCount++;
    }

    if (me.data.marital_status && cp.marital_statuses && cp.marital_statuses.length > 0) {
      if (cp.marital_statuses.includes(me.data.marital_status)) matchCount++;
    }

    if (me.data.institution && cp.institutions && cp.institutions.length > 0) {
      if (cp.institutions.includes(me.data.institution)) matchCount++;
    }

    if (me.data.city && cp.cities && cp.cities.length > 0) {
      if (cp.cities.includes(me.data.city)) matchCount++;
    }

    return matchCount > 0;
  }, [hasCandidatePrefs, cp, me.data]);

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
          <div className="grid gap-8 sm:grid-cols-[240px_1fr]">
            <Skeleton className="aspect-[4/5] w-full" />
            <div className="min-w-0">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-3 h-9 w-56" />
              <Skeleton className="mt-3 h-4 w-64" />
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
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
          <div className="grid gap-8 sm:grid-cols-[240px_1fr]">
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
                    This member keeps their photograph private, including from matches. That setting
                    is not requestable.
                  </p>
                )}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-success">
                <ShieldCheck className="size-4" />
                {data.verification_status === "verified"
                  ? "Verified member"
                  : "Verification under way"}
              </div>
              <h1 className="mt-3 font-serif text-4xl font-semibold">
                {data.full_name?.split(" ")[0]}
              </h1>
              <p className="mt-2 text-muted-foreground">
                {data.profession}
                {data.employer ? ` · ${data.employer}` : ""}
              </p>
              <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
                <Row
                  k="Education"
                  v={`${data.degree ?? ""}, ${data.institution ?? ""} (${data.grad_year ?? ""})`}
                />
                <Row k="City" v={data.city} />
                <Row
                  k="Age"
                  v={data.birth_year ? String(new Date().getFullYear() - data.birth_year) : null}
                />
                <Row k="Relocation" v={data.relocation} />
                {data.height_cm && <Row k="Height" v={formatHeight(data.height_cm)} />}
                {data.marital_status && <Row k="Marital status" v={data.marital_status} />}
                {data.diet && <Row k="Diet" v={data.diet} />}
                {data.mother_tongue && <Row k="Mother tongue" v={data.mother_tongue} />}
                {data.religion && <Row k="Religion" v={data.religion} />}
                {data.caste && <Row k="Caste / Community" v={data.caste} />}
                {data.gotra && <Row k="Gotra" v={data.gotra} />}
                {data.residency_status && <Row k="Residency" v={data.residency_status} />}
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
                    Derived from your own criteria and only visible to you.
                  </p>
                </div>
              )}
            </div>
          </div>

          {(hasCandidatePrefs || data.values_statement) && (
            <section className="mt-8 border-t border-border pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
                  <SlidersHorizontal className="size-5 text-brass" /> Looking for in a partner
                </h2>
                {viewerMatchesCandidate && !isSelf && (
                  <span className="inline-flex items-center gap-1.5 border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                    <Check className="size-3.5" /> You match their preferences
                  </span>
                )}
              </div>

              {hasCandidatePrefs && cp && (
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
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
                  {cp.caste_preference && <Row k="Community / Caste" v={cp.caste_preference} />}
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
            <section className="mt-8 grid gap-4 border-t border-border pt-6">
              {me.data?.verification_status === "verified" ? (
                !interest.data ? (
                  openInterest ? (
                    <div className="grid gap-3">
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
                  ) : (
                    <Button
                      size="lg"
                      className="justify-self-start"
                      onClick={() => setOpenInterest(true)}
                      aria-expanded={openInterest}
                      aria-controls="interest-note-panel"
                    >
                      <Heart /> Express interest
                    </Button>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">
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
                  </p>
                )
              ) : (
                <div className="rounded border border-border bg-secondary/30 p-4 text-xs text-muted-foreground">
                  <p>
                    <strong>Co-pilot browsing mode.</strong> Expressing interest is reserved for
                    verified candidates. You can suggest this profile to your family member below.
                  </p>
                </div>
              )}

              {copilotLinks.length > 0 &&
                (openSuggest ? (
                  <div
                    role="group"
                    aria-label="Suggest this profile to a family co-pilot"
                    className="grid gap-3 border border-border p-4"
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
                      placeholder="Why you think this is worth a look."
                    />
                    <div className="flex flex-wrap gap-3">
                      {copilotLinks.map((c) => (
                        <Button
                          key={c.id}
                          variant="outline"
                          onClick={() => suggest.mutate(c)}
                          disabled={suggest.isPending}
                          // Every row rendered an identical "Share suggestion"
                          // label, so with two co-pilots a screen-reader user
                          // heard the same button twice and could not tell
                          // which family member each one belonged to.
                          aria-label={`Share this suggestion with ${c.copilot_name || c.copilot_email || "your family member"}`}
                        >
                          Share suggestion
                        </Button>
                      ))}
                      <Button variant="ghost" onClick={() => setOpenSuggest(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="justify-self-start"
                    onClick={() => setOpenSuggest(true)}
                    aria-expanded={openSuggest}
                    aria-controls="family-note"
                  >
                    <UsersRound /> Suggest to family member
                  </Button>
                ))}

              <Button
                variant="outline"
                className="justify-self-start"
                disabled={toggleSave.isPending}
                onClick={() => toggleSave.mutate(!isSaved)}
                // Expose the toggle state programmatically, not just via the
                // icon and text swap.
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

              {openReport ? (
                <div
                  role="group"
                  aria-label="Report this profile"
                  className="grid gap-3 border border-border p-4"
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
                    // The report reason is required by the mutation (10 chars
                    // minimum), so surface that before the click fails.
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
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
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
                    className="text-muted-foreground"
                    onClick={() => setOpenReport(true)}
                    aria-expanded={openReport}
                    aria-controls="report-reason"
                  >
                    <Flag /> Report profile
                  </Button>
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
    <div>
      <dt className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{k}</dt>
      <dd className="mt-1">{v || "—"}</dd>
    </div>
  );
}
