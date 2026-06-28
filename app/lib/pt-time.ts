// Timezone helpers that correctly handle DST for any IANA zone (no hardcoded offset).
// Pure + Intl-based, so safe to import on the server or the client.
//
// The app has no single canonical zone: times are interpreted/displayed in the
// relevant user's local zone. Pass an IANA zone (e.g. "America/Chicago") to the
// `zoned*`/`wallToUtc`/`shiftWall` functions. The `pt*` wrappers default to Pacific
// and remain only for legacy callers that still assume PT.

const DEFAULT_TZ = "America/Los_Angeles";
const DAY_MS = 86_400_000;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

type Components = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function zonedComponents(tz: string, utcMs: number): Components {
  const m: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") m[p.type] = parseInt(p.value, 10);
  }
  return { year: m.year, month: m.month, day: m.day, hour: m.hour % 24, minute: m.minute, second: m.second };
}

// Absolute offset (ms) of a zone at a UTC instant.
function absOffsetMs(tz: string, utcMs: number): number {
  const c = zonedComponents(tz, utcMs);
  const wallAsUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return utcMs - wallAsUtc;
}

// A Date whose UTC getters return the zone's wall-clock fields.
export function zonedDate(tz: string, utcMs: number): Date {
  return new Date(utcMs - absOffsetMs(tz, utcMs));
}

// Calendar-day key (e.g. "2025-10-3") in the given zone, for grouping/comparison.
export function zonedDayKey(tz: string, utcMs: number): string {
  const d = zonedDate(tz, utcMs);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

// Day of week (0 = Sunday) in the given zone.
export function zonedWeekday(tz: string, utcMs: number): number {
  return zonedDate(tz, utcMs).getUTCDay();
}

// Convert a wall-clock in `tz` to a UTC instant, accounting for DST.
export function wallToUtc(
  tz: string, year: number, month0: number, day: number, hour: number, minute: number,
): number {
  const guess = Date.UTC(year, month0, day, hour, minute);
  const off = absOffsetMs(tz, guess);
  let utc = guess + off;
  const off2 = absOffsetMs(tz, utc);
  if (off2 !== off) utc = guess + off2; // correct across a DST boundary
  return utc;
}

// Re-anchor a UTC instant so its wall-clock (day-offset + hour/minute, in `tz`) is
// preserved relative to a new anchor — DST-correct (not a raw millisecond shift).
export function shiftWall(tz: string, utcMs: number, oldAnchorMs: number, newAnchorMs: number): number {
  const v = zonedComponents(tz, utcMs);
  const oldA = zonedComponents(tz, oldAnchorMs);
  const newA = zonedComponents(tz, newAnchorMs);
  const dayOffset = Math.round(
    (Date.UTC(v.year, v.month - 1, v.day) - Date.UTC(oldA.year, oldA.month - 1, oldA.day)) / DAY_MS,
  );
  return wallToUtc(tz, newA.year, newA.month - 1, newA.day + dayOffset, v.hour, v.minute);
}

// ── Legacy Pacific-Time wrappers (default zone) ──────────────────────────────────
export function ptDate(utcMs: number): Date { return zonedDate(DEFAULT_TZ, utcMs); }
export function ptDayKey(utcMs: number): string { return zonedDayKey(DEFAULT_TZ, utcMs); }
export function ptWeekday(utcMs: number): number { return zonedWeekday(DEFAULT_TZ, utcMs); }
export function ptWallToUtc(year: number, month0: number, day: number, hour: number, minute: number): number {
  return wallToUtc(DEFAULT_TZ, year, month0, day, hour, minute);
}
export function shiftPtWall(utcMs: number, oldAnchorMs: number, newAnchorMs: number): number {
  return shiftWall(DEFAULT_TZ, utcMs, oldAnchorMs, newAnchorMs);
}
