import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, ArrowLeft, Flag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyProfile } from "@/hooks/use-my-profile";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/messages/")({
  head: () => ({
    meta: [
      { title: "Messages — The Merit Circle" },
      { name: "description", content: "Your private conversations." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MessagesInbox,
});

type Thread = {
  interestId: string;
  counterpartName: string | null;
  counterpartRole: string | null;
  /** null until someone has opened the conversation. */
  lastMessageAt: string | null;
  lastBody: string | null;
  unread: number;
};

function MessagesInbox() {
  const me = useMyProfile();
  const myId = me.data?.id ?? null;

  /**
   * Keyed on ACCEPTED introductions rather than conversation rows: a
   * conversation only exists after someone opens it, so listing the
   * `conversations` table would hide every thread nobody has entered yet.
   * Conversation and message state layer on best-effort, so a missing row
   * degrades to "no messages yet" instead of dropping the thread.
   */
  const threads = useQuery({
    queryKey: ["message-inbox", myId],
    enabled: !!myId,
    queryFn: async (): Promise<Thread[]> => {
      const { data: interests, error } = await supabase
        .from("interests")
        .select("id, sender_id, recipient_id, status, updated_at")
        .eq("status", "accepted")
        .or(`sender_id.eq.${myId},recipient_id.eq.${myId}`)
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const rows = interests ?? [];
      if (!rows.length) return [];

      const otherIds = rows.map((i) => (i.sender_id === myId ? i.recipient_id : i.sender_id));

      // Counterparty identity: a failure here must not lose the thread list.
      const people = new Map<string, { full_name: string | null; profession: string | null }>();
      try {
        const { data, error: pErr } = await supabase
          .from("profiles")
          .select("id, full_name, profession")
          .in("id", otherIds);
        if (pErr) throw pErr;
        for (const p of data ?? []) people.set(p.id, p);
      } catch {
        /* names unavailable: fall back to "Member" */
      }

      // Conversations that have already been opened.
      const convoByInterest = new Map<string, string>();
      try {
        const { data, error: cErr } = await supabase
          .from("conversations")
          .select("id, interest_id")
          .or(`participant_a.eq.${myId},participant_b.eq.${myId}`);
        if (cErr) throw cErr;
        for (const c of data ?? []) convoByInterest.set(c.interest_id, c.id);
      } catch {
        /* nothing opened yet */
      }

      // Last message + unread counts, one read across all conversation ids.
      const convoIds = [...convoByInterest.values()];
      const lastByConvo = new Map<string, { body: string; created_at: string }>();
      const unreadByConvo = new Map<string, number>();
      if (convoIds.length) {
        try {
          const { data: msgs, error: mErr } = await supabase
            .from("messages")
            .select("conversation_id, body, created_at, sender_id, read_at")
            .in("conversation_id", convoIds)
            .order("created_at", { ascending: false })
            .limit(300);
          if (mErr) throw mErr;
          for (const m of msgs ?? []) {
            if (!lastByConvo.has(m.conversation_id)) {
              lastByConvo.set(m.conversation_id, { body: m.body, created_at: m.created_at });
            }
            if (m.sender_id !== myId && !m.read_at) {
              unreadByConvo.set(m.conversation_id, (unreadByConvo.get(m.conversation_id) ?? 0) + 1);
            }
          }
        } catch {
          /* previews unavailable: threads still render */
        }
      }

      return rows.map((i) => {
        const otherId = i.sender_id === myId ? i.recipient_id : i.sender_id;
        const convoId = convoByInterest.get(i.id) ?? null;
        const last = convoId ? lastByConvo.get(convoId) : undefined;
        const person = people.get(otherId);
        return {
          interestId: i.id,
          counterpartName: person?.full_name ?? null,
          counterpartRole: person?.profession ?? null,
          lastMessageAt: last?.created_at ?? null,
          lastBody: last?.body ?? null,
          unread: convoId ? (unreadByConvo.get(convoId) ?? 0) : 0,
        };
      });
    },
  });

  if (me.isError) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">Messages could not load</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your profile could not be read, so the thread list is hidden rather than shown empty.
        </p>
        <Button className="mt-8" size="lg" onClick={() => void me.refetch()}>
          Try again
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-strong">
        Private messaging
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">Messages</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Conversations open only after you and the other member both accept an introduction. Each
        thread returns you to where you left off.
      </p>

      <div className="mt-8">
        {threads.isLoading || me.isLoading ? (
          <div className="grid gap-4" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading your conversations…</span>
            {[0, 1, 2].map((n) => (
              <div key={n} className="border border-border bg-card p-5">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="mt-3 h-4 w-full" />
                <Skeleton className="mt-2 h-3 w-24" />
              </div>
            ))}
          </div>
        ) : threads.isError ? (
          <div role="alert" className="border border-destructive/40 bg-destructive/5 p-6">
            <p className="flex items-center gap-2 font-serif text-xl">
              <Flag className="size-5 text-destructive" />
              Your conversations could not be loaded
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This is a connection problem, not an empty inbox — nothing has been deleted.
            </p>
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => void threads.refetch()}
              disabled={threads.isFetching}
            >
              {threads.isFetching ? "Retrying…" : "Try again"}
            </Button>
          </div>
        ) : (
          <InboxList threads={threads.data ?? []} />
        )}
      </div>
    </main>
  );
}

function InboxList({ threads }: { threads: Thread[] }) {
  if (!threads.length) {
    return (
      <div className="border border-dashed border-border p-10 text-center">
        <p className="font-serif text-xl">No conversations yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Messaging unlocks once an introduction is accepted by both sides.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/members">Find someone</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/connections">Review introductions</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ul className="grid gap-3">
      {threads.map((t) => {
        const name = t.counterpartName ?? "Member";
        const unreadLabel =
          t.unread > 0 ? `${t.unread} unread message${t.unread === 1 ? "" : "s"}` : undefined;
        return (
          <li key={t.interestId}>
            <Link
              to="/messages/$interestId"
              params={{ interestId: t.interestId }}
              aria-label={`Conversation with ${name}${unreadLabel ? `, ${unreadLabel}` : ""}`}
              className="flex items-start gap-3 border border-border bg-card p-5 transition-colors hover:border-brass hover:shadow-paper"
            >
              <span
                aria-hidden="true"
                className={`mt-1 grid size-2.5 shrink-0 rounded-full ${
                  t.unread > 0 ? "bg-brass" : "border border-border bg-transparent"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-serif text-lg font-semibold">{name}</span>
                  {t.lastMessageAt && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(t.lastMessageAt).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  )}
                </span>
                {t.counterpartRole && (
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                    {t.counterpartRole}
                  </span>
                )}
                <span
                  className={`mt-2 block truncate text-sm ${
                    t.unread > 0 ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t.lastBody ?? "No messages yet — open to say hello."}
                </span>
              </span>
              {t.unread > 0 && (
                <span className="ml-1 shrink-0 rounded-full bg-brass px-2 py-0.5 text-xs font-bold text-primary-foreground">
                  {t.unread}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
