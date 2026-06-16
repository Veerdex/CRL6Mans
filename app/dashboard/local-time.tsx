"use client";

export function LocalTime({
  iso,
  className,
  dateOnly = false,
}: {
  iso: string | null | undefined;
  className?: string;
  dateOnly?: boolean;
}) {
  if (!iso) return <span className={className}>—</span>;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return <span className={className}>—</span>;
  const formatted = dateOnly
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <time dateTime={iso} suppressHydrationWarning className={className}>
      {formatted}
    </time>
  );
}
