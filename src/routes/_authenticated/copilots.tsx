import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, ShieldCheck, Trash2, UserRoundPlus, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function Copilots() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
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
        .order("created_at", { ascending: false });
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
        .order("created_at", { ascending: false });
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
    },
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
      toast.error("Enter a valid email address.");
      return;
    }
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
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <label className="grid gap-2 text-sm font-semibold">
            Email
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              inputMode="email"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
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
        </div>
        <Button className="mt-5" onClick={submitInvite} disabled={invite.isPending}>
          <UserRoundPlus /> Create invitation
        </Button>
      </section>

      <section className="mt-6 grid gap-4">
        <h2 className="font-serif text-2xl font-semibold">Your co-pilots</h2>
        {links.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !mine.length ? (
          <p className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No co-pilots yet. Many members invite one parent.
          </p>
        ) : (
          mine.map((c) => {
            const url = `${typeof window === "undefined" ? "" : window.location.origin}/copilot-invite/${c.invite_code}`;
            return (
              <article key={c.id} className="border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{c.copilot_name || c.copilot_email}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
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
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                    <code className="truncate border border-border bg-secondary/40 px-3 py-2 text-xs">
                      {url}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        toast.success("Invitation link copied.");
                      }}
                    >
                      <Copy /> Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStatus.mutate({ id: c.id, status: "revoked" })}
                    >
                      Revoke
                    </Button>
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
            <p className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No suggestions yet.
            </p>
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
