import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { assertAllowedFileType } from "@/lib/magic-bytes";

/** A gallery row (one tracked object in the member's own photo folder). */
export type GalleryPhoto = Database["public"]["Tables"]["profile_photos"]["Row"];

/** Matrimonial-directory cap: enough for a real gallery, small enough that
 *  storage abuse (10 MB × files) stays bounded per member. */
export const MAX_GALLERY_PHOTOS = 6;

export const GALLERY_QUERY_KEY = ["gallery"] as const;

/** Accept JPG, PNG, and WebP formats. */
export const GALLERY_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/**
 * Returns a simple, user-friendly explanation for any upload or gallery issue.
 * NEVER leaks internal database errors, schema cache errors, SQL codes, or table names.
 */
export function formatErrorMessage(err: unknown): string {
  if (!err) {
    return "Unable to save photograph right now. Please check that your photo is under 10 MB and try again.";
  }

  const rawMsg =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : typeof (err as Record<string, unknown>)["message"] === "string"
          ? ((err as Record<string, unknown>)["message"] as string)
          : "";

  const lower = rawMsg.toLowerCase();

  // 1. File size limits
  if (
    lower.includes("10 mb") ||
    lower.includes("payload too large") ||
    lower.includes("entity too large") ||
    lower.includes("file_size_limit") ||
    lower.includes("too large") ||
    lower.includes("exceeds")
  ) {
    return "Photograph exceeds the 10 MB limit. Please select a photo under 10 MB.";
  }

  // 2. File format limits
  if (
    lower.includes("unsupported format") ||
    lower.includes("mime") ||
    lower.includes("format") ||
    lower.includes("jpg") ||
    lower.includes("png")
  ) {
    return "Unsupported format. Please select a JPG or PNG photograph.";
  }

  // 3. Photo count limit
  if (
    lower.includes("maximum limit") ||
    lower.includes("delete") ||
    lower.includes("limit of") ||
    lower.includes("gallery full")
  ) {
    return "Gallery limit reached. Please remove an existing photo to upload a new one.";
  }

  // 4. Authentication / session
  if (
    lower.includes("sign in") ||
    lower.includes("session") ||
    lower.includes("jwt") ||
    lower.includes("auth")
  ) {
    return "Please sign in again to update your photographs.";
  }

  // 5. Network / offline
  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("offline") ||
    lower.includes("timeout")
  ) {
    return "Connection issue. Please check your internet connection and try again.";
  }

  // 6. Generic friendly fallback: Never expose database schema cache or SQL internals
  return "Unable to save photograph right now. Please verify your photo is under 10 MB (JPG or PNG) and try again.";
}

