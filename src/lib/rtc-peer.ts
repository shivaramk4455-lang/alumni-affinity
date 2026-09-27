// ---------------------------------------------------------------------------
// Peer-to-peer call transport.
//
// Media never leaves the browser (WebRTC SRTP between the two candidates).
// This module only owns the RTCPeerConnection and the SDP/ICE choreography —
// delivery of those descriptions is somebody else's concern (a callback), so
// the signalling channel can be swapped without touching this file.
//
// Design notes:
//   * ICE arrives before the remote description in the common case, so
//     candidates are queued until setRemoteDescription succeeds and flushed in
//     order afterwards. Dropping them silently is the classic broken-call bug.
//   * No renegotiation: the caller offers exactly once, mute/camera-off use
//     replaceTrack (no onnegotiationneeded), so glare never occurs.
//   * STUN only. For production behind hard/symmetric NAT add a TURN server:
//     without TURN, some corporate/mobile networks simply fail to connect.
// ---------------------------------------------------------------------------

export type SignalKind = "offer" | "answer" | "ice" | "ice-done" | "hangup";

export type PeerHandlers = {
  /** Publish our offer/answer to the other side. */
  send: (kind: "offer" | "answer", description: RTCSessionDescriptionInit) => void;
  /** Publish one ICE candidate (`null` = gathering complete). */
  sendIce: (candidate: RTCIceCandidateInit | null) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onState: (state: RTCPeerConnectionState, detail?: string) => void;
};

/**
 * Resolves ICE servers. Short-lived TURN credentials minted by the
 * turn-credentials edge function are preferred (static bundle credentials are
 * extractable); VITE_TURN_* remains only as a self-hosted fallback.
 */
export function getIceServers(): RTCIceServer[] {
  return defaultIceServers();
}

/**
 * Async variant: tries short-lived TURN credentials from the
 * turn-credentials edge function first, falling back to the static bundle
 * configuration (STUN + optional VITE_TURN_*).
 */
export async function getIceServersAsync(): Promise<RTCIceServer[]> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.functions.invoke<{
      urls: string[];
      username: string;
      credential: string;
      ttl: number;
    }>("turn-credentials");
    if (!error && data?.urls?.length && data.username && data.credential) {
      return [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
        { urls: data.urls, username: data.username, credential: data.credential },
      ];
    }
  } catch {
    // Fall through to static configuration below.
  }
  return defaultIceServers();
}

function defaultIceServers(): RTCIceServer[] {
  const customJson = import.meta.env["VITE_WEBRTC_ICE_SERVERS"];
  if (customJson) {
    try {
      const parsed = JSON.parse(customJson) as RTCIceServer[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      console.warn("Failed to parse VITE_WEBRTC_ICE_SERVERS");
    }
  }

  const turnUrls = import.meta.env["VITE_TURN_URLS"] || import.meta.env["VITE_TURN_URL"];
  const turnUsername = import.meta.env["VITE_TURN_USERNAME"];
  const turnCredential = import.meta.env["VITE_TURN_CREDENTIAL"];

  const servers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];

  if (turnUrls) {
    const urls = turnUrls.split(",").map((u: string) => u.trim());
    servers.push({
      urls,
      ...(turnUsername ? { username: turnUsername } : {}),
      ...(turnCredential ? { credential: turnCredential } : {}),
    });
  }

  return servers;
}

export type RtcPeer = {
  /** Apply a remote offer, then answer. Safe to call once. */
  handleRemoteOffer: (sdp: string) => Promise<void>;
  /** Apply the caller's answer. Safe to call once. */
  handleRemoteAnswer: (sdp: string) => Promise<void>;
  /** Queue or forward a remote ICE candidate. */
  handleRemoteIce: (candidate: RTCIceCandidateInit | null) => void;
  createOffer: () => Promise<void>;
  /** Mute/unmute audio or turn the camera on/off. */
  setSendersTrack: (kind: "audio" | "video", track: MediaStreamTrack | null) => void;
  destroy: () => void;
};

export function createRtcPeer(
  localStream: MediaStream,
  remoteStream: MediaStream,
  handlers: PeerHandlers,
  customIceServers?: RTCIceServer[],
): RtcPeer {
  const pc = new RTCPeerConnection({ iceServers: customIceServers ?? getIceServers() });

  pc.ontrack = (event) => {
    const track = event.track;
    // Merge into one stable stream object so the <video> element never needs
    // to be re-pointed when the remote audio track arrives alongside video.
    if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
      remoteStream.addTrack(track);
    }
    handlers.onRemoteStream(remoteStream);
  };

  pc.onicecandidate = (event) => {
    handlers.sendIce(event.candidate ? event.candidate.toJSON() : null);
  };

  pc.onconnectionstatechange = () => {
    handlers.onState(pc.connectionState);
  };

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  const pendingIce: RTCIceCandidateInit[] = [];
  let remoteDescriptionSet = false;

  function flushIce() {
    remoteDescriptionSet = true;
    for (const c of pendingIce.splice(0)) {
      void pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {
        /* candidate for a description we could not apply; non-fatal */
      });
    }
  }

  return {
    async createOffer() {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      if (pc.localDescription) handlers.send("offer", pc.localDescription);
    },

    async handleRemoteOffer(sdp: string) {
      await pc.setRemoteDescription({ type: "offer", sdp });
      flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (pc.localDescription) handlers.send("answer", pc.localDescription);
    },

    async handleRemoteAnswer(sdp: string) {
      if (pc.signalingState !== "have-local-offer") return; // duplicate answer
      await pc.setRemoteDescription({ type: "answer", sdp });
      flushIce();
    },

    handleRemoteIce(candidate: RTCIceCandidateInit | null) {
      if (!candidate) return;
      if (!remoteDescriptionSet) {
        pendingIce.push(candidate);
        return;
      }
      void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    },

    /** Mute / camera-off: swap the track on the matching sender. */
    setSendersTrack(kind: "audio" | "video", track: MediaStreamTrack | null) {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender) {
        void sender.replaceTrack(track);
        return;
      }
      if (track) pc.addTrack(track, localStream);
    },

    destroy() {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pendingIce.length = 0;
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    },
  };
}
