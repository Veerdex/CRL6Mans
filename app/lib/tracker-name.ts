/**
 * Canonical key for matching a replay player name against a resolved tracker name.
 * Unicode NFKC normalization collapses visually-identical but distinct codepoints into
 * one form — e.g. the micro sign "µ" (U+00B5) and Greek mu "μ" (U+03BC), full-width
 * characters, and ligatures — so names with such symbols still match. Then lowercases
 * and trims surrounding whitespace.
 */
export function normalizeName(name: string): string {
  return name.normalize("NFKC").toLowerCase().trim();
}

export function extractTrackerName(trackerUrl: string): string | null {
  const m = trackerUrl.match(/\/profile\/(epic|xbl|psn)\/([^/?#]+)/i);
  if (!m) return null;
  try {
    // Decode up to twice — some tracker URLs have double-encoded characters
    // (e.g. %2520 → %20 → space, or %C2%B5 → µ).
    let name = decodeURIComponent(m[2]);
    if (name.includes("%")) name = decodeURIComponent(name);
    return name;
  } catch {
    return null;
  }
}

export async function resolveTrackerName(trackerUrl: string): Promise<string | null> {
  const direct = extractTrackerName(trackerUrl);
  if (direct) return direct;

  const steamM = trackerUrl.match(/\/profile\/steam\/(\d{15,20})/i);
  if (!steamM) return null;

  try {
    const res = await fetch(
      `https://steamcommunity.com/profiles/${steamM[1]}?xml=1`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return null;
    const xml = await res.text();
    const nameM = xml.match(/<steamID><!\[CDATA\[([^\]]+)\]\]><\/steamID>/);
    return nameM ? nameM[1] : null;
  } catch {
    return null;
  }
}
