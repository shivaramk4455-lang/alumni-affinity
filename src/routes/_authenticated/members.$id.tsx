import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Check,
  Flag,
  Heart,
  Mail,
  MessageSquare,
  Phone,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  // Never request private columns directly: post-hardening they are revoked
  // from `authenticated`, and selecting them errors instead of leaking.
  const { data, isLoading } = useQuery({
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
        .select("id, candidate_id")
        .eq("copilot_user_id", me.data!.id)
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [slideIndex, setSlideIndex] = useState(0);
  const memberGallery = useMemberGallery(id);

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
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : !data ? (
        <p className="mt-8 font-serif text-2xl">This profile is not available.</p>
      ) : (
        <article className="mt-8 border border-border bg-card p-6 md:p-10">
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
              <MemberPhoto
                path={null}
                watermark={watermark}
                name={data.full_name}
                className="aspect-[4/5] w-full"
              />
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
                        className="border border-brass/50 bg-brass/5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-brass-strong"
                      >
                        {b.label}
                        {b.detail && b.label !== "Age in range" ? ` · ${b.detail}` : ""}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Derived from your own criteria and only visible to you.
                  </p>
                </div>
              )}
            </div>
          </div>

          {data.values_statement && (
            <section className="mt-8 border-t border-border pt-6">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-brass-strong">
                In a partnership
              </h2>
              <p className="mt-3 leading-7">{data.values_statement}</p>
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
            </section>
          )}

          {!isSelf && (
            <section className="mt-8 grid gap-4 border-t border-border pt-6">
              {me.data?.verification_status === "verified" ? (
                !interest.data ? (
                  openInterest ? (
                    <div className="grid gap-3">
                      <label className="text-sm font-semibold">A short note (optional)</label>
                      <Textarea
                        rows={4}
                        maxLength={600}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Say something specific about why you are writing."
                      />
                      <div className="flex flex-wrap gap-3">
                        <Button onClick={() => send.mutate()} disabled={send.isPending}>
                          Send interest
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
                  <div className="grid gap-3 border border-border p-4">
                    <p className="text-sm font-semibold">Suggest to your family member</p>
                    <Textarea
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
                  >
                    <UsersRound /> Suggest to family member
                  </Button>
                ))}

              <Button
                variant="outline"
                className="justify-self-start"
                disabled={toggleSave.isPending}
                onClick={() => toggleSave.mutate(!isSaved)}
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
                <div className="grid gap-3 border border-border p-4">
                  <p className="text-sm font-semibold">Report this profile</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Tell the membership desk what felt wrong. Reports are private, and the profile
                    is hidden from your search immediately.
                  </p>
                  <Input
                    maxLength={300}
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    placeholder="A sentence or two about the concern"
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="destructive"
                      onClick={() => report.mutate()}
                      disabled={report.isPending}
                    >
                      Submit report
                    </Button>
                    <Button variant="ghost" onClick={() => setOpenReport(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-self-start text-muted-foreground"
                  onClick={() => setOpenReport(true)}
                >
                  <Flag /> Report profile
                </Button>
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
