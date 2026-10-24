import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Flag,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  ShieldCheck,
  Video,
  VideoOff,
  Video as VideoIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PreCallDeviceCheck } from "@/components/call/pre-call-device-check";
import { useCall } from "@/hooks/use-call";
import { useMyProfile } from "@/hooks/use-my-profile";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/call/$callId")({
  head: () => ({
    meta: [
      { title: "Video Introduction — The Merit Circle" },
      { name: "description", content: "Discreet peer-to-peer video introduction." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CallPage,
});

function CallPage() {
  const { callId } = Route.useParams();
  const navigate = useNavigate();
  const me = useMyProfile();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const {
    call,
    role,
    localStream,
    remoteStream,
    connectionState,
    mediaError,
    busy,
    isAudioMuted,
    isVideoMuted,
    begin,
    answer,
    endCall,
    toggleAudio,
    toggleVideo,
  } = useCall(callId);

  const [precallDone, setPrecallDone] = useState(false);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (role === "caller" && call?.status === "ringing" && precallDone) {
      void begin("caller");
    }
  }, [role, call?.status, precallDone, begin]);

  const myId = me.data?.id;
  const otherId = call ? (call.caller_id === myId ? call.callee_id : call.caller_id) : null;

  const counterpart = useQuery({
    queryKey: ["call-counterpart", otherId],
    enabled: !!otherId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, institution, profession, city")
        .eq("id", otherId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reporting, setReporting] = useState(false);

  const counterpartName = counterpart.data?.full_name?.split(" ")[0] || "Member";

  async function handleReport() {
    const reason = reportReason.trim();
    if (reason.length < 10) {
      toast.error("Please describe the concern in at least 10 characters.");
      return;
    }
    if (!myId || !otherId || !call) return;
    setReporting(true);
    try {
      // Record the report BEFORE tearing the call down. Ending first meant a
      // failed insert destroyed the call while the toast implied nothing had
      // been done — and there was no way to report afterwards.
      const { error: repErr } = await supabase.from("reports").insert({
        reporter_id: myId,
        reported_profile_id: otherId,
        reason,
      });
      if (repErr) throw repErr;

      // Make the block real: transition the underlying introduction to 'blocked'
      // so neither messaging, calls, nor re-approaching remains possible.
      if (call.conversation_id) {
        const { data: conv } = await supabase
          .from("conversations")
          .select("interest_id")
          .eq("id", call.conversation_id)
          .maybeSingle();

        if (conv?.interest_id) {
          const { error: blockErr } = await supabase
            .from("interests")
            .update({ status: "blocked" })
            .eq("id", conv.interest_id);
          if (blockErr) throw blockErr;
        }
      }

      await endCall("declined");
      toast.success("Report submitted. Call ended and member blocked.");
      navigate({ to: "/connections" });
    } catch {
      toast.error("Could not submit the report. The call is still live — please try again.");
      setReporting(false);
    }
  }

  if (!call) {
    // `call` is null both while loading and when the query fails (e.g. an RLS
    // denial), so the old copy spun forever with no escape.
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">Loading video session…</p>
        <Button asChild variant="outline">
          <Link to="/connections">Back to introductions</Link>
        </Button>
      </main>
    );
  }

  if (call.status === "ended") {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center p-6 text-center">
        <div className="rounded-full bg-secondary/80 p-4 text-muted-foreground">
          <PhoneOff className="size-8" />
        </div>
        <h1 className="mt-4 font-serif text-2xl font-semibold">Introduction call ended</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {call.decline_reason === "declined"
            ? "The call was declined."
            : call.decline_reason === "missed"
              ? "The member was unavailable."
              : "This video session has finished."}
        </p>
        <div className="mt-6 flex gap-3">
          <Button asChild variant="outline">
            <Link to="/connections">Return to introductions</Link>
          </Button>
        </div>
      </main>
    );
  }

  if (call.status === "ringing" && !precallDone && (role === "caller" || role === "callee")) {
    return (
      <PreCallDeviceCheck
        counterpartName={counterpartName}
        counterpartInstitution={counterpart.data?.institution}
        counterpartCity={counterpart.data?.city}
        isCaller={role === "caller"}
        onProceed={() => {
          setPrecallDone(true);
          if (role === "callee") {
            void answer();
          }
        }}
        onCancel={() => {
          void endCall("declined");
          navigate({ to: "/connections" });
        }}
      />
    );
  }

  return (
    // Header is `h-18` + 1px border = 4.5625rem; `dvh` tracks mobile chrome.
    <main className="relative flex h-[calc(100dvh-4.5625rem)] w-full flex-col bg-slate-950 text-white">
      <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent p-4 sm:px-6">
        <div>
          <h2 className="font-serif text-lg font-medium tracking-wide">
            {counterpart.data?.full_name || "Private Call"}
          </h2>
          <p className="text-xs text-slate-300">
            {counterpart.data?.institution ? `${counterpart.data.institution} · ` : ""}
            {counterpart.data?.city || ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-xs text-emerald-400 backdrop-blur-md">
            <ShieldCheck className="size-4" />
            <span>Encrypted P2P</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReportOpen((v) => !v)}
            className="text-slate-300 hover:text-rose-400 hover:bg-rose-950/40 text-xs gap-1"
          >
            <Flag className="size-3.5" />
            <span>Report</span>
          </Button>
        </div>
      </header>

      {reportOpen && (
        // Real dialog semantics: the overlay previously had no role, no focus
        // move into it and no Escape, so Tab walked straight back into the
        // call controls behind it while the video kept playing.
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-call-title"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setReportOpen(false);
              setReportReason("");
            }
          }}
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md space-y-4 rounded-lg border border-rose-800/80 bg-slate-900 p-6 text-left shadow-2xl">
            <h3
              id="report-call-title"
              className="flex items-center gap-2 font-serif text-lg font-semibold text-rose-300"
            >
              <Flag className="size-4 text-rose-400" /> Report &amp; end call
            </h3>
            <p className="text-sm leading-6 text-slate-300">
              This will immediately terminate the call, submit your confidential report to the
              membership desk, and block this member from finding you.
            </p>
            <label htmlFor="call-report-reason" className="sr-only">
              Reason for report
            </label>
            <Input
              id="call-report-reason"
              autoFocus
              maxLength={300}
              placeholder="Reason for report (at least 10 characters)"
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="border-slate-700 bg-slate-950 text-sm text-white placeholder:text-slate-500"
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setReportOpen(false);
                  setReportReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={reporting}
                onClick={() => void handleReport()}
              >
                {reporting ? "Submitting…" : "Report & terminate call"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {call.status === "active" && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            aria-label={`Video from ${counterpart.data?.full_name || "your introduction"}`}
            className="size-full object-cover"
          />
        )}

        {call.status === "ringing" && (
          <div className="flex flex-col items-center gap-4 text-center px-4">
            <div className="relative flex size-24 items-center justify-center rounded-full bg-brass/20 text-brass">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brass/20 opacity-75" />
              <VideoIcon className="size-10" />
            </div>

            {role === "caller" ? (
              <>
                <h3 className="font-serif text-2xl font-semibold">Calling {counterpartName}…</h3>
                <p className="max-w-xs text-xs text-slate-300">
                  Please wait while their device is notified. Calls not answered within 45 seconds
                  will close automatically.
                </p>
              </>
            ) : busy || precallDone ? (
              <>
                <h3 className="font-serif text-2xl font-semibold">
                  Connecting to {counterpartName}…
                </h3>
                <p className="max-w-xs text-xs text-slate-300">
                  Establishing secure encrypted peer-to-peer connection…
                </p>
              </>
            ) : (
              <>
                <h3 className="font-serif text-2xl font-semibold">
                  {counterpartName} is calling you
                </h3>
                <p className="max-w-xs text-xs text-slate-300">
                  A 1:1 private video coffee session between verified alumni.
                </p>
                <div className="mt-4 flex gap-4">
                  <Button
                    size="lg"
                    onClick={() => void answer()}
                    disabled={busy}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 font-medium"
                  >
                    <Phone className="size-5" /> Accept
                  </Button>
                  <Button
                    size="lg"
                    variant="destructive"
                    onClick={() => void endCall("declined")}
                    disabled={busy}
                    className="gap-2 font-medium"
                  >
                    <PhoneOff className="size-5" /> Decline
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        {localStream && (
          <div className="absolute bottom-24 right-4 z-20 w-28 overflow-hidden rounded-lg border border-slate-700/80 bg-black/80 shadow-2xl sm:bottom-28 sm:right-6 sm:w-44 aspect-[3/4]">
            <video
              ref={localVideoRef}
              aria-label="Your camera preview"
              autoPlay
              muted
              playsInline
              className={`size-full object-cover ${isVideoMuted ? "hidden" : ""}`}
            />
            {isVideoMuted && (
              <div className="flex size-full items-center justify-center bg-slate-900 text-xs text-slate-400">
                Camera off
              </div>
            )}
          </div>
        )}

        {mediaError && (
          <div
            role="alert"
            className="absolute inset-x-4 top-20 z-30 mx-auto max-w-md rounded-md border border-rose-800 bg-rose-950/90 p-3 text-center text-sm leading-6 text-rose-200 backdrop-blur-md"
          >
            {mediaError}
          </div>
        )}

        {/*
          `connectionState` was destructured and never used, so the call
          screen showed a black rectangle for the whole ICE/DTLS handshake
          and said nothing when the peer connection failed — leaving the user
          staring at a frozen frame behind working-looking controls.
        */}
        {call?.status === "active" &&
          (connectionState === "connecting" || connectionState === "new") && (
            <p
              role="status"
              className="absolute inset-x-4 top-20 z-30 mx-auto max-w-md rounded-md bg-black/70 p-3 text-center text-sm text-slate-200 backdrop-blur-md"
            >
              Connecting… {isVideoMuted ? "Your camera is off." : "Say hello."}
            </p>
          )}
        {connectionState === "failed" && (
          <div
            role="alert"
            className="absolute inset-x-4 top-20 z-30 mx-auto max-w-md rounded-md border border-rose-800 bg-rose-950/90 p-3 text-center text-sm leading-6 text-rose-200 backdrop-blur-md"
          >
            The connection failed. Check your network and try again.
          </div>
        )}
        {connectionState === "disconnected" && (
          <p
            role="status"
            className="absolute inset-x-4 top-20 z-30 mx-auto max-w-md rounded-md bg-black/70 p-3 text-center text-sm text-slate-200 backdrop-blur-md"
          >
            Reconnecting…
          </p>
        )}
      </div>

      <footer className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-6">
        <Button
          variant="outline"
          size="icon"
          aria-label={isAudioMuted ? "Unmute mic" : "Mute mic"}
          // Expose the toggle state, not just the label swap and colour.
          aria-pressed={isAudioMuted}
          // No local track yet (callee has not answered): the control did
          // nothing, so it should not look live.
          disabled={!localStream}
          onClick={toggleAudio}
          className={`size-12 rounded-full border-slate-700 bg-slate-800/80 text-white hover:bg-slate-700 focus-visible:bg-slate-800 ${
            isAudioMuted ? "border-rose-700 bg-rose-900 text-rose-200 hover:bg-rose-800" : ""
          }`}
        >
          {isAudioMuted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </Button>

        <Button
          variant="destructive"
          size="icon"
          aria-label="End call"
          onClick={() => void endCall("ended")}
          className="size-14 rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-500"
        >
          <PhoneOff className="size-6" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          aria-label={isVideoMuted ? "Turn on camera" : "Turn off camera"}
          aria-pressed={isVideoMuted}
          disabled={!localStream}
          onClick={toggleVideo}
          className={`size-12 rounded-full border-slate-700 bg-slate-800/80 text-white hover:bg-slate-700 focus-visible:bg-slate-800 ${
            isVideoMuted ? "border-rose-700 bg-rose-900 text-rose-200 hover:bg-rose-800" : ""
          }`}
        >
          {isVideoMuted ? <VideoOff className="size-5" /> : <Video className="size-5" />}
        </Button>
      </footer>
    </main>
  );
}
