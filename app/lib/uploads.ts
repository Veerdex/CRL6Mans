import "server-only";

import { HEIC_MESSAGE, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "./upload-limits";

export { HEIC_MESSAGE };

// Raster image types only. SVG is intentionally excluded — it can carry
// embedded <script>, and these files land in public Supabase buckets.
const IMAGE_TYPES: Record<string, string> = {
  "image/png":  "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
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
  avif: "image/avif",
  gif: "image/gif",
  pdf: "application/pdf",
};

// A backstop, not the gate. Vercel 413s a body over 4.5 MB before this handler
// is ever entered, so an oversized file never reaches here — the browser has to
// reject it first (checkUploadFile in upload-limits.ts). This still runs for a
// caller that is not a browser form.

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
    // AVIF and HEIC are the same ISO BMFF container, so "ftyp" alone would let a
    // .heic renamed .avif through the one check that catches a lying extension.
    // The major brand is what separates them: "avif" for a still, "avis" for a
    // sequence. An encoder that writes "mif1" there instead is rejected — rare
    // enough to be worth the certainty about HEIC.
    case "image/avif":
      return (
        header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70 &&
        header[8] === 0x61 && header[9] === 0x76 && header[10] === 0x69 &&
        (header[11] === 0x66 || header[11] === 0x73)
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

async function validateUpload(
  file: File,
  allowed: Record<string, string>,
  rejectMessage: string
): Promise<UploadResult> {
  if (isHeic(file)) return { error: HEIC_MESSAGE };

  const type = resolveType(file, allowed);
  if (!type) return { error: rejectMessage };
  if (file.size > MAX_UPLOAD_BYTES) return { error: `File must be ${MAX_UPLOAD_LABEL} or smaller.` };

  const bytes = await file.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  if (!checkMagicBytes(header, type)) {
    return { error: "File content does not match its file type." };
  }

  return { ext: allowed[type], contentType: type, bytes };
}

export function validateImageUpload(file: File): Promise<UploadResult> {
  return validateUpload(file, IMAGE_TYPES, "Only PNG, JPG, WEBP, AVIF, or GIF images are allowed.");
}

export function validateDocumentUpload(file: File): Promise<UploadResult> {
  return validateUpload(file, DOCUMENT_TYPES, "Only PNG, JPG, WEBP, AVIF, GIF, or PDF files are allowed.");
}
