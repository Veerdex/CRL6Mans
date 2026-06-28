"use client";

import { useState, useEffect } from "react";

// Renders an instant in the viewer's local timezone, with the zone abbreviation
// (e.g. "Jun 24, 2026, 7:00 PM CDT") so a time is never ambiguous. Formatting runs
// in useEffect (client-only) to avoid an SSR hydration mismatch.
export function LocalTime({
  iso,
  className,
  dateOnly = false,
}: {
  iso: string | null | undefined;
  className?: string;
  dateOnly?: boolean;
}) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return;
    setFormatted(
      dateOnly
        ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : d.toLocaleString(undefined, {
            month: "short", day: "numeric", year: "numeric",
            hour: "numeric", minute: "2-digit", timeZoneName: "short",
          })
    );
  }, [iso, dateOnly]);

  if (!iso) return <span className={className}>—</span>;
  return (
    <time dateTime={iso} className={className}>
      {formatted ?? "—"}
    </time>
  );
}
