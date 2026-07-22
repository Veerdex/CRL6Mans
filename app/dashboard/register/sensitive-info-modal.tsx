"use client";

import { useEffect, useState } from "react";

export function SensitiveInfoModal({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(3);

  useEffect(() => {
    if (!open) return;
    setSecondsLeft(3);
    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl flex flex-col gap-3">
        <h2 className="text-base font-semibold text-white">Sensitive Information Notice</h2>
        <p className="text-sm text-zinc-400">
          This site will store the college enrollment proof you upload as part of your
          registration. Do you trust this site with that information?
        </p>
        <div className="flex flex-col gap-2 mt-1">
          <button
            type="button"
            onClick={onConfirm}
            disabled={secondsLeft > 0}
            className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {secondsLeft > 0 ? `Confirm (${secondsLeft})` : "Confirm"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full px-4 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
