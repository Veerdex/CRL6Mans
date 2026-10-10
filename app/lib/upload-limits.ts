// Upload limits, as a pure leaf with no "server-only" marker — the server
// validators in uploads.ts and the client forms that pick the file both need
// these numbers, and uploads.ts cannot be imported into a client component.
//
// The ceiling is the platform's, not ours: a Vercel Function rejects any
// request body over 4.5 MB with 413 FUNCTION_PAYLOAD_TOO_LARGE before the
// handler runs, so `serverActions.bodySizeLimit` in next.config.ts (5mb) never
// actually binds in production. Checking the size server-side is therefore
// unreachable for an oversized file — the request never arrives — which is why
// every form has to check it in the browser before submitting.
//
// 4 MB rather than 4.5: the limit is on the whole multipart body, so the other
// form fields and the encoding overhead count against it too.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "4 MB";

// Raster only. SVG is excluded deliberately — it can carry embedded <script>,
// and these files land in public Supabase buckets. Mirrors IMAGE_TYPES in
// uploads.ts; the drop zones list this so they stop promising SVG.
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif", "gif"];
export const DOCUMENT_EXTENSIONS = [...IMAGE_EXTENSIONS, "pdf"];

// Not phrased as "wrong file type" anywhere: an iPhone photo copied off a
// desktop keeps its HEIC container, and a flat rejection gives no way out.
export const HEIC_MESSAGE =
  "iPhone HEIC photos aren't supported. Screenshot the photo and upload that, " +
  "or switch Settings → Camera → Formats to \"Most Compatible\" and retake it.";

export function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileExtension(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export function isHeicName(name: string): boolean {
  return /\.(heic|heif)$/i.test(name);
}

// Shared browser-side gate. Returns the message to show, or null to accept.
// Checked by extension rather than file.type: browsers report an empty type for
// a .pdf with no registered handler, and rejecting on that would refuse a file
// the server would have taken. The magic-byte check in uploads.ts stays the
// real authority — this only has to stop a request that cannot be delivered.
export function checkUploadFile(
  file: File,
  allowed: string[] = IMAGE_EXTENSIONS
): string | null {
  if (isHeicName(file.name) || /^image\/hei[cf]$/i.test(file.type)) return HEIC_MESSAGE;

  const ext = fileExtension(file.name);
  if (!allowed.includes(ext)) {
    const names = allowed.map((e) => e.toUpperCase()).join(", ");
    return `Unsupported file type. Use one of: ${names}.`;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${formatBytes(file.size)}. It must be ${MAX_UPLOAD_LABEL} or smaller — try compressing it or saving it as a JPG.`;
  }

  return null;
}
