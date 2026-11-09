// Short team names for dense rows: "Tasselled Wobbegong" → "TW".

const MINOR_WORDS = new Set(["a", "an", "the", "in", "of", "and", "on", "at", "to", "for"]);

function words(name: string): string[] {
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
}

/**
 * One team's abbreviation on its own: the initials of its words, skipping minor
 * ones like "a" and "in" ("3 Pickles In a Pod" → "3PP"), or the first three
 * letters of a one-word name ("Stickless" → "STI"). `extra` lengthens it, for
 * breaking a tie: more of the last word, or more of the one word.
 */
export function teamAbbreviation(name: string, extra = 0): string {
  const all = words(name);
  if (!all.length) return name.trim().slice(0, 3 + extra).toUpperCase();
  const major = all.filter((w) => !MINOR_WORDS.has(w.toLowerCase()));
  const kept = major.length ? major : all;
  if (kept.length === 1) return kept[0].slice(0, 3 + extra).toUpperCase();
  const last = kept[kept.length - 1];
  return (kept.slice(0, -1).map((w) => w[0]).join("") + last.slice(0, 1 + extra)).toUpperCase();
}

/**
 * Abbreviations for a set of teams, unique within it: teams that would share
 * one take more letters until they differ. Every name maps to a result, and the
 * same set gives the same answer whatever order it arrives in.
 */
export function teamAbbreviations(names: Iterable<string>): Map<string, string> {
  const unique = [...new Set(names)].sort();
  const extra = new Map(unique.map((n) => [n, 0]));
  const result = new Map<string, string>();

  for (let round = 0; round < 12; round++) {
    const byAbbr = new Map<string, string[]>();
    for (const n of unique) {
      const a = teamAbbreviation(n, extra.get(n)!);
      result.set(n, a);
      byAbbr.set(a, [...(byAbbr.get(a) ?? []), n]);
    }
    const clashes = [...byAbbr.values()].filter((group) => group.length > 1);
    if (!clashes.length) return result;
    for (const group of clashes) for (const n of group) extra.set(n, extra.get(n)! + 1);
  }

  // Names that only differ past the letters taken (or not at all once stripped)
  // are told apart by number.
  const seen = new Map<string, number>();
  for (const n of unique) {
    const a = result.get(n)!;
    const count = (seen.get(a) ?? 0) + 1;
    seen.set(a, count);
    if (count > 1) result.set(n, `${a}${count}`);
  }
  return result;
}
