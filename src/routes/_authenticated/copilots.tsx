import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Share2, ShieldCheck, Trash2, UserRoundPlus, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyProfile } from "@/hooks/use-my-profile";
import { supabase } from "@/integrations/supabase/client";
import { RELATIONS } from "@/lib/profile-options";

export const Route = createFileRoute("/_authenticated/copilots")({
  head: () => ({
    meta: [
      { title: "Family co-pilots — The Merit Circle" },
      {
        name: "description",
        content: "Invite family to help you look, while every decision stays yours.",
      },
      { property: "og:title", content: "Family co-pilots — The Merit Circle" },
      { property: "og:description", content: "Family support with clear boundaries." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Copilots,
});

const selectCls = "h-10 w-full border border-input bg-background px-3 text-sm";

function WhatsAppIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.301-.15-1.78-.879-2.056-.98-.276-.1-.477-.15-.678.15-.2.301-.778.98-.954 1.18-.175.201-.351.226-.652.075-.301-.15-1.27-.468-2.42-1.493-.894-.798-1.498-1.784-1.674-2.085-.175-.301-.019-.464.132-.614.136-.134.301-.35.452-.526.15-.175.2-.3.301-.501.101-.201.05-.376-.025-.526-.075-.15-.678-1.634-.929-2.238-.244-.588-.493-.509-.678-.518-.175-.009-.376-.01-.577-.01-.201 0-.527.075-.803.376s-1.054 1.03-1.054 2.512c0 1.482 1.079 2.912 1.23 3.113.15.201 2.124 3.243 5.145 4.548.719.311 1.28.497 1.718.636.722.23 1.378.197 1.898.12.579-.087 1.78-.727 2.031-1.43.251-.703.251-1.305.176-1.43-.075-.126-.276-.201-.577-.351z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.176L2 22l4.981-1.408A9.957 9.957 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.2c-1.644 0-3.175-.487-4.46-1.328l-.32-.208-2.957.836.837-2.884-.216-.328A8.17 8.17 0 0 1 3.8 12c0-4.521 3.679-8.2 8.2-8.2 4.521 0 8.2 3.679 8.2 8.2 0 4.521-3.679 8.2-8.2 8.2z"
      />
    </svg>
  );
}

function Copilots() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState(RELATIONS[0]!);

  const me = useMyProfile();

  const links = useQuery({
    queryKey: ["copilots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("copilots")
        .select(
          "id, candidate_id, copilot_user_id, copilot_name, copilot_email, relation, status, invite_code, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const recs = useQuery({
    queryKey: ["recommendations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("copilot_recommendations")
        .select("id, candidate_id, copilot_id, recommended_profile_id, family_note, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const recIds = [...new Set((recs.data ?? []).map((r) => r.recommended_profile_id))];
  const recPeople = useQuery({
    queryKey: ["rec-people", recIds.join(",")],
    enabled: recIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, profession, institution, city")
        .in("id", recIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("copilots").insert({
        candidate_id: u.user!.id,
        copilot_email: email.trim().toLowerCase(),
        copilot_name: name.trim() || null,
        relation,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEmail("");
      setName("");
      qc.invalidateQueries({ queryKey: ["copilots"] });
      toast.success("Invitation created. Share the link with them.");
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : "";
      toast.error(
        message.includes("two active")
          ? "At most two active co-pilots — revoke one first."
          : "Could not create the invitation. This person may already be invited.",
      );
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("copilots").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["copilots"] });
      toast.success("Access updated.");
    },
    onError: () => toast.error("Could not update access."),
  });

  const removeRec = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("copilot_recommendations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      // Every sibling mutation toasts. Without one here the row simply
      // vanished with no confirmation that anything had happened.
      toast.success("Suggestion removed.");
    },
    // A failed delete was completely silent, so the row simply stayed put.
    onError: () => toast.error("Could not remove the suggestion. Please try again."),
  });

  const myId = me.data?.id;
  const mine = (links.data ?? []).filter((c) => c.candidate_id === myId);
  const copilotingFor = (links.data ?? []).filter(
    (c) => c.copilot_user_id === myId && c.status === "active",
  );
  // Show suggestions I received (as the candidate) *and* suggestions I wrote
  // (as an active co-pilot) — otherwise a co-pilot can create suggestions but
  // never see them again.
  const myCopilotIds = new Set(copilotingFor.map((c) => c.id));
  const myRecs = (recs.data ?? []).filter(
    (r) => r.candidate_id === myId || myCopilotIds.has(r.copilot_id),
  );
  const writesRecs = (r: { candidate_id: string; copilot_id: string }) =>
    r.candidate_id !== myId && myCopilotIds.has(r.copilot_id);

  function submitInvite() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      // Inline as well as a toast: the field kept no `aria-invalid`, so the
      // only signal was a message that disappeared.
      setEmailError("Enter a valid email address.");
      document.getElementById("copilot-email-error")?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
      return;
    }
    setEmailError(null);
    if (mine.filter((c) => c.status !== "revoked").length >= 2) {
      toast.error("At most two active co-pilots.");
      return;
    }
    invite.mutate();
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-12 md:px-8 md:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
        Candidate leads, family co-pilots
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">Family co-pilots</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        A co-pilot can look and suggest. They can never send interest, accept an introduction, or
        see contact details.
      </p>

      {copilotingFor.length > 0 && (
        <section className="mt-9 border-l-2 border-brass bg-secondary/40 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <UsersRound className="size-4 text-brass" /> You are a co-pilot for{" "}
            {copilotingFor.length === 1 ? "one member" : `${copilotingFor.length} members`}.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Open a member profile from search and choose “Suggest to family member”.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/members">Search members</Link>
          </Button>
        </section>
      )}

      <section className="mt-6 border border-border bg-card p-6 md:p-8">
        <h2 className="font-serif text-2xl font-semibold">Invite a co-pilot</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We save the invitation here. Ask them to sign in and open the link below — the invitation
          email arrives from your own message for now, so share the link directly.
        </p>
        {/* A real <form> so Enter in the email field submits. */}
        <form
          className="mt-5 grid gap-4 sm:grid-cols-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submitInvite();
          }}
        >
          <label className="grid gap-2 text-sm font-semibold">
            Email
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError(null);
              }}
              placeholder="name@example.com"
              inputMode="email"
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "copilot-email-error" : undefined}
            />
            {emailError && (
              <span
                id="copilot-email-error"
                role="alert"
                className="text-sm font-normal leading-6 text-destructive"
              >
                {emailError}
              </span>
            )}
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Name
            <Input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Relation
            <select
              className={selectCls}
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
            >
              {RELATIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={invite.isPending} aria-busy={invite.isPending}>
              <UserRoundPlus /> {invite.isPending ? "Creating…" : "Create invitation"}
            </Button>
          </div>
        </form>
      </section>

      <section className="mt-6 grid gap-4">
        <h2 className="font-serif text-2xl font-semibold">Your co-pilots</h2>
        {links.isLoading ? (
          <div className="grid gap-3" aria-busy="true">
            <span className="sr-only">Loading your co-pilots…</span>
            <Skeleton className="h-28 w-full" />
          </div>
        ) : links.isError ? (
          // Must be checked before the empty branch: a failed read told the
          // member they had no co-pilots when we simply could not see them.
          <p
            role="alert"
            className="border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
          >
            Your co-pilots could not be loaded.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void links.refetch()}
              disabled={links.isFetching}
            >
              {links.isFetching ? "Retrying…" : "Retry"}
            </button>
          </p>
        ) : !mine.length ? (
          <p className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No co-pilots yet. Many members invite one parent.
          </p>
        ) : (
          mine.map((c) => {
            const url = `${typeof window === "undefined" ? "" : window.location.origin}/copilot-invite/${c.invite_code}`;
            const candidateName = me.data?.full_name?.split(" ")[0] || "I";
            const whatsappText = encodeURIComponent(
              `Hi! ${candidateName} has invited you to be their family co-pilot on The Merit Circle (alumni matrimonial platform). Join privately here:\n${url}`,
            );
            const whatsappUrl = `https://wa.me/?text=${whatsappText}`;
            return (
              <article key={c.id} className="border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.copilot_name || c.copilot_email}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {c.relation} · {c.copilot_email}
                    </p>
                  </div>
                  <span
                    className={`border px-2 py-0.5 text-xs font-semibold capitalize ${c.status === "active" ? "border-success text-success" : "border-border text-muted-foreground"}`}
                  >
                    {c.status}
                  </span>
                </div>
                {c.status !== "revoked" && (
                  <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <code className="min-w-0 flex-1 truncate border border-border bg-secondary/40 px-3 py-2 font-mono text-xs">
                      {url}
                    </code>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#25D366] px-3 text-xs font-semibold text-white transition hover:bg-[#20ba59]"
                      >
                        <WhatsAppIcon className="size-3.5 fill-current" />
                        WhatsApp
                      </a>
                      {typeof navigator !== "undefined" && "share" in navigator && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void navigator
                              .share({
                                title: "The Merit Circle — Family Co-Pilot Invite",
                                text: `Hi! ${candidateName} has invited you to be their family co-pilot on The Merit Circle.`,
                                url,
                              })
                              .catch(() => {});
                          }}
                        >
                          <Share2 /> Share
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        // The promise is unawaited, so an insecure origin, a denied
                        // permission, or Safari's user-gesture rules all reported
                        // "copied" while nothing was copied — and this button is
                        // the whole point of the page.
                        onClick={() => {
                          navigator.clipboard
                            .writeText(url)
                            .then(() => toast.success("Invitation link copied."))
                            .catch(() =>
                              toast.error(
                                "Could not copy automatically — select the link and copy it.",
                              ),
                            );
                        }}
                      >
                        <Copy /> Copy
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setStatus.mutate({ id: c.id, status: "revoked" })}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-semibold">Suggestions</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Suggestions are private to you, your co-pilot and the candidate — nobody is notified until
          you act on one.
        </p>
        <div className="mt-5 grid gap-4">
          {!myRecs.length ? (
            // A dead end for the person most likely to land here empty — a
            // co-pilot with nothing suggested. Give them the route to fix it.
            <div className="border border-dashed border-border p-8 text-center">
              <p className="text-sm leading-6 text-muted-foreground">
                No suggestions yet. Open a member profile from search and choose{" "}
                <span className="font-medium text-foreground">Suggest to family member</span> to
                send one here.
              </p>
              <Button asChild variant="outline" className="mt-4">
                <Link to="/members">Search members</Link>
              </Button>
            </div>
          ) : (
            myRecs.map((r) => {
              const p = (recPeople.data ?? []).find((x) => x.id === r.recommended_profile_id);
              const authoredByMe = writesRecs(r);
              return (
                <article key={r.id} className="border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to="/members/$id"
                        params={{ id: r.recommended_profile_id }}
                        className="font-serif text-xl font-semibold underline-offset-4 hover:underline"
                      >
                        {p?.full_name?.split(" ")[0] ?? "Member"}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {p?.profession}
                        {p?.institution ? ` · ${p.institution}` : ""}
                        {p?.city ? ` · ${p.city}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRec.mutate(r.id)}
                      aria-label="Remove suggestion"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {r.family_note && (
                    <p className="mt-4 border-l-2 border-brass bg-secondary/40 p-4 text-sm leading-6">
                      {r.family_note}
                    </p>
                  )}
                  <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5 text-success" />
                    {authoredByMe
                      ? "You suggested this — the candidate decides whether to act."
                      : "You can express interest in this profile whenever you are ready."}
                  </p>
                </article>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
