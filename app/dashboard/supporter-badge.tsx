"use client";

import { useNameDecoration } from "./name-decoration";

export function SupporterBadge({ username }: { username: string }) {
  const decoration = useNameDecoration(username);
  if (!decoration?.badge) return null;

  // Sized in em so it tracks whatever font size the surrounding row uses —
  // PlayerName is rendered at everything from text-xs to text-2xl.
  return (
    <img
      src="/supporter-badge.png"
      alt="Supporter"
      draggable={false}
      className="shrink-0 ml-1 h-[1em] w-auto select-none"
    />
  );
}
