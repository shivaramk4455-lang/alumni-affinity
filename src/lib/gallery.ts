import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/** A gallery row (one tracked object in the member's own photo folder). */
export type GalleryPhoto = Database["public"]["Tables"]["profile_photos"]["Row"];

/** Matrimonial-directory cap: enough for a real gallery, small enough that
 *  storage abuse (10 MB × files) stays bounded per member. */
export const MAX_GALLERY_PHOTOS = 6;

export const GALLERY_QUERY_KEY = ["gallery"] as const;

/** Accept JPG, PNG, and WebP formats. */
export const GALLERY_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/**
 * Extract an accurate, user-readable error reason from any Supabase,
 * PostgREST, Storage, or standard JavaScript error.
 */
export function formatErrorMessage(err: unknown): string {
  if (!err) return "An unexpected error occurred. Please try again.";
  if (typeof err === "string") return err;

  if (typeof err === "object") {
    const rec = err as Record<string, unknown>;
    const msg = typeof rec["message"] === "string" ? (rec["message"] as string) : null;
    const details = typeof rec["details"] === "string" ? (rec["details"] as string) : null;
    const hint = typeof rec["hint"] === "string" ? (rec["hint"] as string) : null;
    const code = typeof rec["code"] === "string" ? (rec["code"] as string) : null;
    const errorProp = typeof rec["error"] === "string" ? (rec["error"] as string) : null;
    const statusCode = typeof rec["statusCode"] === "string" ? (rec["statusCode"] as string) : null;

    // Supabase trigger execution permissions
    if (
      code === "42501" ||
      msg?.includes("permission denied for function") ||
      msg?.includes("sync_primary_photo")
    ) {
      return "Database trigger permission denied. Please ensure the latest Supabase migrations are applied (grant execute on sync_primary_photo).";
    }

    // Row-level security / access denied
    if (code === "42501" || msg?.includes("row-level security policy")) {
      return "Access denied by security policies. Please ensure you are logged in and uploading to your own profile.";
    }

    // Unique primary index violation
    if (
      code === "23505" ||
      msg?.includes("idx_profile_photos_one_primary") ||
      msg?.includes("duplicate key")
    ) {
      return "A primary photograph already exists. Please choose a different photo or make this one primary after uploading.";
    }

    // Storage bucket missing
    if (msg?.includes("Bucket not found") || msg?.toLowerCase().includes("bucket")) {
      return "Storage bucket 'profile-photos' is not available. Please verify storage configuration in Supabase.";
    }

    // File size exceeded
    if (
      statusCode === "413" ||
      msg?.includes("Payload too large") ||
      msg?.includes("Entity Too Large") ||
      msg?.includes("file_size_limit")
    ) {
      return "The photograph exceeds the maximum file size limit (10 MB). Please choose a smaller photo.";
    }

    // MIME type disallowed
    if (
      msg?.includes("mime type not allowed") ||
      msg?.includes("invalid_mime_type") ||
      msg?.includes("mime")
    ) {
      return "The selected image format is not accepted by storage. Please upload a JPG or PNG file.";
    }

    // Network / connection error
    if (msg?.includes("Failed to fetch") || msg?.includes("NetworkError")) {
      return "Network connection error. Please check your internet connection and try again.";
    }

    if (msg) {
      if (details && details !== msg && details.length < 200) {
        return `${msg} (${details})`;
      }
      if (hint && hint.length < 200) {
        return `${msg} — Hint: ${hint}`;
      }
      return msg;
    }

    if (errorProp) return errorProp;
  }

  if (err instanceof Error) return err.message;
  return String(err);
}

