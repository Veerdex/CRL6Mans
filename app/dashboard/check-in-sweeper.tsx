"use client";

import { useEffect } from "react";
import { sweepCheckIns } from "@/app/dashboard/my-team/schedule-actions";

const THROTTLE_MS = 120_000;
const KEY = "checkin-sweep-at";

// Rendered only during an active tournament. A check-in window that expires with
// neither team present would otherwise sit unresolved until the daily cron, since
// the client-side fallback in CheckInRow only runs for someone with my-team open.
// This is a hedge, not a replacement for the per-minute cron pinger: if nobody is
// on the site at all, nothing here fires either.
export function CheckInSweeper() {
  useEffect(() => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY) ?? 0);
    } catch {}
    if (Date.now() - last < THROTTLE_MS) return;
    try {
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {}
    sweepCheckIns().catch(() => {});
  }, []);

  return null;
}
