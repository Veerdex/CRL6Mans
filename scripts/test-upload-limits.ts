import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, HEIC_MESSAGE,
  IMAGE_EXTENSIONS, DOCUMENT_EXTENSIONS, IMAGE_TYPES, DOCUMENT_TYPES,
  checkUploadFile, formatBytes, fileExtension, isHeicFile, resolveUploadType,
} from "../app/lib/upload-limits";

// A File of a given size without allocating the bytes twice.
function fileOf(bytes: number, name: string, type = ""): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

// The platform ceiling, from vercel.com/docs/functions/limitations: a Vercel
// Function 413s any request body over this before the handler runs. Our limit
// must sit under it with room for the rest of the multipart body, or an
// oversized file throws out of the server action instead of being rejected —
// which is the bug this module exists to prevent.
const VERCEL_BODY_CAP = 4.5 * 1024 * 1024;

test("the limit stays under Vercel's request body cap", () => {
  assert.ok(MAX_UPLOAD_BYTES < VERCEL_BODY_CAP,
    `${MAX_UPLOAD_BYTES} must be below the ${VERCEL_BODY_CAP} byte cap`);
  // enough headroom for the other form fields and multipart encoding
  assert.ok(VERCEL_BODY_CAP - MAX_UPLOAD_BYTES >= 256 * 1024,
    "leave at least 256 KB for the rest of the body");
});

test("accepts a file at the limit and rejects one byte over", () => {
  assert.equal(checkUploadFile(fileOf(MAX_UPLOAD_BYTES, "logo.png", "image/png")), null);

  const over = checkUploadFile(fileOf(MAX_UPLOAD_BYTES + 1, "logo.png", "image/png"));
  assert.ok(over, "one byte over the limit must be rejected");
  assert.ok(over.includes(MAX_UPLOAD_LABEL), `message should name the limit: ${over}`);
});

test("the oversize message names the file's own size", () => {
  const msg = checkUploadFile(fileOf(6 * 1024 * 1024, "huge.png", "image/png"));
  assert.ok(msg?.includes("6.0 MB"), `message should state the actual size: ${msg}`);
});

test("HEIC is caught by extension and by type, with the way-out message", () => {
  assert.equal(checkUploadFile(fileOf(10, "photo.heic")), HEIC_MESSAGE);
  assert.equal(checkUploadFile(fileOf(10, "photo.HEIF")), HEIC_MESSAGE);
  assert.equal(checkUploadFile(fileOf(10, "photo", "image/heic")), HEIC_MESSAGE);
  // an oversized HEIC still gets the HEIC message — the format is the blocker
  assert.equal(checkUploadFile(fileOf(MAX_UPLOAD_BYTES + 1, "big.heic")), HEIC_MESSAGE);
});

test("SVG is rejected for images, since the drop zone used to promise it", () => {
  const msg = checkUploadFile(fileOf(10, "logo.svg", "image/svg+xml"));
  assert.ok(msg && !msg.includes(MAX_UPLOAD_LABEL), "SVG is a type rejection, not a size one");
  assert.ok(!IMAGE_EXTENSIONS.includes("svg"));
});

test("every accepted extension passes, and PDF only for documents", () => {
  for (const ext of IMAGE_EXTENSIONS) {
    assert.equal(checkUploadFile(fileOf(10, `logo.${ext}`)), null, `image .${ext}`);
  }
  assert.ok(checkUploadFile(fileOf(10, "proof.pdf")), "PDF is not an image");
  assert.equal(checkUploadFile(fileOf(10, "proof.pdf"), DOCUMENT_TYPES), null);
  // a browser reporting no type at all must not be rejected on that alone
  assert.equal(checkUploadFile(fileOf(10, "proof.pdf", ""), DOCUMENT_TYPES), null);
  assert.deepEqual(DOCUMENT_EXTENSIONS, [...IMAGE_EXTENSIONS, "pdf"]);
});

// The gate exists to stop a request the platform would refuse to deliver. One
// that is *stricter* than the server is its own bug: it refuses a file that
// would have uploaded fine. Both sides call resolveUploadType for exactly this.
test("the browser gate accepts whatever the server would accept", () => {
  // Windows Chrome writes web JPEGs as .jfif with type image/jpeg. The
  // extension is unknown to us; the declared type is not, and it wins.
  assert.equal(checkUploadFile(fileOf(10, "logo.jfif", "image/jpeg")), null);
  // A gallery or screenshot pick can arrive with no extension at all.
  assert.equal(checkUploadFile(fileOf(10, "screenshot", "image/png")), null);
  // Nothing to go on from either side — reject rather than send a 413's worth
  // of bytes at a validator that will reject it too.
  assert.ok(checkUploadFile(fileOf(10, "screenshot", "")));
  // A declared type outside the allowlist is still a rejection, extension or no.
  assert.ok(checkUploadFile(fileOf(10, "logo.svg", "image/svg+xml")));
  assert.ok(checkUploadFile(fileOf(10, "logo.png", "image/svg+xml")),
    "a declared type that is not allowed must not be rescued by the extension");
});

test("resolveUploadType returns the type the server will store under", () => {
  assert.equal(resolveUploadType({ name: "a.jfif", type: "image/jpeg" }, IMAGE_TYPES), "image/jpeg");
  assert.equal(resolveUploadType({ name: "a.JPG", type: "" }, IMAGE_TYPES), "image/jpeg");
  assert.equal(resolveUploadType({ name: "a.pdf", type: "" }, IMAGE_TYPES), null);
  assert.equal(resolveUploadType({ name: "a.pdf", type: "" }, DOCUMENT_TYPES), "application/pdf");
});

test("helpers", () => {
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
  assert.equal(formatBytes(MAX_UPLOAD_BYTES), "4.0 MB");
  assert.equal(MAX_UPLOAD_LABEL, formatBytes(MAX_UPLOAD_BYTES).replace(".0", ""));
  assert.equal(fileExtension("screenshot"), "");
  assert.equal(fileExtension("a.b.PNG"), "png");
  assert.ok(isHeicFile({ name: "x.heic" }) && isHeicFile({ name: "x.HEIF" }));
  assert.ok(isHeicFile({ name: "x", type: "image/heif" }));
  assert.ok(!isHeicFile({ name: "x.png", type: "image/png" }));
});
