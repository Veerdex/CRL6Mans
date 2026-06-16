"use client";

import { useEffect } from "react";

// Logs one "app opened" event per browser session (deduped via sessionStorage).
export function VisitTracker() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("visit_logged")) return;
      fetch("/api/analytics/visit", { method: "POST" })
        .then((r) => r.json())
        .then((d) => { if (d?.logged) sessionStorage.setItem("visit_logged", "1"); })
        .catch(() => {});
    } catch { /* sessionStorage unavailable — skip */ }
  }, []);
  return null;
}
