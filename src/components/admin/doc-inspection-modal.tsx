import { useEffect, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  ExternalLink,
  FileText,
  Loader2,
  RotateCcw,
  RotateCw,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export interface DocInspectionModalProps {
  memberId: string;
  memberName: string;
  docPath: string;
  degree?: string | null | undefined;
  institution?: string | null | undefined;
  gradYear?: number | null | undefined;
  alumniEmail?: string | null | undefined;
  note: string;
  onNoteChange: (note: string) => void;
  onApprove: () => void;
  onRequestResubmission: () => void;
  isPending: boolean;
  onClose: () => void;
}

export function DocInspectionModal({
  memberId: _memberId,
  memberName,
  docPath,
  degree,
  institution,
  gradYear,
  alumniEmail,
  note,
  onNoteChange,
  onApprove,
  onRequestResubmission,
  isPending,
  onClose,
}: DocInspectionModalProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const isPdf = docPath.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setZoom(1);
    setRotation(0);

    async function fetchDoc() {
      try {
        const { data, error: err } = await supabase.storage
          .from("verification-docs")
          .createSignedUrl(docPath, 600);
        if (err) throw err;
        if (!data?.signedUrl) throw new Error("No signed URL returned for document.");
        if (isMounted) {
          setSignedUrl(data.signedUrl);
          setLoading(false);
        }
      } catch (e) {
        if (isMounted) {
          setError(e instanceof Error ? e.message : "Could not load credential document.");
          setLoading(false);
        }
      }
    }

    void fetchDoc();

    return () => {
      isMounted = false;
    };
  }, [docPath]);

  // Keyboard navigation & accessibility
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100));
      } else if (e.key === "-") {
        setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
      } else if (e.key === "0") {
        setZoom(1);
        setRotation(0);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleZoomIn = () => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100));
  const handleZoomOut = () => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
  const handleResetZoom = () => {
    setZoom(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-inspection-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/30 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2
              id="doc-inspection-title"
              className="font-serif text-lg font-semibold tracking-wide text-foreground truncate"
            >
              Credential Inspection: {memberName}
            </h2>
            <p className="text-xs text-muted-foreground truncate">
              {degree ? `${degree}, ` : ""}
              {institution ? `${institution} ` : ""}
              {gradYear ? `(${gradYear}) ` : ""}
              {alumniEmail ? `· ${alumniEmail}` : ""}
            </p>
          </div>

          {/* Controls toolbar */}
          <div className="flex items-center gap-1.5">
            {!isPdf && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomIn}
                  disabled={loading || !!error || zoom >= 3}
                  aria-label="Zoom in (+)"
                  className="size-8 p-0"
                >
                  <ZoomIn className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomOut}
                  disabled={loading || !!error || zoom <= 0.5}
                  aria-label="Zoom out (-)"
                  className="size-8 p-0"
                >
                  <ZoomOut className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRotate}
                  disabled={loading || !!error}
                  aria-label="Rotate 90 degrees"
                  className="size-8 p-0"
                >
                  <RotateCw className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetZoom}
                  disabled={loading || !!error || (zoom === 1 && rotation === 0)}
                  aria-label="Reset zoom and rotation (0)"
                  className="size-8 p-0 text-xs font-mono"
                >
                  <RotateCcw className="size-3.5" />
                </Button>
                <span className="text-xs font-mono text-muted-foreground px-1">
                  {Math.round(zoom * 100)}%
                </span>
              </>
            )}

            {signedUrl && (
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="size-8 p-0"
                aria-label="Open in new window"
              >
                <a href={signedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close inspection dialog"
              className="size-8 p-0 hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {/* Content Viewer Body */}
        <div className="relative flex flex-1 min-h-[360px] max-h-[58vh] items-center justify-center overflow-auto bg-slate-950 p-4">
          {loading && (
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <Loader2 className="size-7 animate-spin text-brass" />
              <p className="text-xs">Loading credential securely…</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center gap-2 text-center text-rose-300">
              <AlertCircle className="size-8 text-rose-400" />
              <p className="text-sm font-medium">{error}</p>
              <p className="text-xs text-slate-400">
                Please verify permissions or try opening in a new window.
              </p>
            </div>
          )}

          {!loading && !error && signedUrl && (
            <>
              {isPdf ? (
                <div className="size-full flex flex-col items-center justify-center">
                  <object
                    data={signedUrl}
                    type="application/pdf"
                    className="h-[52vh] w-full rounded border border-slate-800"
                  >
                    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-slate-300">
                      <FileText className="size-10 text-brass" />
                      <p className="text-sm">PDF preview is not supported directly in this view.</p>
                      <Button asChild size="sm" variant="outline">
                        <a href={signedUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1.5 size-4" /> Open PDF in new tab
                        </a>
                      </Button>
                    </div>
                  </object>
                </div>
              ) : (
                <div className="flex size-full items-center justify-center overflow-auto">
                  <img
                    src={signedUrl}
                    alt={`Verification credential for ${memberName}`}
                    style={{
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                      transition: "transform 0.15s ease-out",
                    }}
                    className="max-h-[52vh] max-w-full object-contain select-none shadow-lg"
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Action Decision Footer */}
        <footer className="border-t border-border bg-card p-4 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1">
              <Input
                aria-label={`Private note to ${memberName}, shown to them on resubmission`}
                placeholder="Private note to the member (shown on resubmission)"
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                maxLength={600}
                className="text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={onApprove}
                disabled={isPending}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
              >
                <BadgeCheck className="size-4" /> Approve
              </Button>
              <Button
                variant="outline"
                onClick={onRequestResubmission}
                disabled={isPending}
                className="gap-1.5"
              >
                <Undo2 className="size-4" /> Request resubmission
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
