import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useMyProfile } from "@/hooks/use-my-profile";
import { createRtcPeer, getIceServersAsync, type RtcPeer, type SignalKind } from "@/lib/rtc-peer";

export type CallRow = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  status: "ringing" | "active" | "ended";
  decline_reason: string | null;
  answered_at: string | null;
  ended_at: string | null;
  started_at: string;
};

export type CallRole = "caller" | "callee";

const CALL_COLUMNS =
  "id, conversation_id, caller_id, callee_id, status, decline_reason, answered_at, ended_at, started_at";

const RING_TIMEOUT_MS = 45_000;

/**
 * One call = one media + signalling bundle, owned entirely here so the state
 * machine has a single home (the call screen). The bell only routes to it.
 *
 * Lifecycle:  caller arrives -> media -> offer. Callee arrives -> waits for
 * Accept -> media -> (queued offer applied) -> answer. Either side may hang up,
 * which flips `calls.status` to 'ended' and lets the DB purge the SDP/ICE rows.
 */
export function useCall(callId: string | undefined) {
  const qc = useQueryClient();
  const me = useMyProfile();

  const call = useQuery({
    queryKey: ["call", callId],
    enabled: !!callId,
    queryFn: async (): Promise<CallRow | null> => {
      const { data, error } = await supabase
        .from("calls")
        .select(CALL_COLUMNS)
        .eq("id", callId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CallRow | null;
    },
    staleTime: 15_000,
  });

  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [connection, setConnection] = useState<RTCPeerConnectionState>("new");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RtcPeer | null>(null);
  const begunRef = useRef(false);
  const pendingRef = useRef<{ kind: string; payload: Json }[]>([]);
  const endedRef = useRef(false);

  const data = call.data ?? null;
  const myId = me.data?.id ?? null;
  const role: CallRole | null =
    data && myId
      ? data.caller_id === myId
        ? "caller"
        : data.callee_id === myId
          ? "callee"
          : null
      : null;

  const signal = useCallback(
    async (kind: SignalKind, payload: Json) => {
      if (!callId) return;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { error } = await supabase
        .from("call_signals")
        .insert({ call_id: callId, sender_id: u.user.id, kind, payload });
      if (error && error.code !== "23505") {
        // 23505 = raced duplicate; everything else is a genuine failure.
        console.error("call signal", error);
      }
    },
    [callId],
  );
  /** Stop local + remote media and drop the peer connection. */
  const teardownMedia = useCallback(() => {
    peerRef.current?.destroy();
    peerRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setLocal(null);
    remoteRef.current?.getTracks().forEach((t) => t.stop());
    remoteRef.current = null;
    setRemote(null);
    setConnection("closed");
  }, []);

  /**
   * End the call. Guarded so a hangup signal racing a realtime UPDATE cannot
   * fire twice. `hangup` is sent BEFORE flipping the status, because the
   * signals INSERT policy only accepts rows on a call that is still live.
   */
  const endCall = useCallback(
    async (reason: "ended" | "declined" | "missed") => {
      if (!callId || endedRef.current) return;
      endedRef.current = true;
      void signal("hangup", { reason });

      const { data: u } = await supabase.auth.getUser();
      const { data: current } = await supabase
        .from("calls")
        .select("status, caller_id, callee_id")
        .eq("id", callId)
        .maybeSingle();

      teardownMedia();

      if (current && current.status !== "ended") {
        const { error: endError } = await supabase
          .from("calls")
          .update({
            status: "ended",
            ended_at: new Date().toISOString(),
            decline_reason: reason,
          })
          .eq("id", callId);
        // The error was never checked. A failed update left the row 'ringing',
        // and idx_calls_one_live (one live call per conversation) then blocked
        // every future call in that conversation for good — with no retry path
        // and nothing in the UI to explain it.
        if (endError) {
          console.error("use-call: could not end the call row:", endError.message);
          toast.error(
            "The call ended, but we could not update its status. Please contact the membership desk.",
          );
        }
        // Whoever is still unknown has a missed call, not a conversation.
        // Server-composed via notify_counterparty (accepted-interest checked).
        if (current.status === "ringing" && u.user) {
          const other = current.caller_id === u.user.id ? current.callee_id : current.caller_id;
          const { error: notifyError } = await supabase.rpc("notify_counterparty", {
            _user: other,
            _event: "call_missed",
          });
          if (notifyError) console.error("counterparty notification", notifyError);
        }
      }
      qc.invalidateQueries({ queryKey: ["call", callId] });
    },
    [callId, qc, signal, teardownMedia],
  );

  /** Apply one inbound signal; queue it if the peer is not up yet. */
  const applySignal = useCallback(
    async (kind: string, payload: Json | null) => {
      if (kind === "hangup") {
        teardownMedia();
        qc.invalidateQueries({ queryKey: ["call", callId] });
        return;
      }
      const peer = peerRef.current;
      if (!peer) {
        // Callee has not pressed Accept yet — hold until the peer exists.
        if (payload) pendingRef.current.push({ kind, payload });
        return;
      }
      if (payload === null || typeof payload !== "object") return;
      const p = payload as Record<string, unknown>;
      try {
        if (kind === "offer" && typeof p["sdp"] === "string") {
          await peer.handleRemoteOffer(p["sdp"]);
        } else if (kind === "answer" && typeof p["sdp"] === "string") {
          await peer.handleRemoteAnswer(p["sdp"]);
        } else if (kind === "ice" && p["candidate"] && typeof p["candidate"] === "object") {
          peer.handleRemoteIce(p["candidate"] as RTCIceCandidateInit);
        }
      } catch (e) {
        console.error("rtc signal", e);
      }
    },
    [callId, qc, teardownMedia],
  );

  /** Acquire camera/mic, stand up the peer, and (as caller) send the offer. */
  const begin = useCallback(
    async (as: CallRole) => {
      if (begunRef.current || endedRef.current) return;
      begunRef.current = true;
      setMediaError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        localRef.current = stream;
        setLocal(stream);

        const remoteStream = new MediaStream();
        remoteRef.current = remoteStream;
        setRemote(remoteStream);

        // Short-lived TURN credentials first (server-minted, TTL-bound);
        // static bundle config is the fallback when the function is absent.
        //
        // Imported statically: the module was also statically imported for
        // createRtcPeer, so the dynamic import could not move it into its own
        // chunk — it only added a microtask hop inside the most
        // latency-sensitive path in the app.
        const peer = createRtcPeer(
          stream,
          remoteStream,
          {
            send: (kind, description) => {
              void signal(kind, { sdp: description.sdp ?? "", type: description.type } as Json);
            },
            sendIce: (candidate) => {
              void signal(candidate ? "ice" : "ice-done", (candidate ?? null) as Json);
            },
            onRemoteStream: () => setRemote(remoteRef.current),
            onState: (state) => setConnection(state),
          },
          await getIceServersAsync(),
        );
        peerRef.current = peer;

        // Flush anything that arrived before the peer existed (the offer the
        // caller sent while this page was still loading).
        const queued = pendingRef.current.splice(0);
        for (const s of queued) await applySignal(s.kind, s.payload);

        if (as === "caller") await peer.createOffer();
      } catch (e) {
        begunRef.current = false;
        const name = e instanceof DOMException ? e.name : "UnknownError";
        setMediaError(
          name === "NotAllowedError"
            ? "Camera and microphone permission was declined."
            : name === "NotFoundError"
              ? "No camera or microphone was found on this device."
              : "Could not start your camera.",
        );
        teardownMedia();
      }
    },
    [applySignal, signal, teardownMedia],
  );

  // Realtime signalling subscriber
  useEffect(() => {
    if (!callId) return;

    // Fetch existing historical signals first
    void supabase
      .from("call_signals")
      .select("kind, payload, sender_id")
      .eq("call_id", callId)
      .order("id", { ascending: true })
      .then(({ data: existingSignals }) => {
        if (!existingSignals) return;
        for (const s of existingSignals) {
          if (s.sender_id !== myId) {
            void applySignal(s.kind, s.payload);
          }
        }
      });

    const channel = supabase
      .channel(`call_signals:${callId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_signals",
          filter: `call_id=eq.${callId}`,
        },
        (payload) => {
          const row = payload.new as { sender_id: string; kind: string; payload: Json | null };
          if (row.sender_id !== myId) {
            void applySignal(row.kind, row.payload);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "calls",
          filter: `id=eq.${callId}`,
        },
        (payload) => {
          const updated = payload.new as CallRow;
          qc.setQueryData(["call", callId], updated);
          if (updated.status === "ended") {
            teardownMedia();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [callId, myId, applySignal, qc, teardownMedia]);

  // Callee acceptance action
  const answer = useCallback(async () => {
    if (!callId || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("calls")
        .update({
          status: "active",
          answered_at: new Date().toISOString(),
        })
        .eq("id", callId);
      if (error) throw error;
      await begin("callee");
      qc.invalidateQueries({ queryKey: ["call", callId] });
    } catch (err) {
      // The callee tapped Accept and nothing happened: a bare console.error left
      // them on a still-ringing screen with no explanation.
      console.error("Failed to answer call:", err);
      toast.error("Could not answer the call. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [callId, busy, begin, qc]);

  // Media must not outlive the screen that requested it. `teardownMedia` is
  // already called on hangup, decline and the `ended` realtime update, but
  // none of those fire when the user navigates away mid-call, closes the tab,
  // or an error boundary unmounts the route — which left the camera light on
  // with the track still live. Unmount is the only reliable backstop.
  useEffect(() => teardownMedia, [teardownMedia]);

  // Ringing timeout guard: automatically cancel if unanswered
  useEffect(() => {
    if (!data || data.status !== "ringing" || role !== "caller") return;
    const started = new Date(data.started_at).getTime();
    const elapsed = Date.now() - started;
    const remaining = Math.max(0, RING_TIMEOUT_MS - elapsed);

    const timer = setTimeout(() => {
      void endCall("missed");
    }, remaining);

    return () => clearTimeout(timer);
  }, [data, role, endCall]);

  // Track toggle controls (Audio / Video mute)
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  const toggleAudio = useCallback(() => {
    if (!localRef.current) return;
    const audioTrack = localRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsAudioMuted(!audioTrack.enabled);
      peerRef.current?.setSendersTrack("audio", audioTrack.enabled ? audioTrack : null);
    }
  }, []);

  const toggleVideo = useCallback(() => {
    if (!localRef.current) return;
    const videoTrack = localRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoMuted(!videoTrack.enabled);
      peerRef.current?.setSendersTrack("video", videoTrack.enabled ? videoTrack : null);
    }
  }, []);

  return {
    call: data,
    role,
    localStream: local,
    remoteStream: remote,
    connectionState: connection,
    mediaError,
    busy,
    isAudioMuted,
    isVideoMuted,
    begin,
    answer,
    endCall,
    toggleAudio,
    toggleVideo,
  };
}
