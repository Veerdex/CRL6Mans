"use client";

import { useState, useTransition } from "react";
import { cancelFantasyClaim } from "../../actions";

export function CancelClaimButton({ leagueId, claimId }: { leagueId: string; claimId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await cancelFantasyClaim(leagueId, claimId);
            setError(res.error ?? null);
          })
        }
        className="rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Cancelling…" : "Cancel"}
      </button>
    </span>
  );
}
