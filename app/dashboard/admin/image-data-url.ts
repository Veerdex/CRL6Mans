// @react-pdf/renderer (and, separately, the archive JSON export) can only
// embed images as data URIs — a live storage URL can 404 later (bucket
// cleanup, team deleted) and break a document meant to be kept indefinitely.
// Resolve a logo to a safe data URL client-side and drop it if unfetchable or
// an unsupported format, so one bad logo never sinks the whole export.
export async function toSafeDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.type !== "image/png" && blob.type !== "image/jpeg" && blob.type !== "image/jpg") return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
