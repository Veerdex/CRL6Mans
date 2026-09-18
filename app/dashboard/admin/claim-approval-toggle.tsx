"use client";

import { useState, useTransition } from "react";
import { setClaimApprovalRequired } from "./identity-discrepancy-actions";

export function ClaimApprovalToggle({ initialRequired }: { initialRequired: boolean }) {
  const [required, setRequired] = useState(initialRequired);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3">
      <div>
        <p className="text-sm font-medium text-white">Require Admin Approval for Claimed Accounts</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          {required
            ? "ON — a platform account claim does nothing until an admin verifies it below. Claims cannot satisfy the join gate or resolve replay stats while they wait."
            : "OFF — a submitted claim counts immediately, both for joining and for resolving replay stats, with no admin review. Claims still cannot take a platform ID another player already holds."}
        </p>
        {!required && (
          <p className="text-xs text-amber-400/90 mt-1">
            Nobody checks the replay proof while this is off, so a claim on someone else&apos;s account is credited their stats.
          </p>
        )}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
      <button
        onClick={() => {
          const next = !required;
          setRequired(next);
          setError(null);
          startTransition(async () => {
            const res = await setClaimApprovalRequired(next);
            if (res.error) {
              setRequired(!next);
              setError(res.error);
            }
          });
        }}
        disabled={isPending}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          required ? "bg-emerald-600 border-emerald-600" : "bg-zinc-700 border-zinc-700"
        }`}
        role="switch"
        aria-checked={required}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${required ? "translate-x-4" : "translate-x-0"}`} />
      </button>
    </div>
  );
}
