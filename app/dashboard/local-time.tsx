"use client";

import { useState, useEffect } from "react";

// Whole days between two instants as the viewer's calendar counts them, so an
// event at 11pm tonight is 0 days out and one at 1am tomorrow is 1, rather than
// both landing somewhere in the middle on a 24-hour clock.
function calendarDaysUntil(target: Date, now: Date): number {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

function format(d: Date, dateOnly: boolean, upcoming: boolean): string {
  const time: Intl.DateTimeFormatOptions = dateOnly
    ? {}
    : { hour: "numeric", minute: "2-digit", timeZoneName: "short" };

  if (!upcoming) {
    return dateOnly
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", ...time });
  }

  const now = new Date();
  const days = calendarDaysUntil(d, now);
  if (days >= 0 && days <= 6) {
    const day =
      days === 0 ? "Today"
      : days === 1 ? "Tomorrow"
      : d.toLocaleDateString(undefined, { weekday: "long" });
    return dateOnly ? day : `${day}, ${d.toLocaleTimeString(undefined, time)}`;
  }
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    ...time,
  });
}

// Renders an instant in the viewer's local timezone, with the zone abbreviation
// (e.g. "Jun 24, 2026, 7:00 PM CDT") so a time is never ambiguous. Formatting runs
// in useEffect (client-only) to avoid an SSR hydration mismatch.
//
// `upcoming` formats a scheduled event instead: the weekday is always shown, the
// year only when it differs from the current one, and inside the next six days
// the date is dropped entirely - the next Saturday is the only Saturday anyone
// could mean, so "Saturday, 7:00 PM CDT" says as much as a date would.
export function LocalTime({
  iso,
  className,
  dateOnly = false,
  upcoming = false,
}: {
  iso: string | null | undefined;
  className?: string;
  dateOnly?: boolean;
  upcoming?: boolean;
}) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return;
    setFormatted(format(d, dateOnly, upcoming));
  }, [iso, dateOnly, upcoming]);

  if (!iso) return <span className={className}>—</span>;
  return (
    <time dateTime={iso} className={className}>
      {formatted ?? "—"}
    </time>
  );
}
