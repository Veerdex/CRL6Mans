"use client";

import { useState, useEffect } from "react";
import { subscribeToPush } from "./notification-button";

/** TEMPORARY: shows the prompt even after it has been answered on this device.
 *  Set to false (or delete, along with its uses below) to restore the real rule:
 *  once per device, never again after confirm or deny. */
const PREVIEW_ALWAYS_SHOW = true;

const DISMISS_KEY = "notify_prompt_answered";

function answered(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function markAnswered() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {}
}

export function NotificationPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    // A denied permission can't be re-prompted by the browser, so the confirm
    // button would silently do nothing.
    if (Notification.permission === "denied") return;
    if (!PREVIEW_ALWAYS_SHOW && answered()) return;

    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (cancelled) return;
        // Permission alone isn't "notifications on" — someone who granted once
        // and later turned them off should be asked again.
        if (Notification.permission === "granted" && sub) return;
        setShow(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirm() {
    setBusy(true);
    await subscribeToPush();
    markAnswered();
    setShow(false);
  }

  function deny() {
    markAnswered();
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-400">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>

        <h2 className="text-lg font-semibold text-zinc-100">Turn on notifications?</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Get alerts when your match is ready, when the draft is starting, and for
          league announcements.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={confirm}
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "…" : "Turn on notifications"}
          </button>
          <button
            onClick={deny}
            disabled={busy}
            className="w-full rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
