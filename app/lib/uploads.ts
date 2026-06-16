import "server-only";

// Raster image types only. SVG is intentionally excluded — it can carry
// embedded <script>, and these files land in public Supabase buckets.
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png":  "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif":  "gif",
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Validate an uploaded image against a content-type allow-list and size cap.
 * Returns a server-derived extension so the stored filename never trusts the
 * user-supplied filename. `contentType` is the MIME to persist.
 */
export function validateImageUpload(
  file: File
): { ext: string; contentType: string } | { error: string } {
  const type = file.type?.toLowerCase() ?? "";
  const ext = ALLOWED_IMAGE_TYPES[type];
  if (!ext) {
    return { error: "Only PNG, JPG, WEBP, or GIF images are allowed." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: "Image must be 8 MB or smaller." };
  }
  return { ext, contentType: type };
}
