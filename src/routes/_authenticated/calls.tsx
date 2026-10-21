import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { MessageSquare, PhoneCall, PhoneMissed, PhoneIncoming, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyProfile } from "@/hooks/use-my-profile";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({
    meta: [
      { title: "Calls — The Merit Circle" },
      { name: "description", content: "Your recent video introductions." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CallsPage,
});

type CallRow = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  status: string;
  decline_reason: string | null;
  answered_at: string | null;
  ended_at: string | null;
  started_at: string;
};

type CallEntry = CallRow & {
  otherId: string;
  name: string;
  role: string;
  outcome: "connected" | "missed" | "declined" | "ringing";
  /** Needed to reply by message; null if the conversation row is missing. */
  interestId: string | null;
  out: boolean;
};

const OUTCOME_COPY: Record<CallEntry["outcome"], string> = {
  connected: "Connected",
  missed: "Missed",
  declined: "Declined",
  ringing: "Still ringing",
};

function duration(c: CallEntry): string {
  if (!c.answered_at || !c.ended_at) return "";
  const secs = Math.max(0, Math.floor((Date.parse(c.ended_at) - Date.parse(c.answered_at)) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function CallsPage() {
  const me = useMyProfile();
  const navigate = useNavigate();
  const myId = me.data?.id ?? null;
  const [dialing, setDialing] = useState<string | null>(null);

  /**
   * History is keyed on the caller's own rows rather than conversations, so a
   * conversation nobody opened still appears. Counterpart names and the
   * out/missed classification degrade rather than hide the row.
   */
  const calls = useQuery({
    queryKey: ["call-history", myId],
    enabled: !!myId,
    queryFn: async (): Promise<CallEntry[]> => {
      const { data, error } = await supabase
        .from("calls")
        .select(
          "id, conversation_id, caller_id, callee_id, status, decline_reason, answered_at, ended_at, started_at",
        )
        .or(`caller_id.eq.${myId},callee_id.eq.${myId}`)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []) as CallRow[];
      if (!rows.length) return [];

      const otherIds = rows.map((r) => (r.caller_id === myId ? r.callee_id : r.caller_id));
      const people = new Map<string, { full_name: string | null; profession: string | null }>();
      try {
        const { data: p, error: pErr } = await supabase
          .from("profiles")
          .select("id, full_name, profession")
          .in("id", otherIds);
        if (pErr) throw pErr;
        for (const x of p ?? []) people.set(x.id, x);
      } catch {
        /* names unavailable: fall back to "Member" */
      }

      // Conversation -> interest, so a call can be replied to by message.
      // The messages route is keyed on the interest, not the conversation.
      const convoIds = rows.map((r) => r.conversation_id);
      const interestByConvo = new Map<string, string>();
      try {
        const { data: convos, error: cErr } = await supabase
          .from("conversations")
          .select("id, interest_id")
          .in("id", convoIds);
        if (cErr) throw cErr;
        for (const c of convos ?? []) interestByConvo.set(c.id, c.interest_id);
      } catch {
        /* message reply link omitted rather than pointed at a wrong thread */
      }

      return rows.map((r) => {
        const otherId = r.caller_id === myId ? r.callee_id : r.caller_id;
        const person = people.get(otherId);
        const connected = !!r.answered_at && r.status !== "ringing";
        const outcome: CallEntry["outcome"] = connected
          ? "connected"
          : r.status === "ringing"
            ? "ringing"
            : r.decline_reason === "declined"
              ? "declined"
              : "missed";
        return {
          ...r,
          otherId,
          name: person?.full_name ?? "Member",
          role: person?.profession ?? "",
          outcome,
          interestId: interestByConvo.get(r.conversation_id) ?? null,
          out: r.caller_id === myId,
        };
      });
    },
  });

  /**
   * Re-dialling makes a NEW call row — an ended call cannot be reopened, and
   * the media/signalling state machine only ever runs against a live row.
   */
  async function callAgain(entry: CallEntry) {
    if (dialing) return;
    setDialing(entry.id);
    try {
      const { data, error } = await supabase
        .from("calls")
        .insert({
          conversation_id: entry.conversation_id,
          caller_id: myId!,
          callee_id: entry.otherId,
        })
        .select("id")
        .single();
      if (error) throw error;
      navigate({ to: "/call/$callId", params: { callId: data.id } });
    } catch {
      toast.error("Could not start the call. Ensure no other call is already ringing.");
      setDialing(null);
    }
  }

  if (me.isError) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">Calls could not load</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your profile could not be read, so the call list is hidden rather than shown empty.
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
        Video introductions
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">Calls</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Your 1:1 calls with accepted introductions. Call someone again from here without going back
        to the conversation first.
      </p>

      <div className="mt-8">
        {calls.isLoading || me.isLoading ? (
          <div className="grid gap-3" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading your calls…</span>
            {[0, 1, 2].map((n) => (
              <div key={n} className="border border-border bg-card p-5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-3 h-4 w-56" />
              </div>
            ))}
          </div>
        ) : calls.isError ? (
          <div role="alert" className="border border-destructive/40 bg-destructive/5 p-6">
            <p className="font-serif text-xl">Your calls could not be loaded</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This is a connection problem, not an empty history — nothing has been deleted.
            </p>
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => void calls.refetch()}
              disabled={calls.isFetching}
            >
              {calls.isFetching ? "Retrying…" : "Try again"}
            </Button>
          </div>
        ) : !calls.data?.length ? (
          <div className="border border-dashed border-border p-10 text-center">
            <p className="font-serif text-xl">No calls yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Start a video introduction from a conversation once an introduction is accepted.
            </p>
            <Button asChild className="mt-6">
              <Link to="/messages">Open messages</Link>
            </Button>
          </div>
        ) : (
          <ul className="grid gap-3">
            {calls.data.map((c) => {
              const connected = c.outcome === "connected";
              const missed = c.outcome === "missed" || c.outcome === "declined";
              const Icon = connected ? PhoneCall : missed ? PhoneMissed : PhoneIncoming;
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-5"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 ${
                        connected
                          ? "text-brass"
                          : missed
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }`}
                    >
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-serif text-lg font-semibold">{c.name}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {c.out ? "You called" : "Incoming"} · {OUTCOME_COPY[c.outcome]}
                        {connected && duration(c) ? ` · ${duration(c)}` : ""}
                        {c.role ? ` · ${c.role}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(c.started_at).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {c.status !== "ringing" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={dialing !== null}
                        onClick={() => void callAgain(c)}
                        // Every row's button read "Call again", so a screen
                        // reader heard the same name N times with no way to
                        // tell the rows apart. The start time is unique.
                        aria-label={`Call again — ${new Date(c.started_at).toLocaleString("en-IN")}`}
                      >
                        <Video className="size-4" />
                        {dialing === c.id ? "Starting…" : "Call again"}
                      </Button>
                    )}
                    {c.interestId && (
                      <Button asChild variant="ghost" size="sm">
                        <Link
                          to="/messages/$interestId"
                          params={{ interestId: c.interestId }}
                          aria-label={`Open the conversation from ${new Date(c.started_at).toLocaleString("en-IN")}`}
                        >
                          <MessageSquare className="size-4" /> Message
                        </Link>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
