"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { tabFromPathname } from "@/app/lib/tab-labels";

// Logs one visit event per dashboard route change, keyed by tab, for the
// admin "Tab Visits" analytics section. Unlike VisitTracker this is not
// session-deduped — every navigation to a tab counts as a visit to it.
export function TabVisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const tab = tabFromPathname(pathname);
    if (!tab) return;
    fetch("/api/analytics/tab-visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab }),
    }).catch(() => {});
  }, [pathname]);

  return null;
}
