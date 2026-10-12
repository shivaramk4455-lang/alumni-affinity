import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Clock,
  Mail,
  MessageSquare,
  Phone,
  ShieldX,
  Undo2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyProfile, useRevealedContacts } from "@/hooks/use-my-profile";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/connections")({
  head: () => ({
    meta: [
      { title: "Introductions — The Merit Circle" },
      {
        name: "description",
        content: "Review introductions you have received, sent and accepted.",
      },
      { property: "og:title", content: "Introductions — The Merit Circle" },
      { property: "og:description", content: "Private introductions, always candidate-led." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Connections,
});

type Tab = "received" | "sent" | "accepted" | "declined";

function Connections() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("received");
  /**
   * Decline, withdraw and block are terminal for an introduction and cannot be
   * undone from this screen, so they take a second explicit click. The same
   * two-step pattern `photo-gallery` uses for permanent deletion.
   */
  const [confirm, setConfirm] = useState<{ id: string; action: string } | null>(null);

  const me = useMyProfile();

  const list = useQuery({
    queryKey: ["interests"],
    queryFn: async () => {
      // Trigger quiet expiry, stale-call sweep and reminders on fresh access.
      // Both RPCs only ever move rows toward terminal states.
      void supabase.rpc("expire_stale_interests");
      void supabase.rpc("sweep_stale_calls");
      const { data, error } = await supabase
        .from("interests")
        .select("id, sender_id, recipient_id, status, message, expires_at, created_at, updated_at")
        .order("updated_at", { ascending: false })
        // Bounded: RLS already scopes to my rows, but history accumulates over
        // a member's lifetime — the tabs only ever render the 200 freshest.
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const ids = [...new Set((list.data ?? []).flatMap((i) => [i.sender_id, i.recipient_id]))];
  const people = useQuery({
    queryKey: ["interest-people", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, profession, institution, city")
        .in("id", ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  const myId = me.data?.id;
  const all = list.data ?? [];
  // Mutual send: both sides asked before either answered. The pair table is
  // direction-ordered, so (A->B) + (B->A) coexist as two pending rows. Consent
  // stays manual (no auto-accept — the accept is what unlocks contacts and
  // messaging), but each side sees "they're interested too" on their own row
  // instead of two parallel rows that look like a bug.
  const mutualPendingByPair = new Map<string, true>();
  for (const i of all) {
    if (i.status !== "pending") continue;
    const counterpart = all.find(
      (j) =>
        j.status === "pending" && j.sender_id === i.recipient_id && j.recipient_id === i.sender_id,
    );
    if (counterpart) mutualPendingByPair.set(i.id, true);
  }
  const received = all.filter((i) => i.recipient_id === myId && i.status === "pending");
  const sent = all.filter(
    (i) => i.sender_id === myId && i.status !== "accepted" && i.status !== "blocked",
  );
  const mutual = all.filter(
    (i) => i.status === "accepted" && (i.sender_id === myId || i.recipient_id === myId),
  );
  const mutualIds = all
    .filter((i) => i.status === "accepted" && (i.sender_id === myId || i.recipient_id === myId))
    .map((i) => (i.sender_id === myId ? i.recipient_id : i.sender_id));
  // Contact coordinates are revealed per accepted introduction only (RPC-enforced).
  const contacts = useRevealedContacts(mutualIds);
  const contactById = new Map((contacts.data ?? []).map((c) => [c.profile_id, c]));
  const person = (id: string) => (people.data ?? []).find((p) => p.id === id);
  // Declined and withdrawn sit in their own folder rather than hiding inside
  // Sent: the decision is the whole story of that row (who, what happened),
  // and a visible historical record is a trust signal for a directory asking
  // for money. Terminal by design — no actions live here.
  const declined = all.filter(
    (i) =>
      (i.status === "declined" || i.status === "withdrawn" || i.status === "expired") &&
      (i.sender_id === myId || i.recipient_id === myId),
  );
  const rows =
    tab === "received" ? received : tab === "sent" ? sent : tab === "accepted" ? mutual : declined;

  const act = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      // Counterparty inbox rows for accept/decline are written server-side by
      // the notify_interest_transition trigger — never from the browser — so
      // a forged "accepted" notice requires a real accepted interest.
      const { error } = await supabase.from("interests").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["interests"] });
      qc.invalidateQueries({ queryKey: ["contact"] });
      qc.invalidateQueries({ queryKey: ["revealed-contacts"] });
      toast.success("Updated.");
    },
    onError: () => {
      setConfirm(null);
      toast.error("Could not update. Please try again.");
    },
  });

  /**
   * Only the row actually being acted on should go busy. Disabling every
   * button made the whole page look frozen and hid which introduction the
   * click applied to.
   */
  const pendingId = act.isPending ? act.variables?.id : undefined;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "received", label: "Received", count: received.length },
    { key: "sent", label: "Sent", count: sent.length },
    { key: "accepted", label: "Accepted", count: mutual.length },
    { key: "declined", label: "Declined", count: declined.length },
  ];

  return (
    <main className="mx-auto max-w-4xl px-5 py-12 md:px-8 md:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
        Candidate-led
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">Introductions</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Only you can accept or decline. Family co-pilots may suggest, never act.
      </p>

      <div
        className="mt-8 grid grid-cols-2 border border-border p-1 sm:grid-cols-4"
        role="tablist"
        aria-label="Introduction folders"
      >
        {tabs.map((t) => (
          <Button
            key={t.key}
            role="tab"
            id={`connections-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="connections-panel"
            // Roving tabindex: the ARIA tabs pattern expects one stop in the
            // tab order, with arrow keys moving between tabs.
            tabIndex={tab === t.key ? 0 : -1}
            variant={tab === t.key ? "default" : "ghost"}
            size="sm"
            onKeyDown={(e) => {
              const order = tabs.map((x) => x.key);
              const at = order.indexOf(tab);
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next =
                  e.key === "ArrowRight"
                    ? order[(at + 1) % order.length]!
                    : order[(at - 1 + order.length) % order.length]!;
                setTab(next);
                document.getElementById(`connections-tab-${next}`)?.focus();
              } else if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                const next = e.key === "Home" ? order[0]! : order[order.length - 1]!;
                setTab(next);
                document.getElementById(`connections-tab-${next}`)?.focus();
              }
            }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count ? ` (${t.count})` : ""}
          </Button>
        ))}
      </div>

      <div
        className="mt-8 grid gap-4"
        id="connections-panel"
        role="tabpanel"
        aria-labelledby={`connections-tab-${tab}`}
        tabIndex={-1}
      >
        {people.isError && (
          <p
            role="alert"
            className="border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
          >
            Member names could not be loaded, so some rows read “Member”.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void people.refetch()}
              disabled={people.isFetching}
            >
              {people.isFetching ? "Retrying…" : "Retry"}
            </button>
          </p>
        )}
        {list.isLoading ? (
          // A skeleton keeps the list's shape: "nothing here yet" is a real
          // answer and must not be what a slow query looks like.
          <div className="grid gap-4" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading your introductions…</span>
            {[0, 1, 2].map((n) => (
              <div key={n} className="border border-border bg-card p-5 md:p-6">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="mt-3 h-4 w-72" />
                <Skeleton className="mt-2 h-4 w-40" />
                <div className="mt-5 flex gap-3">
                  <Skeleton className="h-9 w-28" />
                  <Skeleton className="h-9 w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : list.isError ? (
          // A failed read is not an empty inbox. Say so, and offer a retry.
          <div role="alert" className="border border-destructive/40 bg-destructive/5 p-6">
            <p className="flex items-center gap-2 font-serif text-xl">
              <AlertTriangle className="size-5 text-destructive" />
              Your introductions could not be loaded
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This is a connection problem on our side, not an empty folder. Nothing has been lost —
              your introductions are still on record.
            </p>
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => void list.refetch()}
              disabled={list.isFetching}
            >
              {list.isFetching ? "Retrying…" : "Try again"}
            </Button>
          </div>
        ) : !rows.length ? (
          <div className="border border-dashed border-border p-10 text-center">
            <p className="font-serif text-xl">Nothing here yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {tab === "received"
                ? "You will see interest from verified members here."
                : tab === "sent"
                  ? "Introductions you send will appear here."
                  : tab === "accepted"
                    ? "Accepted introductions unlock contact details."
                    : "Declined and withdrawn introductions stay on record here."}
            </p>
            <Button asChild variant="outline" className="mt-6">
              <Link to="/members">Search members</Link>
            </Button>
          </div>
        ) : (
          rows.map((i) => {
            const otherId = i.sender_id === myId ? i.recipient_id : i.sender_id;
            const o = person(otherId);
            return (
              <article key={i.id} className="border border-border bg-card p-5 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to="/members/$id"
                      params={{ id: otherId }}
                      className="font-serif text-xl font-semibold underline-offset-4 hover:underline"
                    >
                      {o?.full_name?.split(" ")[0] ?? "Member"}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {o?.profession}
                      {o?.institution ? ` · ${o.institution}` : ""}
                      {o?.city ? ` · ${o.city}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="border border-border px-2 py-0.5 text-xs font-semibold capitalize text-muted-foreground">
                      {i.status}
                    </span>
                    {mutualPendingByPair.get(i.id) && i.status === "pending" && (
                      <span className="border border-brass/50 bg-brass/5 px-2 py-0.5 text-xs font-semibold text-brass-strong">
                        They&rsquo;re interested too
                      </span>
                    )}
                    {i.status === "pending" && i.expires_at && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3 text-brass" />
                        {Math.max(
                          0,
                          Math.ceil(
                            (new Date(i.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                          ),
                        )}{" "}
                        days remaining
                      </span>
                    )}
                  </div>
                </div>
                {i.message && (
                  <p className="mt-4 border-l-2 border-brass bg-secondary/40 p-4 text-sm leading-6">
                    {i.message}
                  </p>
                )}

                {tab === "received" && (
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button
                      onClick={() => act.mutate({ id: i.id, status: "accepted" })}
                      disabled={pendingId === i.id}
                    >
                      <Check /> {pendingId === i.id ? "Working…" : "Accept"}
                    </Button>
                    {confirm && confirm.id === i.id && confirm.action === "declined" ? (
                      <div
                        role="group"
                        aria-label={`Confirm declining the introduction from ${o?.full_name ?? "this member"}`}
                        className="flex basis-full flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
                      >
                        <p className="text-sm leading-6 text-destructive">
                          Decline this introduction? They are notified, and you can send again
                          later.
                        </p>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => act.mutate({ id: i.id, status: "declined" })}
                          disabled={pendingId === i.id}
                        >
                          {pendingId === i.id ? "Declining…" : "Yes, decline"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => setConfirm({ id: i.id, action: "declined" })}
                        disabled={pendingId === i.id}
                      >
                        <X /> Decline
                      </Button>
                    )}
                  </div>
                )}
                {tab === "sent" && i.status === "pending" && (
                  <div className="mt-5">
                    {confirm && confirm.id === i.id && confirm.action === "withdrawn" ? (
                      <div
                        role="group"
                        aria-label="Confirm withdrawing this introduction"
                        className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
                      >
                        <p className="text-sm leading-6 text-destructive">
                          Withdraw this introduction? They will be told it was withdrawn.
                        </p>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => act.mutate({ id: i.id, status: "withdrawn" })}
                          disabled={pendingId === i.id}
                        >
                          {pendingId === i.id ? "Withdrawing…" : "Yes, withdraw"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => setConfirm({ id: i.id, action: "withdrawn" })}
                        disabled={pendingId === i.id}
                      >
                        <Undo2 /> {pendingId === i.id ? "Withdrawing…" : "Withdraw"}
                      </Button>
                    )}
                  </div>
                )}
                {tab === "sent" &&
                  (i.status === "declined" ||
                    i.status === "withdrawn" ||
                    i.status === "expired") && (
                    <Button
                      variant="outline"
                      className="mt-5"
                      onClick={() => act.mutate({ id: i.id, status: "pending" })}
                      disabled={pendingId === i.id}
                    >
                      {pendingId === i.id ? "Sending…" : "Send again"}
                    </Button>
                  )}
                {tab === "declined" && (
                  <p className="mt-5 text-sm leading-6 text-muted-foreground">
                    {i.status === "declined" &&
                      (i.sender_id === myId
                        ? "They passed on this introduction. The decision stands."
                        : "You declined this introduction. The decision stands.")}
                    {i.status === "withdrawn" &&
                      "This introduction was withdrawn before it was answered."}
                    {i.status === "expired" && "This introduction expired without an answer."}
                  </p>
                )}
                {tab === "accepted" && (
                  <div className="mt-5 space-y-3 border-t border-border pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {/* A LinkedIn URL is a long unbroken string and was the
                          clearest horizontal-overflow vector on this page. */}
                      {contacts.isError ? (
                        <div role="alert" className="grid gap-1 text-sm text-destructive">
                          <p className="font-semibold">Contact details could not be loaded</p>
                          <p className="text-xs leading-5">
                            This is not the same as “not shared”.{" "}
                            <button
                              type="button"
                              className="font-semibold underline underline-offset-2"
                              onClick={() => void contacts.refetch()}
                              disabled={contacts.isFetching}
                            >
                              {contacts.isFetching ? "Retrying…" : "Retry"}
                            </button>
                          </p>
                        </div>
                      ) : (
                        <div className="grid min-w-0 gap-1 text-sm">
                          <p className="flex min-w-0 items-center gap-2">
                            <Phone className="size-4 shrink-0 text-brass" />
                            <span className="min-w-0 break-all">
                              {contactById.get(otherId)?.contact_phone || "Phone not shared"}
                            </span>
                          </p>
                          <p className="flex min-w-0 items-center gap-2">
                            <Mail className="size-4 shrink-0 text-brass" />
                            <span className="min-w-0 break-all">
                              {contactById.get(otherId)?.linkedin_url || "LinkedIn not shared"}
                            </span>
                          </p>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        {confirm && confirm.id === i.id && confirm.action === "blocked" ? (
                          <div
                            role="group"
                            aria-label={`Confirm blocking ${o?.full_name ?? "this member"}`}
                            className="flex basis-full flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
                          >
                            <p className="text-sm leading-6 text-destructive">
                              Block {o?.full_name ?? "this member"}? This ends the introduction,
                              hides both profiles from each other, and cannot be undone here.
                            </p>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => act.mutate({ id: i.id, status: "blocked" })}
                              disabled={pendingId === i.id}
                            >
                              {pendingId === i.id ? "Blocking…" : "Yes, block"}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirm({ id: i.id, action: "blocked" })}
                            disabled={pendingId === i.id}
                          >
                            <ShieldX className="size-4" />
                            {pendingId === i.id ? "Blocking…" : "Block"}
                          </Button>
                        )}
                        <Button asChild size="sm">
                          <Link to="/messages/$interestId" params={{ interestId: i.id }}>
                            <MessageSquare className="size-4" /> Message
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </main>
  );
}
