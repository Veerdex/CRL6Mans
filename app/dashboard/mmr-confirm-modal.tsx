"use client";

import { useEffect, useState } from "react";
import { getOwnMmrForJoin, saveOwnMmr } from "./settings/actions";
import { MmrConfirmPanel, ModalShell, mmrChanged, type MmrValues } from "./mmr-confirm-panel";

export function MmrConfirmModal({
  open,
  onConfirm,
  onClose,
  isPending,
}: {
  open: boolean;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}) {
  if (!open) return null;
  // Inner is mounted fresh on each open, so edits, errors and the cooldown all
  // reset — there is nothing to clear by hand.
  return <Inner onConfirm={onConfirm} onClose={onClose} isPending={isPending} />;
}

function Inner({
  onConfirm,
  onClose,
  isPending,
}: {
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [loaded, setLoaded] = useState<{ trackerUrl: string | null; values: MmrValues } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getOwnMmrForJoin()
      .then((res) => {
        if (!live) return;
        if (res.error || !res.values) {
          setLoadError(res.error ?? "Could not load your MMR.");
          return;
        }
        setLoaded({ trackerUrl: res.tracker_url ?? null, values: res.values });
      })
      .catch(() => { if (live) setLoadError("Could not load your MMR. Please try again."); });
    return () => { live = false; };
  }, []);

  async function handleConfirm(values: MmrValues) {
    setError(null);
    if (loaded && mmrChanged(values, loaded.values)) {
      setSaving(true);
      const res = await saveOwnMmr(values);
      setSaving(false);
      // Stay open on a rejection: the join would re-check the min-MMR gate
      // against values that were never written.
      if (res.error) { setError(res.error); return; }
      // Re-baseline, so a second press after a failed join doesn't re-send an
      // unchanged save and get back "No changes to save".
      setLoaded({ trackerUrl: loaded.trackerUrl, values });
    }
    onConfirm();
  }

  if (!loaded) {
    return (
      <ModalShell onClose={onClose}>
        <h2 className="text-base font-semibold text-white">Confirm your MMR</h2>
        {loadError ? (
          <p className="text-sm text-red-400">{loadError}</p>
        ) : (
          <p className="text-sm text-zinc-400">Loading your ranks…</p>
        )}
        <button
          onClick={onClose}
          className="w-full px-4 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors mt-1"
        >
          Cancel
        </button>
      </ModalShell>
    );
  }

  return (
    <MmrConfirmPanel
      trackerUrl={loaded.trackerUrl}
      initial={loaded.values}
      busy={saving || isPending}
      busyLabel={saving ? "Saving…" : "Joining…"}
      error={error}
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
}
