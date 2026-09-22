"use client";

import { useState, useEffect, useTransition } from "react";
import { setAdminNotificationPref, sendTestAdminNotification } from "./league-actions";
import { subscribeToPush } from "../notification-button";

type TestResult = Awaited<ReturnType<typeof sendTestAdminNotification>>;

// A subscription is bound to the VAPID key it was created with, permanently. If
// the site's keypair was ever replaced, every subscription made before the swap
// keeps failing with 400/403 forever and no amount of retrying helps — the only
// fix is to subscribe again. Comparing the two keys here is what tells those
// apart from a genuine delivery problem.
type KeyState = "checking" | "match" | "mismatch" | "none" | "unsupported";

function toBase64Url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function resolveKeyState(): Promise<KeyState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return "none";
    const key = sub.options.applicationServerKey;
    return key && toBase64Url(key) === process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      ? "match"
      : "mismatch";
  } catch {
    return "unsupported";
  }
}

const ITEMS: { key: string; label: string; desc: string }[] = [
  { key: "match_reporting", label: "Match Reporting",          desc: "When a team submits a series result." },
  { key: "sub_requests",    label: "Sub Requests",             desc: "When a team requests a substitute." },
  { key: "registrations",   label: "Pending Registrations",    desc: "When a new player submits a registration." },
  { key: "profile_changes", label: "Profile Change Requests",  desc: "When a player requests an MMR / tracker change." },
  { key: "schedule_approvals", label: "Schedule Approvals",    desc: "When two teams agree on a time outside the scheduled window." },
];

export function AdminNotificationToggles({ initial }: { initial: Record<string, boolean> }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(initial);
  const [, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [keyState, setKeyState] = useState<KeyState>("checking");
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolveKeyState().then((s) => { if (!cancelled) setKeyState(s); });
    return () => { cancelled = true; };
  }, []);

  const toggle = (key: string) => {
    const next = !(prefs[key] !== false); // current state is on unless explicitly false
    setPrefs((p) => ({ ...p, [key]: next }));
    startTransition(() => { setAdminNotificationPref(key, next); });
  };

  const sendTest = async () => {
    setSending(true);
    setResult(null);
    try {
      setResult(await sendTestAdminNotification());
    } catch {
      setResult(null);
    }
    setSending(false);
  };

  // Unsubscribing before resubscribing is required, not tidiness: the browser
  // returns the existing subscription rather than minting one against the new key.
  const resubscribe = async () => {
    setFixing(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      await subscribeToPush();
      setKeyState(await resolveKeyState());
    } catch {}
    setFixing(false);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        Push notifications sent to staff. Turn off any you don&apos;t want to receive.
      </p>
      {ITEMS.map((item) => {
        const on = prefs[item.key] !== false;
        return (
          <div key={item.key} className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">{item.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{item.desc}</p>
            </div>
            <button
              onClick={() => toggle(item.key)}
              role="switch"
              aria-checked={on}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none ${
                on ? "bg-emerald-600 border-emerald-600" : "bg-zinc-700 border-zinc-700"
              }`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </div>
        );
      })}

      <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-white">Test notification</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Sends a push to every staff member with notifications enabled.
            </p>
          </div>
          <button
            onClick={sendTest}
            disabled={sending}
            className="text-xs px-3 py-1.5 rounded-lg border border-indigo-700/50 bg-indigo-900/30 text-indigo-300 hover:bg-indigo-900/60 disabled:opacity-50 shrink-0"
          >
            {sending ? "Sending…" : "Send test"}
          </button>
        </div>

        {keyState === "none" && (
          <p className="text-xs text-amber-400">
            This browser isn&apos;t subscribed, so the test won&apos;t reach it. Enable notifications
            from the bell in the header first.
          </p>
        )}

        {keyState === "mismatch" && (
          <div className="flex items-center justify-between gap-3 border-t border-zinc-700 pt-3">
            <p className="text-xs text-amber-400">
              This browser&apos;s subscription was created with a different signing key than the site
              uses now, so pushes to it will always fail. Re-subscribing fixes it.
            </p>
            <button
              onClick={resubscribe}
              disabled={fixing}
              className="text-xs px-3 py-1.5 rounded-lg border border-amber-700/50 bg-amber-900/30 text-amber-300 hover:bg-amber-900/60 disabled:opacity-50 shrink-0"
            >
              {fixing ? "Fixing…" : "Re-subscribe"}
            </button>
          </div>
        )}

        {result && (
          <div className="border-t border-zinc-700 pt-3 space-y-1 text-xs">
            <p className={result.failed || result.skipped ? "text-amber-400" : "text-emerald-400"}>
              {result.skipped === "notifications-off"
                ? "Nothing was sent — push is switched off in this browser (the Notifications toggle in Testing & Tools). That switch is a cookie on your own browser, so it silences sends you trigger, for everyone."
                : result.skipped === "category-off"
                  ? "Nothing was sent — this notification category is switched off above."
                  : result.skipped === "no-staff"
                    ? "Nothing was sent — no staff accounts exist to notify."
                    : result.skipped === "no-subscriptions"
                      ? "Nothing was sent — no staff device is subscribed to push at all."
                      : `${result.delivered} of ${result.attempted} device${result.attempted === 1 ? "" : "s"} accepted the push.`}
            </p>
            {result.failed > 0 && (
              <p className="text-zinc-400">
                Failed by status:{" "}
                {Object.entries(result.byStatus).map(([s, n]) => `${s} × ${n}`).join(", ")}
                {result.failedHosts.length ? ` (${result.failedHosts.join(", ")})` : ""}
              </p>
            )}
            {/* 400 and 403 are the signature of a key mismatch rather than a dead
                device, and are the one failure an admin can actually act on. */}
            {(result.byStatus["400"] || result.byStatus["403"]) && (
              <p className="text-zinc-400">
                400 and 403 mean the subscription was made with an older signing key. Those devices
                need to turn notifications off and back on.
              </p>
            )}
            {result.pruned > 0 && (
              <p className="text-zinc-500">
                Removed {result.pruned} subscription{result.pruned === 1 ? "" : "s"} that no longer exist.
              </p>
            )}
            {result.staffWithoutSubscription > 0 && (
              <p className="text-zinc-500">
                {result.staffWithoutSubscription} of {result.staffCount} staff have no device
                subscribed at all and never receive admin alerts.
              </p>
            )}
            <p className="text-zinc-600">
              Accepted means the push service took it, not that it appeared on screen — a device
              that&apos;s asleep or has notifications muted still counts.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
