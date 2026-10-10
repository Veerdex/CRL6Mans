import "server-only";

// The allowlists, the limit and the type resolution live in upload-limits.ts
// so the browser forms gate on exactly what this validator will accept — a
// client check that is stricter refuses files the server would have taken.
import {
  DOCUMENT_TYPES, HEIC_MESSAGE, IMAGE_TYPES, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL,
  isHeicFile, resolveUploadType,
} from "./upload-limits";

export { HEIC_MESSAGE };

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

export type UploadResult =
  | { ext: string; contentType: string; bytes: ArrayBuffer }
  | { error: string };

async function validateUpload(
  file: File,
  allowed: Record<string, string>,
  rejectMessage: string
): Promise<UploadResult> {
  if (isHeicFile(file)) return { error: HEIC_MESSAGE };

  const type = resolveUploadType(file, allowed);
  if (!type) return { error: rejectMessage };

  // A backstop, not the gate. Vercel 413s a body over 4.5 MB before this
  // handler is ever entered, so an oversized file never reaches here — the
  // browser has to reject it first (checkUploadFile in upload-limits.ts). This
  // still runs for a caller that is not one of those forms.
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