/** Validate size (<= 10 MB) and accepted image format. */
export function assertGalleryFile(file: File) {
  if (!file) throw new Error("No file selected.");

  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Photograph "${file.name}" is ${mb} MB. Each photograph must be 10 MB or smaller.`,
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const validExts = ["jpg", "jpeg", "png", "webp"];
  const validMimes = ["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp"];
  const mimeMatch = file.type ? validMimes.includes(file.type.toLowerCase()) : false;
  const extMatch = validExts.includes(ext);

  if (!mimeMatch && !extMatch) {
    throw new Error(
      `Unsupported format for "${file.name}" (${file.type || "unknown"}). Only JPG, PNG, and WebP portraits are supported.`,
    );
  }
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
 * Smartphone cameras produce massive 5–10 MB portraits. This function scales
 * the image to max 2048px on the longest edge and re-encodes at 88% JPEG quality,
 * shrinking photos down to ~1–2 MB without perceptible loss of clarity.
 * Guarantees that the resulting file type is 'image/jpeg'.
 */
export async function compressPhotograph(file: File): Promise<File> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isImage = file.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(ext);

  if (!isImage || typeof window === "undefined") {
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

    const baseName = file.name.replace(/\.[^/.]+$/, "");
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (err) {
    console.warn("Client-side photo compression fallback to original:", err);
    // Normalize MIME type to image/jpeg if it's a jpeg file with missing/atypical MIME
    if (!file.type || file.type === "image/jpg" || file.type === "image/pjpeg") {
      return new File([file], file.name.replace(/\.[^/.]+$/, ".jpg"), {
        type: "image/jpeg",
        lastModified: file.lastModified,
      });
    }
    return file;
  }
}

/** The member's own gallery, ordered for display (primary first).
 *  Falls back to synthesizing a primary entry from profiles.photo_path
 *  if profile_photos has 0 rows but a portrait exists. */
export function useGallery() {
  return useQuery({
    queryKey: [...GALLERY_QUERY_KEY, "mine"],
    queryFn: async () => {
      const { data: u, error: userErr } = await supabase.auth.getUser();
      if (userErr || !u.user) throw new Error("session unavailable");

      const { data, error } = await supabase
        .from("profile_photos")
        .select("id, user_id, path, position, is_primary, created_at")
        .eq("user_id", u.user.id)
        .order("is_primary", { ascending: false })
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;

      const photos = (data ?? []) as GalleryPhoto[];
      if (photos.length > 0) {
        return photos;
      }

      // Fallback: check if member has an existing portrait in profiles.photo_path
      const { data: prof } = await supabase
        .from("profiles")
        .select("photo_path")
        .eq("id", u.user.id)
        .maybeSingle();

      if (prof?.photo_path) {
        // Best-effort backfill into profile_photos so future queries find it
        void supabase.from("profile_photos").insert({
          user_id: u.user.id,
          path: prof.photo_path,
          position: 0,
          is_primary: true,
        });

        return [
          {
            id: "legacy-portrait",
            user_id: u.user.id,
            path: prof.photo_path,
            position: 0,
            is_primary: true,
            created_at: new Date().toISOString(),
          },
        ] as GalleryPhoto[];
      }

      return [] as GalleryPhoto[];
    },
  });
}

/** Any visible gallery rows for a member (viewer-permission check is enforced by RLS). */
export function useMemberGallery(userId: string | null | undefined, fallbackPath?: string | null) {
  return useQuery({
    queryKey: [...GALLERY_QUERY_KEY, "member", userId, fallbackPath],
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

      if (error) {
        console.warn("Could not fetch member gallery:", error);
      }

      const photos = (data ?? []) as GalleryPhoto[];
      if (photos.length > 0) {
        return photos;
      }

      if (fallbackPath) {
        return [
          {
            id: "portrait",
            user_id: userId,
            path: fallbackPath,
            position: 0,
            is_primary: true,
            created_at: new Date().toISOString(),
          },
        ] as GalleryPhoto[];
      }

      return [] as GalleryPhoto[];
    },
  });
}

/** Upload one photograph: object first, tracked row second. */
export function useUploadGalleryPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      // 1. Validate file format and size
      assertGalleryFile(file);

      // 2. Auth check
      const { data: u, error: userErr } = await supabase.auth.getUser();
      if (userErr || !u.user) throw new Error("Sign in again to add photographs.");

      // 3. Query existing rows from database directly
      const { data: existingPhotos, error: fetchErr } = await supabase
        .from("profile_photos")
        .select("id, is_primary, position")
        .eq("user_id", u.user.id)
        .order("position", { ascending: true });

      if (fetchErr) {
        console.warn("Could not query existing profile_photos:", fetchErr);
      }

      const existingList = existingPhotos ?? [];
      if (existingList.length >= MAX_GALLERY_PHOTOS) {
        throw new Error(
          `You have reached the maximum limit of ${MAX_GALLERY_PHOTOS} photographs. Please delete an existing photograph first.`,
        );
      }

      const hasPrimary = existingList.some((p) => p.is_primary);
      const isPrimary = existingList.length === 0 || !hasPrimary;
      const position = existingList.length;

      // 4. Compress & optimize photograph
      const processed = await compressPhotograph(file);
      const path = galleryPath(u.user.id, processed);

      // 5. Upload to Supabase Storage
      const { error: upError } = await supabase.storage
        .from("profile-photos")
        .upload(path, processed, {
          upsert: true,
          contentType: processed.type || "image/jpeg",
        });

      if (upError) {
        throw new Error(formatErrorMessage(upError));
      }

      // 6. Direct sync to profiles.photo_path if this is the primary portrait
      if (isPrimary) {
        const { error: profSyncErr } = await supabase
          .from("profiles")
          .update({ photo_path: path, updated_at: new Date().toISOString() })
          .eq("id", u.user.id);

        if (profSyncErr) {
          console.warn("Could not update profiles.photo_path directly:", profSyncErr);
        }
      }

      // 7. Insert row in profile_photos
      const { error: rowError } = await supabase.from("profile_photos").insert({
        user_id: u.user.id,
        path,
        position,
        is_primary: isPrimary,
      });

      if (rowError) {
        // If unique index conflict occurred, retry inserting as secondary
        const isOnePrimaryViolation =
          rowError.code === "23505" ||
          rowError.message?.includes("idx_profile_photos_one_primary") ||
          rowError.message?.includes("one_primary");

        if (isPrimary && isOnePrimaryViolation) {
          const { error: retryError } = await supabase.from("profile_photos").insert({
            user_id: u.user.id,
            path,
            position,
            is_primary: false,
          });

          if (!retryError) {
            return path;
          }
        }

        // Format clean error message
        const formattedErr = formatErrorMessage(rowError);

        // Clean up storage object only if not saved as profile photo
        if (!isPrimary) {
          await supabase.storage
            .from("profile-photos")
            .remove([path])
            .catch(() => undefined);
        }

        throw new Error(formattedErr);
      }

      return path;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
      toast.success("Photograph added to your gallery.");
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : formatErrorMessage(e);
      toast.error(msg);
    },
  });
}

/** Promote a gallery row to primary — syncs profiles.photo_path
 *  and unsets previous primaries safely without index conflicts. */
export function useSetPrimaryPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photo: GalleryPhoto) => {
      const { data: u, error: userErr } = await supabase.auth.getUser();
      if (userErr || !u.user) throw new Error("Sign in again to manage photographs.");

      // 1. Direct update to profiles.photo_path
      const { error: profError } = await supabase
        .from("profiles")
        .update({ photo_path: photo.path, updated_at: new Date().toISOString() })
        .eq("id", u.user.id);

      if (profError) {
        console.warn("Could not update profiles.photo_path directly:", profError);
      }

      // 2. Unset other primaries first to prevent unique constraint conflicts
      const { error: unsetError } = await supabase
        .from("profile_photos")
        .update({ is_primary: false })
        .eq("user_id", u.user.id)
        .neq("id", photo.id);

      if (unsetError) {
        console.warn("Could not unset previous primaries:", unsetError);
      }

      // 3. Mark selected photo as primary
      const { error } = await supabase
        .from("profile_photos")
        .update({ is_primary: true })
        .eq("id", photo.id);

      if (error) throw new Error(formatErrorMessage(error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
      toast.success("Primary photograph updated.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : formatErrorMessage(e)),
  });
}

/** Delete a photograph: row first, storage object second.
 *  If primary is deleted, automatically promotes the next photo. */
export function useDeleteGalleryPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photo: GalleryPhoto) => {
      const { data: u, error: userErr } = await supabase.auth.getUser();
      if (userErr || !u.user) throw new Error("Sign in again to manage photographs.");

      const { error: rowError } = await supabase
        .from("profile_photos")
        .delete()
        .eq("id", photo.id)
        .eq("user_id", u.user.id);

      if (rowError) throw new Error(formatErrorMessage(rowError));

      const { error: objError } = await supabase.storage
        .from("profile-photos")
        .remove([photo.path]);

      if (objError) {
        console.warn("Storage removal warning:", objError);
      }

      // If deleted photo was primary, ensure next photo is promoted
      if (photo.is_primary) {
        const { data: remaining } = await supabase
          .from("profile_photos")
          .select("id, path")
          .eq("user_id", u.user.id)
          .order("position", { ascending: true })
          .limit(1);

        if (remaining && remaining.length > 0 && remaining[0]) {
          const next = remaining[0];
          await supabase.from("profile_photos").update({ is_primary: true }).eq("id", next.id);
          await supabase
            .from("profiles")
            .update({ photo_path: next.path, updated_at: new Date().toISOString() })
            .eq("id", u.user.id);
        } else {
          await supabase
            .from("profiles")
            .update({ photo_path: null, updated_at: new Date().toISOString() })
            .eq("id", u.user.id);
        }
      }

      // Best effort: re-index positions
      const { data: allRemaining } = await supabase
        .from("profile_photos")
        .select("id")
        .eq("user_id", u.user.id)
        .order("position", { ascending: true });

      if (allRemaining && allRemaining.length > 0) {
        await Promise.all(
          allRemaining.map((p, i) =>
            supabase.from("profile_photos").update({ position: i }).eq("id", p.id),
          ),
        ).catch(() => undefined);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
      toast.success("Photograph deleted.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : formatErrorMessage(e)),
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
      if (e1) throw new Error(formatErrorMessage(e1));

      const { error: e2 } = await supabase
        .from("profile_photos")
        .update({ position: from })
        .eq("id", b.id);
      if (e2) throw new Error(formatErrorMessage(e2));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : formatErrorMessage(e)),
  });
}
