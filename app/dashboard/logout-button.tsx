"use client";

import { useState, useTransition } from "react";
import { logout } from "./logout-actions";

export function LogoutButton({ className = "" }: { className?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (confirming) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <button
          type="button"
          onClick={() => startTransition(() => logout())}
          disabled={isPending}
          className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? "…" : "Log out"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="px-2.5 py-1 text-xs font-medium text-zinc-400 hover:text-white rounded-lg transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={`text-xs font-medium text-zinc-500 hover:text-white transition-colors whitespace-nowrap ${className}`}
    >
      Log out
    </button>
  );
}
