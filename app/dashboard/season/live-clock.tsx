"use client";

import { useSyncExternalStore } from "react";
import { formatElapsed } from "@/app/lib/match-live";

// One interval for the whole page rather than one per card: a bracket round can
// have several live matches, and they should all tick on the same beat anyway.
let tickNow = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!timer) {
    tickNow = Date.now();
    timer = setInterval(() => {
      tickNow = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// Cached between ticks, which useSyncExternalStore requires — returning a live
// Date.now() would hand React a different value on every read of the same render.
const getSnapshot = () => tickNow;

// null on the server and for the hydrating render, so the clock appears only once
// the client owns it. Rendering an elapsed time during SSR would bake in the
// server's clock and disagree with the browser's a moment later — a hydration
// mismatch on every live match.
const getServerSnapshot = () => null;

// Time since both teams checked in (matches.started_at), ticking every second.
export function LiveClock({ startedAt, className = "" }: { startedAt: string; className?: string }) {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (now === null) return null;
  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {formatElapsed(startedAt, now)}
    </span>
  );
}
