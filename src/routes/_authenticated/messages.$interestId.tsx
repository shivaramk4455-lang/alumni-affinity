import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  Flag,
  MessageSquare,
  Send,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConversation } from "@/hooks/use-conversation";
import { useMyProfile } from "@/hooks/use-my-profile";
import { supabase } from "@/integrations/supabase/client";
import { ICEBREAKERS } from "@/lib/icebreakers";

export const Route = createFileRoute("/_authenticated/messages/$interestId")({
  head: () => ({
    meta: [
      { title: "Conversation — The Merit Circle" },
      { name: "description", content: "Direct, private messaging following mutual introduction." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConversationPage,
});

function ConversationPage() {
  const { interestId } = Route.useParams();
  const navigate = useNavigate();
  const me = useMyProfile();
  const [text, setText] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  // Tracks whether the reader is parked at the newest message, so we can offer
  // a "jump to latest" affordance instead of stealing the viewport.
  const [atBottom, setAtBottom] = useState(true);

  const reportAndBlock = useMutation({
    mutationFn: async () => {
      const reason = reportReason.trim();
      if (reason.length < 10) {
        throw new Error("Please describe the concern in at least 10 characters.");
      }
      if (!myId || !otherId) return;
      const { error: repErr } = await supabase.from("reports").insert({
        reporter_id: myId,
        reported_profile_id: otherId,
        reason,
      });
      if (repErr) throw repErr;
      // 'blocked' is the only member-side exit from an accepted introduction
      // (terminal; closes messages/calls via their accepted-only gates). The
      // error is checked: a failed block must never report success.
      const { error: blockErr } = await supabase
        .from("interests")
        .update({ status: "blocked" })
        .eq("id", interestId);
      if (blockErr) throw blockErr;
    },
    onSuccess: () => {
      toast.success("Report filed. Introduction ended and member hidden.");
      navigate({ to: "/connections" });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not submit report.");
    },
  });

  const interestQuery = useQuery({
    queryKey: ["interest-for-chat", interestId],
    enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interests")
        .select("id, sender_id, recipient_id, status, message, created_at")
        .eq("id", interestId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const interest = interestQuery.data;
  const myId = me.data?.id;
  const otherId = interest
    ? interest.sender_id === myId
      ? interest.recipient_id
      : interest.sender_id
    : null;

  const otherProfile = useQuery({
    queryKey: ["chat-counterpart", otherId],
    enabled: !!otherId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, profession, institution, city, relocation, values_statement")
        .eq("id", otherId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { convo, history, send, sending, sendError, markRead } = useConversation(interestId);

  useEffect(() => {
    if (history.data && history.data.length > 0) {
      void markRead();
    }
  }, [history.data, markRead]);

  // Only follow new messages when the reader is already at the bottom. Without
  // this check, reading back through history and receiving a message yanked
  // the viewport to the newest one.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    // Follow on first paint (nothing scrolled yet) and whenever we were
    // already parked at the end.
    if (atBottom || el.scrollTop === 0) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [history.data?.length]);

  /** Recompute on scroll so the jump-to-latest control appears and disappears. */
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 64);
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    const body = text;
    setText("");
    const ok = await send(body);
    if (!ok) {
      setText(body);
      // Restore the draft and put the caret back, so a failed send does not
      // look like the message was delivered-and-vanished.
      chatInputRef.current?.focus();
      toast.error(sendError || "Could not deliver message.");
    }
  }

  const p = otherProfile.data;
  const counterpartFirstName = p?.full_name?.split(" ")[0] || "Member";

  async function handleStartCall() {
    if (!convo.data?.id || !myId || !otherId) return;
    try {
      const { data: callRow, error } = await supabase
        .from("calls")
        .insert({
          conversation_id: convo.data.id,
          caller_id: myId,
          callee_id: otherId,
        })
        .select("id")
        .single();
      if (error) throw error;
      navigate({ to: "/call/$callId", params: { callId: callRow.id } });
    } catch (err) {
      toast.error("Could not initiate call. Please ensure no other call is ringing.");
    }
  }

  if (interestQuery.isLoading || me.isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16 text-center text-sm text-muted-foreground">
        Loading conversation…
      </main>
    );
  }

  if (interestQuery.isError) {
    // A failed read is not a locked conversation: `!interest` below would show
    // "Direct messaging locked" for what is really a network problem.
    return (
      <main className="mx-auto max-w-xl px-5 py-20 text-center">
        <MessageSquare className="mx-auto size-8 text-brass" />
        <h1 className="mt-4 font-serif text-2xl font-semibold">Conversation could not load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong fetching this introduction. This is not the same as messaging being
          locked.
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => void interestQuery.refetch()}
          disabled={interestQuery.isFetching}
        >
          {interestQuery.isFetching ? "Retrying…" : "Try again"}
        </Button>
      </main>
    );
  }

  if (!interest || interest.status !== "accepted") {
    return (
      <main className="mx-auto max-w-xl px-5 py-20 text-center">
        <MessageSquare className="mx-auto size-8 text-brass" />
        <h1 className="mt-4 font-serif text-2xl font-semibold">Direct messaging locked</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Messaging is available exclusively after a mutually accepted introduction.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/connections">Back to introductions</Link>
        </Button>
      </main>
    );
  }

  if (!otherId || otherId === myId) {
    return (
      <main className="mx-auto max-w-xl px-5 py-20 text-center">
        <MessageSquare className="mx-auto size-8 text-brass" />
        <h1 className="mt-4 font-serif text-2xl font-semibold">Conversation unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This introduction does not involve your profile.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/connections">Back to introductions</Link>
        </Button>
      </main>
    );
  }

  const messages = history.data ?? [];

  return (
    // The sticky site header is `h-18` plus its 1px border = 4.5625rem, and
    // `100vh` does not account for mobile browser chrome, so the composer was
    // pushed below the fold. `dvh` tracks the real viewport.
    <main className="mx-auto flex h-[calc(100dvh-4.5625rem)] max-w-3xl flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to introductions">
            <Link to="/connections">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-serif text-lg font-semibold leading-tight">
              {p?.full_name || "Member"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {p?.profession ? `${p.profession} · ` : ""}
              {p?.institution ? `${p.institution} · ` : ""}
              {p?.city || ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleStartCall()}
            className="flex items-center gap-1.5 text-xs border-brass text-foreground hover:bg-brass/10"
          >
            <Video className="size-3.5 text-brass" />
            <span className="hidden sm:inline">Video call</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setReportOpen((v) => !v)}
            className="text-muted-foreground hover:text-destructive text-xs flex items-center gap-1"
            title="Report & end introduction"
          >
            <Flag className="size-3.5" />
            <span className="hidden sm:inline">Report</span>
          </Button>
        </div>
      </header>

      {reportOpen && (
        <div className="border-b border-destructive/30 bg-destructive/5 p-4">
          <div className="mx-auto max-w-xl space-y-3">
            <p className="text-xs font-semibold text-destructive uppercase tracking-wide">
              Report member &amp; end introduction
            </p>
            <p className="text-xs text-muted-foreground">
              Filing a report immediately closes this conversation, revokes contact access, hides
              this member from your discovery, and alerts the membership desk.
            </p>
            <Input
              maxLength={300}
              placeholder="Describe the concern (at least 10 characters)"
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="bg-background text-sm"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={reportAndBlock.isPending}
                onClick={() => reportAndBlock.mutate()}
              >
                {reportAndBlock.isPending ? "Submitting…" : "Report & block member"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReportOpen(false);
                  setReportReason("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* `role="log"` is what makes realtime arrivals announceable; without it
          a screen-reader user has no idea a message came in. `tabIndex` keeps
          the scroll region reachable by keyboard. */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={`Conversation with ${p?.full_name || "your introduction"}`}
        tabIndex={0}
        className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6"
      >
        <div className="rounded-md border border-border bg-secondary/30 p-4 text-center">
          <p className="font-serif text-base font-semibold">
            You and {counterpartFirstName} are connected.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Introductions are candidate-directed. Messages are private and uneditable.
          </p>

          {messages.length === 0 && (
            <div className="mt-4 text-left">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-brass">
                <Sparkles className="size-3.5" /> Conversation starters:
              </p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {ICEBREAKERS.slice(0, 4).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setText(b.prompt)}
                    className="rounded border border-border bg-background p-2 text-left text-xs text-foreground transition-colors hover:border-brass hover:bg-secondary/40"
                  >
                    <span className="font-medium">{b.title}</span>
                    <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">
                      {b.prompt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {history.isError && (
          <p
            role="alert"
            className="border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
          >
            Earlier messages could not be loaded — the thread below may be incomplete.{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void history.refetch()}
              disabled={history.isFetching}
            >
              {history.isFetching ? "Retrying…" : "Retry"}
            </button>
          </p>
        )}
        {messages.map((m) => {
          const isMine = m.sender_id === myId;
          return (
            <div key={m.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed sm:max-w-[70%] ${
                  isMine
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-card-foreground shadow-sm"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <div
                  className={`mt-1 flex items-center justify-end gap-1 text-xs ${
                    isMine ? "text-primary-foreground/60" : "text-muted-foreground"
                  }`}
                >
                  <span>
                    {new Date(m.created_at).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {isMine &&
                    (m.read_at ? (
                      // `aria-label` on a role-less <svg> is ignored, so the read
                      // receipt was invisible to assistive tech.
                      <>
                        <CheckCheck className="size-3 text-brass" aria-hidden="true" />
                        <span className="sr-only">Read</span>
                      </>
                    ) : (
                      <>
                        <Check className="size-3" aria-hidden="true" />
                        <span className="sr-only">Sent</span>
                      </>
                    ))}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* The counterpart to the scroll guard: when we deliberately did not
          follow a new message, offer the jump rather than moving the viewport
          out from under the reader. */}
      {!atBottom && (
        <div className="pointer-events-none relative">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="pointer-events-auto absolute -top-12 left-1/2 -translate-x-1/2 shadow-paper"
            onClick={() => {
              endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
              setAtBottom(true);
            }}
          >
            <ArrowDown className="size-3.5" /> Jump to latest
          </Button>
        </div>
      )}

      <form
        onSubmit={handleSend}
        className="border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <label htmlFor="chat-message" className="sr-only">
          Message {counterpartFirstName}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="chat-message"
            ref={chatInputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Message ${counterpartFirstName}… (Enter to send)`}
            maxLength={2000}
            className="flex-1 bg-background"
            disabled={sending}
          />
          <Button
            type="submit"
            disabled={!text.trim() || sending}
            size="icon"
            aria-label="Send message"
          >
            <Send className="size-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-right text-xs text-muted-foreground">{text.length}/2000</p>
      </form>
    </main>
  );
}
