"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFantasyTradesEnabled } from "../../actions";

/** A director's switch for the Trades section, in every league at once. */
export function TradesToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const flip = () => {
    setError(null);
    start(async () => {
      const res = await setFantasyTradesEnabled(!enabled);
      if (res.error) setError(res.error);
      else {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  return (
    <section className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 flex flex-col items-center gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Staff</h2>
      <div className="flex items-center gap-3 text-sm text-zinc-300">
        <span>
          Trades are <strong className={enabled ? "text-emerald-400" : "text-zinc-100"}>{enabled ? "on" : "off"}</strong> in every
          league
        </span>
        {!confirming && (
          <button
            className="rounded-md bg-zinc-700 px-2.5 py-1 text-xs font-semibold text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
            disabled={pending}
            onClick={() => (enabled ? setConfirming(true) : flip())}
          >
            {enabled ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>
      {confirming && (
        <div className="space-y-2 max-w-md">
          <p className="text-xs text-red-200 bg-red-900/30 border border-red-800/60 rounded-lg px-3 py-2">
            Turning trades off hides the Trades section in every league and cancels every pending trade.
          </p>
          <div className="flex justify-center gap-2">
            <button
              className="rounded-md bg-red-700 px-2.5 py-1 text-xs font-semibold text-on-accent hover:bg-red-600 disabled:opacity-50"
              disabled={pending}
              onClick={flip}
            >
              Turn trades off
            </button>
            <button
              className="rounded-md bg-zinc-700 px-2.5 py-1 text-xs font-semibold text-zinc-100 hover:bg-zinc-600"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Keep them on
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </section>
  );
}
