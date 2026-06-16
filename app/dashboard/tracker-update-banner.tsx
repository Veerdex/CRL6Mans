"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { confirmTrackerCurrent } from "./settings/actions";

export function TrackerUpdateBanner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="bg-amber-950/40 border border-amber-700/50 rounded-xl px-4 py-3 space-y-2">
      <p className="text-sm font-semibold text-amber-300">Action needed: re-verify your tracker</p>
      <p className="text-xs text-amber-500/90">
        An admin asked everyone in the current event to re-verify their Rocket League tracker. Until you do,
        your team can&apos;t submit replays for matches you&apos;re in.
      </p>
      <div className="flex items-center gap-3 flex-wrap pt-0.5">
        <button
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await confirmTrackerCurrent();
              if (res.error) setError(res.error);
              else router.refresh();
            })
          }
          disabled={pending}
          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {pending ? "Saving…" : "My tracker is up to date"}
        </button>
        <Link
          href="/dashboard/settings"
          className="text-xs text-amber-300 underline underline-offset-2 hover:text-amber-200"
        >
          Update my tracker info
        </Link>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
