"use client";

import { useEffect, useRef } from "react";
import { markAllRead } from "./actions";

// Clears the badge one render AFTER the feed paints, so arriving on the page
// still shows which items were new. The action revalidates the dashboard layout,
// which re-renders the nav with the count gone.
export function MarkReadOnView({ hasUnread }: { hasUnread: boolean }) {
  const fired = useRef(false);

  useEffect(() => {
    if (!hasUnread || fired.current) return;
    fired.current = true;
    markAllRead().catch(() => {});
  }, [hasUnread]);

  return null;
}
