import "server-only";

// Raster image types only. SVG is intentionally excluded — it can carry
// embedded <script>, and these files land in public Supabase buckets.
const IMAGE_TYPES: Record<string, string> = {
  "image/png":  "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif":  "gif",
};

// Enrollment proof only. The registration form asks for a student ID *or a
// class schedule*, and a schedule is usually a PDF; the admin card renders the
// proof as a link rather than an <img>, so a PDF reviews just as well. Team
// logos must stay images, which is why this is a separate allowlist and not a
// widening of IMAGE_TYPES.
const DOCUMENT_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  "application/pdf": "pdf",
};

const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
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
    case "application/pdf":
      return header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
    default:
      return false;
  }
}

/**
 * Browsers do not always report a type. A .pdf on a Windows machine with no
 * PDF handler registered, and a .heic on several browsers, both arrive as "".
 * Fall back to the extension in that case — the magic-byte check below is the
 * real authority either way, so a lie here is caught, not trusted.
 */
function resolveType(file: File, allowed: Record<string, string>): string | null {
  const declared = file.type?.toLowerCase() ?? "";
  if (declared) return allowed[declared] ? declared : null;

  const ext = file.name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const guessed = ext ? TYPE_BY_EXT[ext] : undefined;
  return guessed && allowed[guessed] ? guessed : null;
}

function isHeic(file: File): boolean {
  const declared = file.type?.toLowerCase() ?? "";
  if (declared === "image/heic" || declared === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name ?? "");
}

export type UploadResult =
  | { ext: string; contentType: string; bytes: ArrayBuffer }
  | { error: string };

// Not thrown at the user as-is anywhere else: an iPhone photo copied off a
// desktop keeps its HEIC container, and "wrong file type" gives no way out.
export const HEIC_MESSAGE =
  "iPhone HEIC photos aren't supported. Screenshot the photo and upload that, " +
  "or switch Settings → Camera → Formats to \"Most Compatible\" and retake it.";

async function validateUpload(
  file: File,
  allowed: Record<string, string>,
  rejectMessage: string
): Promise<UploadResult> {
  if (isHeic(file)) return { error: HEIC_MESSAGE };

  const type = resolveType(file, allowed);
  if (!type) return { error: rejectMessage };
  if (file.size > MAX_IMAGE_BYTES) return { error: "File must be 5 MB or smaller." };

  const bytes = await file.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  if (!checkMagicBytes(header, type)) {
    return { error: "File content does not match its file type." };
  }

  return { ext: allowed[type], contentType: type, bytes };
}

export function validateImageUpload(file: File): Promise<UploadResult> {
  return validateUpload(file, IMAGE_TYPES, "Only PNG, JPG, WEBP, or GIF images are allowed.");
}

export function validateDocumentUpload(file: File): Promise<UploadResult> {
  return validateUpload(file, DOCUMENT_TYPES, "Only PNG, JPG, WEBP, GIF, or PDF files are allowed.");
}
