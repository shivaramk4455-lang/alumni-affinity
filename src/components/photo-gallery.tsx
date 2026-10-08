import { useEffect, useState, type KeyboardEvent } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
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
            ? `Add up to ${MAX_GALLERY_PHOTOS} JPG/PNG portraits (up to 20 MB each, auto-optimized to ~1–2 MB). The first becomes your primary automatically.`
            : `${photos.length} of ${MAX_GALLERY_PHOTOS} used. Star one to make it primary.`}
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
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {photos.map((p, i) => (
            <GalleryThumb
              key={p.id}
              photo={p}
              index={i}
              selected={i === active}
              busy={busy}
              onSelect={() => setActive(i)}
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
    </div>
  );
}
function GalleryThumb({
  photo,
  index,
  selected,
  busy,
  onSelect,
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
      className={`group relative overflow-hidden border ${selected ? "border-brass" : "border-border"}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full"
        aria-label={`Preview photograph ${index + 1}`}
        aria-current={selected ? "true" : undefined}
      >
        <MemberPhoto
          path={photo.path}
          watermark={watermark}
          name={name ?? null}
          className="aspect-square w-full"
        />
      </button>
      {photo.is_primary && (
        <span className="absolute left-1 top-1 inline-flex items-center gap-1 bg-primary px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-primary-foreground">
          <Star className="size-3" /> Primary
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-foreground/80 p-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Move earlier"
            disabled={busy || isFirst}
            onClick={onMoveLeft}
            className="grid size-6 place-items-center text-background hover:bg-background/20 disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Move later"
            disabled={busy || isLast}
            onClick={onMoveRight}
            className="grid size-6 place-items-center text-background hover:bg-background/20 disabled:opacity-30"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </span>
        <span className="flex items-center gap-1">
          {!photo.is_primary && (
            <button
              type="button"
              aria-label="Make primary"
              disabled={busy}
              onClick={onPrimary}
              className="grid size-6 place-items-center text-background hover:bg-background/20 disabled:opacity-30"
            >
              <Star className="size-3.5" />
            </button>
          )}
          {confirming ? (
            <>
              <button
                type="button"
                aria-label="Confirm delete"
                disabled={busy}
                onClick={onDelete}
                className="grid size-6 place-items-center text-destructive-foreground hover:bg-destructive/40"
              >
                <Trash2 className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Cancel delete"
                onClick={onCancelConfirm}
                className="grid size-6 place-items-center text-background hover:bg-background/20"
              >
                <X className="size-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label="Delete photograph"
              disabled={busy}
              onClick={onDelete}
              className="grid size-6 place-items-center text-background hover:bg-background/20 disabled:opacity-30"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </span>
      </div>
      {confirming && (
        <p className="bg-foreground/90 p-1 text-center text-xs font-semibold text-background">
          Tap trash again to delete
        </p>
      )}
    </li>
  );
}

/**
 * Watermarked slideshow: arrow / keyboard navigation, counter and
 * thumbnails for jumping. Read-only — used on member profiles.
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
  name?: string | null;
}) {
  const total = photos.length;
  const safe = Math.min(Math.max(active, 0), Math.max(total - 1, 0));

  // Scoped to the slideshow region instead of window-global: a window listener
  // hijacked the arrow keys for every other control on the page.
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
    <div
      className="grid gap-3"
      role="region"
      aria-label="Photograph gallery"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="relative">
        {current && (
          <MemberPhoto
            path={current.path}
            watermark={watermark}
            name={name ?? null}
            className="aspect-[4/5] w-full"
          />
        )}
        {total > 1 && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Previous photograph"
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/90"
              onClick={() => onActive((safe + total - 1) % total)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Next photograph"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/90"
              onClick={() => onActive((safe + 1) % total)}
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
              className={`w-14 shrink-0 overflow-hidden border ${
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
  );
}
