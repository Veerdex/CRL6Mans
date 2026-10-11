"use client";

import { useEffect, useState } from "react";

/** Season Peak is `current_*`, All Time Peak is `peak_*` — see settings/actions.ts. */
export type MmrValues = {
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string;
};

export const CONFIRM_COOLDOWN_SECONDS = 3;

export function mmrChanged(a: MmrValues, b: MmrValues): boolean {
  return (
    Number(a.peak_2v2) !== Number(b.peak_2v2) ||
    Number(a.current_2v2) !== Number(b.current_2v2) ||
    Number(a.peak_3v3) !== Number(b.peak_3v3) ||
    Number(a.current_3v3) !== Number(b.current_3v3)
  );
}

export function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function MmrField({
  label, value, onChange, disabled,
}: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={3000}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white text-center font-mono tabular-nums focus:outline-none focus:border-indigo-500 disabled:opacity-50"
    />
  );
}

/**
 * Pure: it never imports a server action, so the preview route can mount it
 * with fixtures and a stubbed onConfirm without any chance of writing MMR.
 * The wrapper in mmr-confirm-modal.tsx owns the fetch and the save.
 *
 * Mounted only once the values have loaded, which is what starts the cooldown —
 * a slow fetch must not spend it on numbers the player hasn't seen yet.
 */
export function MmrConfirmPanel({
  trackerUrl, initial, busy, busyLabel = "Joining…", error, confirmLabel = "Confirm and join",
  onConfirm, onClose,
}: {
  trackerUrl: string | null;
  initial: MmrValues;
  busy: boolean;
  busyLabel?: string;
  error: string | null;
  confirmLabel?: string;
  onConfirm: (values: MmrValues) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<MmrValues>(initial);
  const [secondsLeft, setSecondsLeft] = useState(CONFIRM_COOLDOWN_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const set = (key: keyof MmrValues) => (v: string) => setValues((p) => ({ ...p, [key]: v }));
  const cooling = secondsLeft > 0;

  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-base font-semibold text-white">Confirm your MMR</h2>
      <p className="text-sm text-zinc-400">
        Your MMR decides your rating and who you get drafted with. Check these against
        your tracker and correct anything that&apos;s changed.
      </p>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">Your tracker</p>
        {trackerUrl ? (
          <a
            href={trackerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-300 underline break-all"
          >
            {trackerUrl}
          </a>
        ) : (
          <p className="text-xs text-zinc-500">
            No tracker on file — add one in Settings.
          </p>
        )}
      </div>

      <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-2 gap-y-1.5 items-center">
        <span />
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 text-center">Season peak</p>
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 text-center">All time peak</p>

        <span className="text-xs font-semibold text-zinc-400">2v2</span>
        <MmrField label="Season Peak 2v2" value={values.current_2v2} onChange={set("current_2v2")} disabled={busy} />
        <MmrField label="All Time Peak 2v2" value={values.peak_2v2} onChange={set("peak_2v2")} disabled={busy} />

        <span className="text-xs font-semibold text-zinc-400">3v3</span>
        <MmrField label="Season Peak 3v3" value={values.current_3v3} onChange={set("current_3v3")} disabled={busy} />
        <MmrField label="All Time Peak 3v3" value={values.peak_3v3} onChange={set("peak_3v3")} disabled={busy} />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex flex-col gap-2 mt-1">
        <button
          onClick={() => onConfirm(values)}
          disabled={busy || cooling}
          className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {busy ? busyLabel : cooling ? `Confirm in ${secondsLeft}…` : confirmLabel}
        </button>
        <button
          onClick={onClose}
          disabled={busy}
          className="w-full px-4 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}
