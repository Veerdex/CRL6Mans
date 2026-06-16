"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { initLeagueSettings } from "./league-actions";

export function InitSettingsButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => {
        await initLeagueSettings();
        router.refresh();
      })}
      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
    >
      {pending ? "Initializing…" : "Initialize Settings"}
    </button>
  );
}
