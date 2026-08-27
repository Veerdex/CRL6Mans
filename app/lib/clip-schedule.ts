// How far America/Los_Angeles is behind UTC at a given instant, in ms
// (negative — e.g. -7h during PDT, -8h during PST). Derived by formatting the
// instant into Pacific wall-clock fields, then comparing that (interpreted as
// UTC) against the instant itself.
function pacificOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? "0");
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - instant.getTime();
}

// Most recent Sunday 00:00 America/Los_Angeles, as a UTC instant. Computes
// the offset separately for "now" and for the target Sunday (not just once)
// so a DST transition falling inside the lookback window doesn't shift the
// boundary by an hour.
export function mostRecentSundayMidnightPacific(now: Date): Date {
  const nowOffset = pacificOffsetMs(now);
  const nowPacificFields = new Date(now.getTime() + nowOffset);
  const y = nowPacificFields.getUTCFullYear();
  const mo = nowPacificFields.getUTCMonth();
  const d = nowPacificFields.getUTCDate();
  const daysSinceSunday = nowPacificFields.getUTCDay();

  return sundayMidnightPacificAt(y, mo, d - daysSinceSunday);
}

// Sunday 00:00 America/Los_Angeles for the given (year, month, day) Pacific
// calendar date, rolling over month/year boundaries via Date.UTC. Re-derives
// the offset for that specific day (not reused from another instant) so a
// DST transition landing on the target date is handled correctly.
function sundayMidnightPacificAt(year: number, month: number, day: number): Date {
  const dateOnly = new Date(Date.UTC(year, month, day));
  const y = dateOnly.getUTCFullYear();
  const mo = dateOnly.getUTCMonth();
  const d = dateOnly.getUTCDate();
  const noonUtc = new Date(Date.UTC(y, mo, d, 12, 0, 0));
  const offset = pacificOffsetMs(noonUtc);
  return new Date(Date.UTC(y, mo, d, 0, 0, 0) - offset);
}

// A clip's guaranteed-lifetime expiry: the end of the week AFTER the one it
// was submitted in (not the end of its own submission week). This guarantees
// every clip stays up for at least 7 days regardless of which day of the week
// it's submitted on — e.g. a Saturday submission (previously archived the
// very next day) now survives 8 days, and a Sunday submission survives close
// to 14. A clip that wins Clip of the Week is archived immediately on winning
// (see the clip-reset cron), independent of this expiry.
export function computeClipExpiry(createdAt: Date): Date {
  const submissionWeekStart = mostRecentSundayMidnightPacific(createdAt);
  const submissionWeekStartOffset = pacificOffsetMs(submissionWeekStart);
  const pacificFields = new Date(submissionWeekStart.getTime() + submissionWeekStartOffset);
  return sundayMidnightPacificAt(
    pacificFields.getUTCFullYear(),
    pacificFields.getUTCMonth(),
    pacificFields.getUTCDate() + 14
  );
}
