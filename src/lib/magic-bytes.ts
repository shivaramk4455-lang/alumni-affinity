/**
 * Magic byte detection for client-side upload verification.
 * Prevents disguised files (e.g., .exe renamed to .pdf or .jpg) from being uploaded.
 */

export type SupportedFileType = "jpeg" | "png" | "webp" | "pdf";

export async function detectFileTypeFromMagicBytes(
  file: File,
): Promise<SupportedFileType | "unknown"> {
  if (file.size < 4) return "unknown";

  const slice = file.slice(0, 16);
  const buffer = await slice.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  // PDF: 25 50 44 46 (%PDF)
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf";
  }

  // WEBP: RIFF ... WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }

  return "unknown";
}

export async function assertAllowedFileType(
  file: File,
  allowed: SupportedFileType[],
  label = "File",
): Promise<void> {
  const detected = await detectFileTypeFromMagicBytes(file);
  if (detected === "unknown" || !allowed.includes(detected)) {
    throw new Error(
      `${label} format not recognized or unsupported. Permitted formats: ${allowed.join(", ").toUpperCase()}.`,
    );
  }
}
