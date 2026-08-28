"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncPatreonNow } from "./patreon-actions";

export function PatreonSyncButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => {
        await syncPatreonNow();
        router.refresh();
      })}
      className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 text-xs font-semibold rounded-lg transition-colors"
    >
      {pending ? "Syncing…" : "Sync now"}
    </button>
  );
}
