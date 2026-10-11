import { useEffect, useState } from "react";

// Mirrors CHECKIN_WINDOW_MS in app/lib/discord-bot.ts, which is where the window
// is actually enforced. It can't be imported from either side: schedule-actions.ts
// carries "use server", so every export there has to be an async function, and
// discord-bot.ts would drag supabaseAdmin into the client bundle. A plain module
// beside the panels is the only home that both of them can read.
export const CHECKIN_WINDOW_MS = 10 * 60 * 1000;

export type CheckInClock = {
  /** null when no deadline is stamped yet, i.e. the match isn't a tournament one. */
  deadline: number | null;
  opensAt: number | null;
  windowOpen: boolean;
  windowClosed: boolean;
  /** Milliseconds until the deadline, clamped at 0. Null without a deadline. */
  msLeft: number | null;
  /** Milliseconds until the window opens, clamped at 0. Null without a deadline. */
  msUntilOpen: number | null;
};

/**
 * The check-in window as of now, re-read every second while it matters.
 *
 * Display only: it deliberately does not fire processCheckInsNow when the
 * deadline passes. CheckInRow owns that trigger, and it is a production write
 * that disqualifies a team — two components racing to send it is not a thing
 * worth having for a second countdown.
 */
export function useCheckInClock(deadlineIso: string | null, settled: boolean): CheckInClock {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const deadline = deadlineIso ? new Date(deadlineIso).getTime() : null;

  useEffect(() => {
    if (deadline === null || settled) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline, settled]);

  const opensAt = deadline !== null ? deadline - CHECKIN_WINDOW_MS : null;
  return {
    deadline,
    opensAt,
    windowOpen: opensAt !== null && deadline !== null && nowMs >= opensAt && nowMs <= deadline,
    windowClosed: deadline !== null && nowMs > deadline,
    msLeft: deadline !== null ? Math.max(0, deadline - nowMs) : null,
    msUntilOpen: opensAt !== null ? Math.max(0, opensAt - nowMs) : null,
  };
}

export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Rendered in the reader's own zone with the zone named, since the league has
// players in several and no canonical one.
export function fmtCheckInTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}
