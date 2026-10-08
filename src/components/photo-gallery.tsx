import { useEffect, useState, type KeyboardEvent } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  Maximize2,
  Star,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MemberPhoto } from "@/components/member-photo";
import {
  GALLERY_ACCEPT,
  MAX_GALLERY_PHOTOS,
  useDeleteGalleryPhoto,
  useGallery,
  useMoveGalleryPhoto,
  useSetPrimaryPhoto,
  useUploadGalleryPhoto,
  type GalleryPhoto,
} from "@/lib/gallery";

/**
 * Owner-managed photo gallery: upload up to MAX_GALLERY_PHOTOS portraits,
 * pick the primary shown in search, delete spares, and reorder. Objects
 * live in the member's own `profile-photos` folder; the sync trigger
 * mirrors the primary onto profiles.photo_path.
 */
export function PhotoGalleryManager({
  watermark,
  name,
}: {
  watermark: string;
  name?: string | null;
}) {
  const gallery = useGallery();
  const upload = useUploadGalleryPhoto();
  const setPrimary = useSetPrimaryPhoto();
  const remove = useDeleteGalleryPhoto();
  const move = useMoveGalleryPhoto();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  const photos = gallery.data ?? [];
  const full = photos.length >= MAX_GALLERY_PHOTOS;
  const busy = upload.isPending || setPrimary.isPending || remove.isPending || move.isPending;

  useEffect(() => {
    if (active >= photos.length) setActive(Math.max(0, photos.length - 1));
  }, [active, photos.length]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={`inline-flex cursor-pointer items-center gap-2 border border-border px-4 py-2 text-sm font-semibold ${
            full || upload.isPending ? "pointer-events-none opacity-50" : "hover:bg-secondary/60"
          }`}
        >
          {upload.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          {upload.isPending
            ? "Optimizing & uploading…"
            : full
              ? `Gallery full (${MAX_GALLERY_PHOTOS})`
              : "Add photograph"}
          <input
            type="file"
            accept={GALLERY_ACCEPT}
            className="sr-only"
            disabled={full || upload.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {photos.length === 0
            ? `Add up to ${MAX_GALLERY_PHOTOS} JPG/PNG portraits (up to 10 MB each, auto-optimized to ~1–2 MB). Choose any photo as your primary profile picture anytime.`
            : `${photos.length} of ${MAX_GALLERY_PHOTOS} uploaded. Click any photo to preview enlarged, or choose "Make Primary" to set your profile picture.`}
        </p>
      </div>

      {gallery.isError ? (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
        >
          Your photographs could not be loaded — this is not the same as an empty gallery. Adding or
          reordering from a failed count could drop you over the limit.{" "}
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => void gallery.refetch()}
            disabled={gallery.isFetching}
          >
            {gallery.isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : gallery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading photographs…</p>
      ) : photos.length === 0 ? (
        <div className="grid place-items-center border border-dashed border-border p-8 text-center">
          <div className="text-muted-foreground">
            <Camera className="mx-auto size-6" />
            <p className="mt-3 text-sm font-semibold text-foreground">No photographs yet</p>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((p, i) => (
            <GalleryThumb
              key={p.id}
              photo={p}
              index={i}
              selected={i === active}
              busy={busy}
              onSelect={() => setActive(i)}
              onPreview={() => {
                setActive(i);
                setPreviewOpen(true);
              }}
              onPrimary={() => setPrimary.mutate(p)}
              onDelete={() => (confirmId === p.id ? remove.mutate(p) : setConfirmId(p.id))}
              confirming={confirmId === p.id}
              onCancelConfirm={() => setConfirmId(null)}
              onMoveLeft={() => move.mutate({ photos, from: i, to: i - 1 })}
              onMoveRight={() => move.mutate({ photos, from: i, to: i + 1 })}
              isFirst={i === 0}
              isLast={i === photos.length - 1}
              watermark={watermark}
              name={name}
            />
          ))}
        </ul>
      )}

      {/* Lightbox preview for owner */}
      {previewOpen && photos.length > 0 && (
        <EnlargedPhotoSliderModal
          photos={photos}
          active={active}
          onActive={setActive}
          onClose={() => setPreviewOpen(false)}
          watermark={watermark}
          name={name}
        />
      )}
    </div>
  );
}

function GalleryThumb({
  photo,
  index,
  selected,
  busy,
  onSelect,
  onPreview,
  onPrimary,
  onDelete,
  confirming,
  onCancelConfirm,
  onMoveLeft,
  onMoveRight,
  isFirst,
  isLast,
  watermark,
  name,
}: {
  photo: GalleryPhoto;
  index: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onPrimary: () => void;
  onDelete: () => void;
  confirming: boolean;
  onCancelConfirm: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  isFirst: boolean;
  isLast: boolean;
  watermark: string;
  name: string | null | undefined;
}) {
  return (
    <li
      className={`group relative overflow-hidden rounded border transition-colors ${
        selected ? "border-brass" : "border-border"
      }`}
    >
      {/* Primary profile photo badge / button */}
      {photo.is_primary ? (
        <span className="absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded bg-brass px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow">
          <Star className="size-3 fill-current" /> Profile Photo
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrimary();
          }}
          disabled={busy}
          title="Set as your primary profile photo"
          aria-label={`Set photograph ${index + 1} as profile picture`}
          className="absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded bg-background/90 px-2 py-0.5 text-[10px] font-semibold text-foreground shadow backdrop-blur-xs transition-colors hover:bg-brass hover:text-primary-foreground disabled:opacity-50"
        >
          <Star className="size-3" /> Make Primary
        </button>
      )}

      {/* Enlarge preview button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPreview();
        }}
        title="Click to preview enlarged"
        aria-label={`Preview photograph ${index + 1} enlarged`}
        className="absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/90 focus-visible:opacity-100"
      >
        <Maximize2 className="size-3" />
      </button>

      {/* Thumbnail image click opens preview */}
      <button
        type="button"
        onClick={() => {
          onSelect();
          onPreview();
        }}
        className="block w-full cursor-zoom-in"
        aria-label={`View photograph ${index + 1} enlarged`}
        aria-current={selected ? "true" : undefined}
      >
        <MemberPhoto
          path={photo.path}
          watermark={watermark}
          name={name ?? null}
          className="aspect-square w-full"
        />
      </button>

      {/* Bottom reorder and delete toolbar */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-1 bg-black/65 p-1 backdrop-blur-xs">
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Move earlier"
            disabled={busy || isFirst}
            onClick={(e) => {
              e.stopPropagation();
              onMoveLeft();
            }}
            className="grid size-6 place-items-center rounded text-white hover:bg-white/20 disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Move later"
            disabled={busy || isLast}
            onClick={(e) => {
              e.stopPropagation();
              onMoveRight();
            }}
            className="grid size-6 place-items-center rounded text-white hover:bg-white/20 disabled:opacity-30"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </span>
        {confirming ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Confirm delete"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm
            </button>
            <button
              type="button"
              aria-label="Cancel delete"
              onClick={(e) => {
                e.stopPropagation();
                onCancelConfirm();
              }}
              className="grid size-6 place-items-center rounded text-white hover:bg-white/20"
            >
              <X className="size-3" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label="Delete photograph"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="grid size-6 place-items-center rounded text-white hover:bg-destructive/60 disabled:opacity-30"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {confirming && (
        <p className="absolute inset-x-0 bottom-8 z-10 bg-destructive/90 p-1 text-center text-[10px] font-semibold text-destructive-foreground">
          Tap confirm to delete
        </p>
      )}
    </li>
  );
}

/**
 * Matrimonial Enlarged Photo Lightbox Modal.
 * Full-screen modal with previous/next arrows, keyboard navigation (left/right/Esc),
 * photo counter, viewer watermark, and bottom thumbnail jumper strip.
 */
export function EnlargedPhotoSliderModal({
  photos,
  active,
  onActive,
  onClose,
  watermark,
  name,
}: {
  photos: { path: string | null }[];
  active: number;
  onActive: (i: number) => void;
  onClose: () => void;
  watermark: string;
  name?: string | null | undefined;
}) {
  const total = photos.length;
  const safe = Math.min(Math.max(active, 0), Math.max(total - 1, 0));
  const current = photos[safe];

  // Lock body scroll while modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Global keydown listener for keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" && total > 1) {
        e.preventDefault();
        onActive((safe + total - 1) % total);
      } else if (e.key === "ArrowRight" && total > 1) {
        e.preventDefault();
        onActive((safe + 1) % total);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [safe, total, onActive, onClose]);

  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name ? `${name}'s` : "Member"} photo gallery`}
      className="fixed inset-0 z-[100] flex flex-col bg-black/92 backdrop-blur-md text-white select-none animate-in fade-in-0 duration-150"
      onClick={onClose}
    >
      {/* Top Header */}
      <div
        className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4 md:px-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="font-serif text-lg font-semibold tracking-wide text-white">
            {name ? `${name}` : "Member Profile"}
          </span>
          <span className="rounded bg-white/15 px-2 py-0.5 text-xs font-medium text-white/90">
            {safe + 1} of {total}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close enlarged gallery (Escape)"
            className="grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/* Main Centered Viewer Area */}
      <div
        className="relative flex flex-1 items-center justify-center p-4 md:p-8 overflow-hidden"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* Previous Button */}
        {total > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onActive((safe + total - 1) % total);
            }}
            aria-label="Previous photograph (Left Arrow)"
            className="absolute left-2 md:left-6 z-10 grid size-12 place-items-center rounded-full bg-black/60 text-white border border-white/20 backdrop-blur-sm transition-transform hover:scale-105 hover:bg-black/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <ChevronLeft className="size-6" />
          </button>
        )}

        {/* Enlarged Photograph Container */}
        <div
          className="relative max-h-[72vh] max-w-[85vw] md:max-w-3xl aspect-[3/4] md:aspect-[4/5] overflow-hidden rounded border border-white/15 shadow-2xl bg-black"
          onClick={(e) => e.stopPropagation()}
        >
          <MemberPhoto
            path={current.path}
            watermark={watermark}
            name={name ?? null}
            className="size-full"
            imgClassName="object-contain md:object-cover"
          />
        </div>

        {/* Next Button */}
        {total > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onActive((safe + 1) % total);
            }}
            aria-label="Next photograph (Right Arrow)"
            className="absolute right-2 md:right-6 z-10 grid size-12 place-items-center rounded-full bg-black/60 text-white border border-white/20 backdrop-blur-sm transition-transform hover:scale-105 hover:bg-black/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>

      {/* Bottom Thumbnail Strip */}
      {total > 1 && (
        <div
          className="shrink-0 border-t border-white/10 bg-black/70 px-4 py-3 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto flex max-w-xl items-center justify-center gap-2.5 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onActive(i)}
                aria-label={`Jump to photo ${i + 1}`}
                className={`relative h-16 w-14 shrink-0 overflow-hidden rounded border-2 transition-all ${
                  i === safe
                    ? "border-brass scale-105 shadow-md"
                    : "border-white/20 opacity-60 hover:opacity-100 hover:border-white/50"
                }`}
              >
                <MemberPhoto
                  path={p.path}
                  watermark=""
                  name={null}
                  className="size-full"
                  imgClassName="object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Watermarked slideshow: arrow / keyboard navigation, counter and
 * thumbnails for jumping. Read-only — used on member profiles.
 * Clicking any photo opens the enlarged lightbox slider modal.
 */
export function PhotoSlideshow({
  photos,
  active,
  onActive,
  watermark,
  name,
}: {
  photos: { path: string | null }[];
  active: number;
  onActive: (i: number) => void;
  watermark: string;
  name?: string | null | undefined;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const total = photos.length;
  const safe = Math.min(Math.max(active, 0), Math.max(total - 1, 0));

  // Scoped to the slideshow region instead of window-global
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (total < 2) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onActive((safe + total - 1) % total);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onActive((safe + 1) % total);
    }
  }

  const current = photos[safe];

  return (
    <>
      <div
        className="grid gap-3"
        role="region"
        aria-label="Photograph gallery"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div className="group relative overflow-hidden rounded border border-border">
          {current && (
            <div
              onClick={() => setModalOpen(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setModalOpen(true);
                }
              }}
              aria-label="Click to enlarge photograph in modal gallery"
              className="relative block cursor-zoom-in"
            >
              <MemberPhoto
                path={current.path}
                watermark={watermark}
                name={name ?? null}
                className="aspect-[4/5] w-full transition-transform duration-300 group-hover:scale-[1.02]"
              />
              {/* Enlarge badge button */}
              <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-sm bg-background/85 px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm backdrop-blur-sm transition-all group-hover:bg-background">
                <Maximize2 className="size-3.5" /> Enlarge ({total})
              </span>
            </div>
          )}
          {total > 1 && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Previous photograph"
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/90"
                onClick={(e) => {
                  e.stopPropagation();
                  onActive((safe + total - 1) % total);
                }}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Next photograph"
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/90"
                onClick={(e) => {
                  e.stopPropagation();
                  onActive((safe + 1) % total);
                }}
              >
                <ChevronRight className="size-4" />
              </Button>
              <span className="absolute bottom-2 right-2 bg-foreground/80 px-2 py-0.5 text-xs font-semibold text-background">
                {safe + 1} / {total}
              </span>
            </>
          )}
        </div>
        {total > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onActive(i)}
                aria-label={`View photograph ${i + 1} of ${total}`}
                aria-current={i === safe ? "true" : undefined}
                className={`w-14 shrink-0 overflow-hidden rounded border transition-all ${
                  i === safe ? "border-brass" : "border-border opacity-70 hover:opacity-100"
                }`}
              >
                <MemberPhoto
                  path={p.path}
                  watermark={watermark}
                  name={name ?? null}
                  className="aspect-square w-full"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Enlarged Lightbox Slider Modal */}
      {modalOpen && (
        <EnlargedPhotoSliderModal
          photos={photos}
          active={safe}
          onActive={onActive}
          onClose={() => setModalOpen(false)}
          watermark={watermark}
          name={name}
        />
      )}
    </>
  );
}
