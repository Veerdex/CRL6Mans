// Upload limits and type resolution, as a pure leaf with no "server-only"
// marker — the server validators in uploads.ts and the client forms that pick
// the file both need these, and uploads.ts cannot be imported into a form.
//
// The size ceiling is the platform's, not ours: a Vercel Function rejects any
// request body over 4.5 MB with 413 FUNCTION_PAYLOAD_TOO_LARGE before the
// handler runs, so `serverActions.bodySizeLimit` in next.config.ts (5mb) never
// actually binds in production. Checking the size server-side is therefore
// unreachable for an oversized file — the request never arrives — which is why
// every form has to check it in the browser before submitting.
//
// Sizes here are MiB, which is what Windows Explorer shows under the label
// "MB". Quoting a file's size in decimal MB would tell a player their 3.9 MB
// file is 4.1 MB. Both limits are compared against the smaller reading of the
// docs' 4.5 MB (4,500,000), so the units can't push one over the real cap.
//
// 4 rather than 4.5: the limit is on the whole multipart body, so the other form
// fields and the encoding overhead count against it too. An image can afford
// that slack — 4 MB is already absurd for a 96px crest, and a player can
// re-export a smaller one.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "4 MB";

// A replay gets its own, closer to the cap, because it is not something a player
// can compress or re-export — it is whatever the game wrote. Set here, the only
// replays refused are ones the platform would refuse anyway, so no file that
// uploads today stops working. The four server actions that parse replays all
// carried their own unreachable 5 MB check; they read this now.
export const MAX_REPLAY_BYTES = Math.round(4.2 * 1024 * 1024);
export const MAX_REPLAY_LABEL = "4.2 MB";

// Raster image types only. SVG is intentionally excluded — it can carry
// embedded <script>, and these files land in public Supabase buckets.
export const IMAGE_TYPES: Record<string, string> = {
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
export const DOCUMENT_TYPES: Record<string, string> = {
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

// For the `accept` attribute and the format hints under each input.
export const IMAGE_EXTENSIONS = Object.keys(TYPE_BY_EXT).filter((e) => TYPE_BY_EXT[e] !== "application/pdf");
export const DOCUMENT_EXTENSIONS = Object.keys(TYPE_BY_EXT);

// Not phrased as "wrong file type" anywhere: an iPhone photo copied off a
// desktop keeps its HEIC container, and a flat rejection gives no way out.
export const HEIC_MESSAGE =
  "iPhone HEIC photos aren't supported. Screenshot the photo and upload that, " +
  "or switch Settings → Camera → Formats to \"Most Compatible\" and retake it.";

export function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileExtension(name: string): string {
  return name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export function isHeicFile(file: { name?: string; type?: string }): boolean {
  const declared = file.type?.toLowerCase() ?? "";
  if (declared === "image/heic" || declared === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name ?? "");
}

/**
 * Browsers do not always report a type. A .pdf on a Windows machine with no
 * PDF handler registered, and a .heic on several browsers, both arrive as "".
 * Fall back to the extension in that case — the magic-byte check in uploads.ts
 * is the real authority either way, so a lie here is caught, not trusted.
 *
 * The declared type wins when there is one, which is what lets a .jfif saved
 * as image/jpeg through: Windows Chrome writes web JPEGs that way, and the
 * extension is not in TYPE_BY_EXT. Both the browser gate and the server
 * validator call this, so neither can end up stricter than the other.
 */
export function resolveUploadType(
  file: { name?: string; type?: string },
  allowed: Record<string, string>
): string | null {
  const declared = file.type?.toLowerCase() ?? "";
  if (declared) return allowed[declared] ? declared : null;

  const guessed = TYPE_BY_EXT[fileExtension(file.name ?? "")];
  return guessed && allowed[guessed] ? guessed : null;
}

export const REPLAY_TYPE_MESSAGE =
  "That isn't a .replay file. Rocket League saves them under " +
  "Documents\\My Games\\Rocket League\\TAGame\\Demos.";

// Replays take no allowlist — there is one extension, and the parser in
// replay-parser.ts is the authority on whether the bytes are really a replay.
export function checkReplayFile(file: File): string | null {
  // Lower-cased, like all four server actions. `endsWith(".replay")` — which is
  // what series-replay-panel checked locally — refuses a .REPLAY they accept.
  if (fileExtension(file.name) !== "replay") return REPLAY_TYPE_MESSAGE;

  if (file.size > MAX_REPLAY_BYTES) {
    return `That replay is ${formatBytes(file.size)}. It must be ${MAX_REPLAY_LABEL} or smaller.`;
  }

  return null;
}

// Shared browser-side gate. Returns the message to show, or null to accept.
// This only has to stop a request the platform would refuse to deliver, or one
// the server would reject anyway; the magic-byte check stays the authority.
export function checkUploadFile(
  file: File,
  allowed: Record<string, string> = IMAGE_TYPES
): string | null {
  if (isHeicFile(file)) return HEIC_MESSAGE;

  if (!resolveUploadType(file, allowed)) {
    const names = [...new Set(Object.values(allowed))].map((e) => e.toUpperCase()).join(", ");
    return `Unsupported file type. Use one of: ${names}.`;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${formatBytes(file.size)}. It must be ${MAX_UPLOAD_LABEL} or smaller — try compressing it or saving it as a JPG.`;
  }

  return null;
}
