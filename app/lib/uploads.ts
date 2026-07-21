import "server-only";

// Raster image types only. SVG is intentionally excluded — it can carry
// embedded <script>, and these files land in public Supabase buckets.
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png":  "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif":  "gif",
};

// Must match the bodySizeLimit in next.config.ts so the size error message
// is accurate (the framework enforces 5MB before the handler runs).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function checkMagicBytes(header: Uint8Array, type: string): boolean {
  switch (type) {
    case "image/png":
      return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
    case "image/jpeg":
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    case "image/gif":
      return header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38;
    case "image/webp":
      return (
        header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
        header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50
      );
    default:
      return false;
  }
}

/**
 * Validate an uploaded image against a content-type allow-list, size cap, and
 * magic bytes. Returns the file bytes so callers don't need a second arrayBuffer()
 * call. The stored filename always uses the server-derived extension, never the
 * user-supplied filename.
 */
export async function validateImageUpload(
  file: File
): Promise<{ ext: string; contentType: string; bytes: ArrayBuffer } | { error: string }> {
  const type = file.type?.toLowerCase() ?? "";
  const ext = ALLOWED_IMAGE_TYPES[type];
  if (!ext) return { error: "Only PNG, JPG, WEBP, or GIF images are allowed." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image must be 5 MB or smaller." };

  const bytes = await file.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  if (!checkMagicBytes(header, type)) {
    return { error: "File content does not match the declared image type." };
  }

  return { ext, contentType: type, bytes };
}
