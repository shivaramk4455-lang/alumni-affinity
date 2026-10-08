import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/** A gallery row (one tracked object in the member's own photo folder). */
export type GalleryPhoto = Database["public"]["Tables"]["profile_photos"]["Row"];

/** Matrimonial-directory cap: enough for a real gallery, small enough that
 *  storage abuse (20 MB × files) stays bounded per member. */
export const MAX_GALLERY_PHOTOS = 6;

/** Promote a gallery row to primary — sync trigger mirrors it onto
 *  profiles.photo_path, so search cards and viewers update instantly. */
export function useSetPrimaryPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photo: GalleryPhoto) => {
      const { error } = await supabase
        .from("profile_photos")
        .update({ is_primary: true })
        .eq("id", photo.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
      toast.success("Primary photograph updated.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update the primary."),
  });
}

/** Delete a photograph: row first (trigger re-points or clears the profile
 *  portrait), object second. Reorder is best-effort and never fatal. */
export function useDeleteGalleryPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photo: GalleryPhoto) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sign in again to manage photographs.");
      const { error: rowError } = await supabase
        .from("profile_photos")
        .delete()
        .eq("id", photo.id)
        .eq("user_id", u.user.id);
      if (rowError) throw rowError;
      const { error: objError } = await supabase.storage
        .from("profile-photos")
        .remove([photo.path]);
      if (objError) {
        throw new Error(
          "Row removed, but the stored file could not be deleted. It will be purged with the account.",
        );
      }
      const mine = (qc.getQueryData<GalleryPhoto[]>([...GALLERY_QUERY_KEY, "mine"]) ?? []).filter(
        (p) => p.id !== photo.id,
      );
      await Promise.all(
        mine.map((p, i) => supabase.from("profile_photos").update({ position: i }).eq("id", p.id)),
      ).catch(() => undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
      toast.success("Photograph deleted.");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not delete the photograph."),
  });
}

/** Move a photograph one step in display order (best-effort). */
export function useMoveGalleryPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      photos,
      from,
      to,
    }: {
      photos: GalleryPhoto[];
      from: number;
      to: number;
    }) => {
      if (to < 0 || to >= photos.length) return;
      const a = photos[from];
      const b = photos[to];
      if (!a || !b) return;
      const { error: e1 } = await supabase
        .from("profile_photos")
        .update({ position: to })
        .eq("id", a.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("profile_photos")
        .update({ position: from })
        .eq("id", b.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      // Reordering can change which row ends up primary, and the primary mirrors
      // onto profiles.photo_path — the same invalidations set-primary/delete do.
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
    },
    onError: () => toast.error("Could not reorder the gallery."),
  });
}

export const GALLERY_QUERY_KEY = ["gallery"] as const;

/** JPEG/PNG only — matches the `profile-photos` bucket MIME whitelist. */
export const GALLERY_ACCEPT = "image/jpeg,image/png";

/** The member's own gallery, ordered for display (primary first). */
export function useGallery() {
  return useQuery({
    queryKey: [...GALLERY_QUERY_KEY, "mine"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      // A failed session read must not read as "no photographs": the upload cap
      // below counts this same cached list, so an empty-on-error result would
      // also wave through uploads past MAX_GALLERY_PHOTOS.
      if (!u.user) throw new Error("session unavailable");
      const { data, error } = await supabase
        .from("profile_photos")
        .select("id, user_id, path, position, is_primary, created_at")
        .eq("user_id", u.user.id)
        .order("is_primary", { ascending: false })
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as GalleryPhoto[];
    },
  });
}
/** Any visible gallery rows for a member (viewer-permission check is enforced by RLS). */
export function useMemberGallery(userId: string | null | undefined) {
  return useQuery({
    queryKey: [...GALLERY_QUERY_KEY, "member", userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return [] as GalleryPhoto[];
      const { data, error } = await supabase
        .from("profile_photos")
        .select("id, user_id, path, position, is_primary, created_at")
        .eq("user_id", userId)
        .order("is_primary", { ascending: false })
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as GalleryPhoto[];
    },
  });
}

function galleryPath(userId: string, file: File): string {
  const raw =
    file.name
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";
  const ext = raw === "jpeg" || raw === "jpg" ? "jpg" : raw === "png" ? "png" : "jpg";
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${userId}/gallery-${stamp}-${rand}.${ext}`;
}

function assertGalleryFile(file: File) {
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    throw new Error("Only JPG or PNG photographs are accepted.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Each photograph must be 20 MB or smaller.");
  }
}

async function loadImage(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close?.(),
      };
    } catch {
      // Fallback to HTMLImageElement
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        cleanup: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * Automatic client-side image optimization (industry standard on Shaadi.com).
 *
 * Smartphone cameras produce massive 10–20 MB portraits. This function scales
 * the image to max 2048px on the longest edge and re-encodes at 88% JPEG quality,
 * shrinking photos down to ~1–2 MB without perceptible loss of clarity.
 */
export async function compressPhotograph(file: File): Promise<File> {
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    return file;
  }
  if (typeof window === "undefined") {
    return file;
  }

  try {
    const { source, width, height, cleanup } = await loadImage(file);
    const MAX_DIMENSION = 2048;
    const TARGET_QUALITY = 0.88;

    // Already compact JPEG within HD bounds — leave as-is
    if (
      file.size <= 1.5 * 1024 * 1024 &&
      width <= MAX_DIMENSION &&
      height <= MAX_DIMENSION &&
      file.type === "image/jpeg"
    ) {
      cleanup();
      return file;
    }

    let targetWidth = width;
    let targetHeight = height;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      if (width > height) {
        targetWidth = MAX_DIMENSION;
        targetHeight = Math.round((height * MAX_DIMENSION) / width);
      } else {
        targetHeight = MAX_DIMENSION;
        targetWidth = Math.round((width * MAX_DIMENSION) / height);
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      cleanup();
      return file;
    }

    // Fill white background in case of transparent PNGs
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    cleanup();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", TARGET_QUALITY);
    });

    if (!blob) return file;

    // Only substitute if we reduced size or scaled down excessive dimensions
    if (blob.size < file.size || width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      return new File([blob], `${baseName}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    }

    return file;
  } catch (err) {
    console.warn("Client-side photo compression fallback to original:", err);
    return file;
  }
}

/** Upload one photograph: object first, tracked row second. */
export function useUploadGalleryPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      assertGalleryFile(file);
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sign in again to add photographs.");
      const mine = (qc.getQueryData<GalleryPhoto[]>([...GALLERY_QUERY_KEY, "mine"]) ?? []).length;
      if (mine >= MAX_GALLERY_PHOTOS) {
        throw new Error(`Keep at most ${MAX_GALLERY_PHOTOS} photographs — delete one first.`);
      }
      const processed = await compressPhotograph(file);
      const path = galleryPath(u.user.id, processed);
      const { error: upError } = await supabase.storage
        .from("profile-photos")
        .upload(path, processed, { upsert: false, contentType: processed.type });
      if (upError) throw upError;
      const { error: rowError } = await supabase.from("profile_photos").insert({
        user_id: u.user.id,
        path,
        position: mine,
        is_primary: mine === 0,
      });
      if (rowError) {
        await supabase.storage
          .from("profile-photos")
          .remove([path])
          .catch(() => undefined);
        throw rowError;
      }
      return path;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
      toast.success("Photograph added to your gallery.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add the photograph."),
  });
}