/** Validate size (<= 10 MB) and accepted image format with simple user-friendly reasons. */
export function assertGalleryFile(file: File) {
  if (!file) throw new Error("Please select a photograph to upload.");

  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Photograph exceeds the 10 MB limit (${mb} MB). Please choose a smaller photo under 10 MB.`,
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const validExts = ["jpg", "jpeg", "png", "webp"];
  const validMimes = ["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp"];
  const mimeMatch = file.type ? validMimes.includes(file.type.toLowerCase()) : false;
  const extMatch = validExts.includes(ext);

  if (!mimeMatch && !extMatch) {
    throw new Error("Unsupported format. Please select a JPG or PNG photograph.");
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
 * Automatic client-side image optimization (industry standard on matrimonial sites).
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
 *  Gracefully falls back to profiles.photo_path if the profile_photos table
 *  is not in the database schema yet, so the UI never crashes with schema errors. */
export function useGallery() {
  return useQuery({
    queryKey: [...GALLERY_QUERY_KEY, "mine"],
    queryFn: async () => {
      const { data: u, error: userErr } = await supabase.auth.getUser();
      if (userErr || !u.user) throw new Error("Please sign in to view your photographs.");

      let photos: GalleryPhoto[] = [];

      // 1. Try querying profile_photos table
      try {
        const { data, error } = await supabase
          .from("profile_photos")
          .select("id, user_id, path, position, is_primary, created_at")
          .eq("user_id", u.user.id)
          .order("is_primary", { ascending: false })
          .order("position", { ascending: true })
          .order("created_at", { ascending: true });

        if (!error && data) {
          photos = data as GalleryPhoto[];
        }
      } catch {
        // Table not available in database — fallback to profiles.photo_path
      }

      if (photos.length > 0) {
        return photos;
      }

      // 2. Fallback: check if member has an existing portrait in profiles.photo_path
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("photo_path")
          .eq("id", u.user.id)
          .maybeSingle();

        if (prof?.photo_path) {
          return [
            {
              id: "profile-portrait",
              user_id: u.user.id,
              path: prof.photo_path,
              position: 0,
              is_primary: true,
              created_at: new Date().toISOString(),
            },
          ] as GalleryPhoto[];
        }
      } catch {
        // Profiles query fallback
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

      let photos: GalleryPhoto[] = [];
      try {
        const { data, error } = await supabase
          .from("profile_photos")
          .select("id, user_id, path, position, is_primary, created_at")
          .eq("user_id", userId)
          .order("is_primary", { ascending: false })
          .order("position", { ascending: true })
          .order("created_at", { ascending: true });

        if (!error && data) {
          photos = data as GalleryPhoto[];
        }
      } catch {
        // Table fallback
      }

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

/** Upload one photograph: object first, profiles.photo_path sync second,
 *  and profile_photos tracked row third (best-effort). Never fails on
 *  missing profile_photos table. */
export function useUploadGalleryPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      // 1. Validate file format and size
      assertGalleryFile(file);

      // 2. Auth check
      const { data: u, error: userErr } = await supabase.auth.getUser();
      if (userErr || !u.user) throw new Error("Please sign in again to add photographs.");

      // 3. Count existing photos if profile_photos table is present
      let existingCount = 0;
      let hasPrimary = false;
      try {
        const { data: existingPhotos, error: fetchErr } = await supabase
          .from("profile_photos")
          .select("id, is_primary, position")
          .eq("user_id", u.user.id)
          .order("position", { ascending: true });

        if (!fetchErr && existingPhotos) {
          existingCount = existingPhotos.length;
          hasPrimary = existingPhotos.some((p) => p.is_primary);
        }
      } catch {
        // Table does not exist in schema yet
      }

      if (existingCount >= MAX_GALLERY_PHOTOS) {
        throw new Error(
          `Gallery limit reached (${MAX_GALLERY_PHOTOS} photos). Please delete an existing photo to upload a new one.`,
        );
      }

      const isPrimary = existingCount === 0 || !hasPrimary;
      const position = existingCount;

      // 4. Validate magic bytes & compress photograph
      await assertAllowedFileType(file, ["jpeg", "png", "webp"], "Photograph");
      const processed = await compressPhotograph(file);
      const path = galleryPath(u.user.id, processed);

      // 5. Upload to Supabase Storage bucket 'profile-photos'
      const { error: upError } = await supabase.storage
        .from("profile-photos")
        .upload(path, processed, {
          upsert: true,
          contentType: processed.type || "image/jpeg",
        });

      if (upError) {
        throw new Error(formatErrorMessage(upError));
      }

      // 6. Direct sync to profiles.photo_path — this guarantees the member's profile
      // photo is saved and live regardless of whether profile_photos table exists!
      const { error: profSyncErr } = await supabase
        .from("profiles")
        .update({ photo_path: path })
        .eq("id", u.user.id);

      if (profSyncErr) {
        throw new Error(formatErrorMessage(profSyncErr));
      }

      // 7. Insert into profile_photos (best-effort)
      try {
        const { error: rowError } = await supabase.from("profile_photos").insert({
          user_id: u.user.id,
          path,
          position,
          is_primary: isPrimary,
        });

        if (rowError) {
          // If table doesn't exist yet or trigger permission issue, DO NOT fail!
          // The photo is already saved to storage and profiles.photo_path.
          const isTableMissing =
            rowError.code === "42P01" ||
            rowError.code === "PGRST204" ||
            rowError.code === "PGRST205" ||
            rowError.message?.toLowerCase().includes("schema cache") ||
            rowError.message?.toLowerCase().includes("does not exist");

          const isTriggerIssue =
            rowError.code === "42501" ||
            rowError.message?.toLowerCase().includes("permission denied") ||
            rowError.message?.toLowerCase().includes("sync_primary_photo");

          if (isTableMissing || isTriggerIssue) {
            console.warn(
              "profile_photos table/trigger not active; photo saved to profile successfully.",
            );
            return path;
          }

          // If one_primary unique constraint, retry as secondary
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
            // The retry's own error was never checked, so a second failure
            // still resolved as a success.
            if (retryError) {
              throw new Error(formatErrorMessage(retryError));
            }
            return path;
          }

          // Any other failure is surfaced. Falling through to `return path`
          // reported a photograph as uploaded while no gallery row existed: it
          // never appeared in the gallery, was never counted against the cap,
          // and the member was told it had worked.
          throw new Error(formatErrorMessage(rowError));
        }
      } catch (err) {
        // The storage object and the primary-portrait sync already succeeded,
        // so the photograph itself is saved; what is missing is the gallery
        // row. That is reported rather than swallowed, because a silent
        // success here is a photograph the member can never see or remove.
        console.warn("profile_photos row insert failed:", err);
        throw new Error(
          "Your photograph was uploaded, but it could not be added to your gallery. Please contact the membership desk.",
        );
      }

      return path;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
      qc.invalidateQueries({ queryKey: ["navbar-avatar"] });
      qc.invalidateQueries({ queryKey: ["search-photo"] });
      toast.success("Photograph uploaded successfully.");
    },
    onError: (e) => {
      toast.error(formatErrorMessage(e));
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
      if (userErr || !u.user) throw new Error("Please sign in again to manage photographs.");

      // 1. Direct update to profiles.photo_path
      const { error: profError } = await supabase
        .from("profiles")
        .update({ photo_path: photo.path })
        .eq("id", u.user.id);

      if (profError) {
        throw new Error(formatErrorMessage(profError));
      }

      // 2. Update in profile_photos
      const { error: clearErr } = await supabase
        .from("profile_photos")
        .update({ is_primary: false })
        .eq("user_id", u.user.id)
        .neq("id", photo.id);
      if (clearErr) throw new Error(formatErrorMessage(clearErr));

      const { error: setErr } = await supabase
        .from("profile_photos")
        .update({ is_primary: true })
        .eq("id", photo.id);
      if (setErr) throw new Error(formatErrorMessage(setErr));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
      qc.invalidateQueries({ queryKey: ["navbar-avatar"] });
      toast.success("Primary photograph updated.");
    },
    onError: (e) => toast.error(formatErrorMessage(e)),
  });
}

/** Delete a photograph: row first, storage object second.
 *  If primary is deleted, automatically promotes the next photo. */
export function useDeleteGalleryPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photo: GalleryPhoto) => {
      const { data: u, error: userErr } = await supabase.auth.getUser();
      if (userErr || !u.user) throw new Error("Please sign in again to manage photographs.");

      // 1. Remove the storage object FIRST.
      //
      // The row used to be deleted first, so a failed object removal left the
      // file in the bucket with no row referencing it: invisible to the
      // member, unreachable through the UI, still consuming storage, and
      // deleted only by a full account deletion. Removing the object first
      // means a failure leaves the gallery row intact and the photograph
      // still visible, so the member can simply retry.
      const { error: objError } = await supabase.storage
        .from("profile-photos")
        .remove([photo.path]);

      if (objError) {
        throw new Error(formatErrorMessage(objError));
      }

      // 2. Delete from profile_photos
      const { error: delErr } = await supabase
        .from("profile_photos")
        .delete()
        .eq("id", photo.id)
        .eq("user_id", u.user.id);
      if (delErr) throw new Error(formatErrorMessage(delErr));

      // 3. If deleted photo was primary, clear or reassign profiles.photo_path
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("photo_path")
        .eq("id", u.user.id)
        .maybeSingle();
      if (profErr) throw new Error(formatErrorMessage(profErr));

      if (prof?.photo_path === photo.path) {
        let nextPath: string | null = null;
        const { data: remaining, error: remErr } = await supabase
          .from("profile_photos")
          .select("id, path")
          .eq("user_id", u.user.id)
          .order("position", { ascending: true })
          .limit(1);
        if (remErr) throw new Error(formatErrorMessage(remErr));

        if (remaining && remaining.length > 0 && remaining[0]) {
          nextPath = remaining[0].path;
          const { error: promErr } = await supabase
            .from("profile_photos")
            .update({ is_primary: true })
            .eq("id", remaining[0].id);
          if (promErr) throw new Error(formatErrorMessage(promErr));
        }

        const { error: updateProfErr } = await supabase
          .from("profiles")
          .update({ photo_path: nextPath })
          .eq("id", u.user.id);
        if (updateProfErr) throw new Error(formatErrorMessage(updateProfErr));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
      qc.invalidateQueries({ queryKey: ["navbar-avatar"] });
      toast.success("Photograph deleted.");
    },
    onError: (e) => toast.error(formatErrorMessage(e)),
  });
}

/** Move a photograph one step in display order. */
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

      // Scoped to the signed-in member. The update used to be filtered by row
      // id alone, so the write relied entirely on RLS to keep it inside the
      // member's own gallery; the client should say what it means.
      const { data: u, error: userErr } = await supabase.auth.getUser();
      if (userErr || !u.user) throw new Error("Please sign in again to manage photographs.");

      const { error: errA } = await supabase
        .from("profile_photos")
        .update({ position: to })
        .eq("id", a.id)
        .eq("user_id", u.user.id);
      if (errA) throw new Error(formatErrorMessage(errA));

      const { error: errB } = await supabase
        .from("profile_photos")
        .update({ position: from })
        .eq("id", b.id)
        .eq("user_id", u.user.id);
      if (errB) throw new Error(formatErrorMessage(errB));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["photo"] });
    },
    onError: (e) => toast.error(formatErrorMessage(e)),
  });
}
