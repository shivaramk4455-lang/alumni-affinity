import { useEffect, useRef, useState } from "react";
import { Camera, Mic, MicOff, Phone, ShieldCheck, Video, VideoOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PreCallDeviceCheckProps {
  counterpartName: string;
  counterpartInstitution?: string | null | undefined;
  counterpartCity?: string | null | undefined;
  isCaller: boolean;
  onProceed: () => void;
  onCancel: () => void;
}

export function PreCallDeviceCheck({
  counterpartName,
  counterpartInstitution,
  counterpartCity,
  isCaller,
  onProceed,
  onCancel,
}: PreCallDeviceCheckProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [micVolume, setMicVolume] = useState(0);
  const [mediaState, setMediaState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initMedia() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Your browser does not support video calls.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: true,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setMediaState("ready");

        // Setup lightweight volume analyzer to confirm mic is picking up audio
        try {
          const AudioContextClass =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AudioContextClass) {
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 64;
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const checkVolume = () => {
              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] ?? 0;
              }
              const avg = sum / dataArray.length;
              if (isMounted) {
                setMicVolume(Math.min(100, Math.round((avg / 128) * 100)));
                animFrameRef.current = requestAnimationFrame(checkVolume);
              }
            };
            checkVolume();
          }
        } catch {
          // Audio analyzer is an optional visual affordance
        }
      } catch (err) {
        if (!isMounted) return;
        setMediaState("error");
        const name = err instanceof DOMException ? err.name : "Error";
        setErrorMessage(
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "Camera and microphone access was declined. Please enable permissions in your browser address bar to continue."
            : name === "NotFoundError"
              ? "No camera or microphone was found on this device."
              : "Could not access your camera and microphone.",
        );
      }
    }

    void initMedia();

    return () => {
      isMounted = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const toggleCamera = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !cameraEnabled;
        setCameraEnabled(!cameraEnabled);
      }
    }
  };

  const toggleMic = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !micEnabled;
        setMicEnabled(!micEnabled);
      }
    }
  };

  const handleStart = () => {
    // Release preview stream so active call session takes over device cleanly
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    onProceed();
  };

  return (
    <div className="relative flex min-h-[calc(100dvh-4.5625rem)] w-full flex-col items-center justify-center bg-slate-950 p-4 text-white sm:p-6">
      <div className="w-full max-w-xl space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-brass/10 text-brass">
            <Camera className="size-5" />
          </div>
          <h1 className="font-serif text-2xl font-semibold sm:text-3xl">
            {isCaller ? `Call ${counterpartName}` : `Join call with ${counterpartName}`}
          </h1>
          <p className="mt-1 text-xs text-slate-400 sm:text-sm">
            {counterpartInstitution ? `${counterpartInstitution} · ` : ""}
            {counterpartCity || "Private Introduction"}
          </p>
        </div>

        {/* Video Preview Box */}
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
          {mediaState === "loading" && (
            <div className="flex size-full items-center justify-center text-xs text-slate-400">
              Connecting camera…
            </div>
          )}

          {mediaState === "error" && (
            <div className="flex size-full flex-col items-center justify-center p-6 text-center text-xs text-rose-300">
              <VideoOff className="mb-2 size-8 text-rose-400" />
              <p className="max-w-xs leading-relaxed">{errorMessage}</p>
            </div>
          )}

          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="Camera preview"
            className={`size-full object-cover ${!cameraEnabled || mediaState !== "ready" ? "hidden" : ""}`}
          />

          {!cameraEnabled && mediaState === "ready" && (
            <div className="flex size-full flex-col items-center justify-center text-slate-500">
              <VideoOff className="size-10" />
              <p className="mt-2 text-xs">Camera is paused</p>
            </div>
          )}

          {/* Floating Controls inside Preview */}
          {mediaState === "ready" && (
            <div className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={toggleMic}
                aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
                className={`flex size-11 items-center justify-center rounded-full backdrop-blur-md transition-colors cursor-pointer ${
                  micEnabled
                    ? "bg-slate-800/80 text-white hover:bg-slate-700/80"
                    : "bg-rose-600 text-white hover:bg-rose-500"
                }`}
              >
                {micEnabled ? <Mic className="size-5" /> : <MicOff className="size-5" />}
              </button>
              <button
                type="button"
                onClick={toggleCamera}
                aria-label={cameraEnabled ? "Turn off camera" : "Turn on camera"}
                className={`flex size-11 items-center justify-center rounded-full backdrop-blur-md transition-colors cursor-pointer ${
                  cameraEnabled
                    ? "bg-slate-800/80 text-white hover:bg-slate-700/80"
                    : "bg-rose-600 text-white hover:bg-rose-500"
                }`}
              >
                {cameraEnabled ? <Video className="size-5" /> : <VideoOff className="size-5" />}
              </button>
            </div>
          )}
        </div>

        {/* Status Indicators */}
        <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <span
              className={`size-2 rounded-full ${
                micVolume > 5 ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
              }`}
            />
            <span>{micVolume > 5 ? "Microphone detected" : "Microphone active"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-emerald-400">
            <ShieldCheck className="size-3.5" />
            <span>End-to-end encrypted</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            className="flex-1 bg-emerald-600 text-white hover:bg-emerald-500 gap-2 font-medium"
            onClick={handleStart}
            disabled={mediaState === "loading"}
          >
            <Phone className="size-4" />
            {isCaller ? "Start Call Now" : "Accept & Join Call"}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={onCancel}
          >
            <X className="mr-1.5 size-4" /> Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
