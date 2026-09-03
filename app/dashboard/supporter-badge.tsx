"use client";

import { createContext, useContext, useMemo } from "react";

// Populated once per dashboard render in layout.tsx and read by PlayerName.
// A context rather than a prop because every call site of PlayerName would
// otherwise have to select and thread an extra field.
const SupporterUsernames = createContext<ReadonlySet<string>>(new Set());

export function SupporterBadgeProvider({
  usernames,
  children,
}: {
  usernames: string[];
  children: React.ReactNode;
}) {
  const set = useMemo(() => new Set(usernames.map((u) => u.toLowerCase())), [usernames]);
  return <SupporterUsernames.Provider value={set}>{children}</SupporterUsernames.Provider>;
}

export function SupporterBadge({ username }: { username: string }) {
  const supporters = useContext(SupporterUsernames);
  if (!supporters.has(username.toLowerCase())) return null;
  return <SupporterBadgeIcon className="ml-1" />;
}

// The badge itself, ungated. The support page lists nothing but patrons, so it
// renders this directly instead of going through the entitlement check.
export function SupporterBadgeIcon({ className = "" }: { className?: string }) {
  // Sized in em so it tracks whatever font size the surrounding row uses —
  // PlayerName is rendered at everything from text-xs to text-2xl.
  return (
    <img
      src="/supporter-badge.png"
      alt="Supporter"
      draggable={false}
      className={`shrink-0 h-[1em] w-auto select-none ${className}`}
    />
  );
}
