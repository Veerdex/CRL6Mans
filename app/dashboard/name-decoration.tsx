"use client";

import { createContext, useContext, useMemo } from "react";
import type { NameDecoration } from "@/app/lib/patreon-entitlements";

// Populated once per dashboard render in layout.tsx and read by PlayerName.
// A context rather than a prop because every call site of PlayerName would
// otherwise have to select and thread the patron's badge and colour.
const NameDecorations = createContext<ReadonlyMap<string, NameDecoration>>(new Map());

export function NameDecorationProvider({
  decorations,
  children,
}: {
  decorations: [string, NameDecoration][];
  children: React.ReactNode;
}) {
  const map = useMemo(() => new Map(decorations), [decorations]);
  return <NameDecorations.Provider value={map}>{children}</NameDecorations.Provider>;
}

export function useNameDecoration(username: string): NameDecoration | undefined {
  return useContext(NameDecorations).get(username.toLowerCase());
}
