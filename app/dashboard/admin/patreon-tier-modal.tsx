"use client";

import { useEffect, useState } from "react";
import type { Benefit, Tier, TierInput } from "./patreon-tiers-actions";

export function PatreonTierModal({
  tier,
  benefits,
  liveTierTitles,
  onClose,
  onSave,
}: {
  tier: Tier | null;
  benefits: Benefit[];
  liveTierTitles: string[];
  onClose: () => void;
  onSave: (input: TierInput) => Promise<{ error?: string } | void>;
}) {
  const [input, setInput] = useState<TierInput>(
    tier
      ? { name: tier.name, description: tier.description, benefitIds: tier.benefitIds }
      : { name: "", description: "", benefitIds: [] }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function toggleBenefit(id: string) {
    setInput((prev) => ({
      ...prev,
      benefitIds: prev.benefitIds.includes(id) ? prev.benefitIds.filter((b) => b !== id) : [...prev.benefitIds, id],
    }));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const res = await onSave(input);
    setSaving(false);
    if (res?.error) setError(res.error);
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">{tier ? "Edit tier" : "New tier"}</p>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-sm">
            Close
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Name</label>
            <input
              value={input.name}
              onChange={(e) => setInput((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Gold"
              list="live-patreon-tier-titles"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-zinc-600"
            />
            <datalist id="live-patreon-tier-titles">
              {liveTierTitles.map((title) => (
                <option key={title} value={title} />
              ))}
            </datalist>
            <p className="text-[11px] text-zinc-600 mt-1">
              Match this to the real tier title on Patreon so the two line up.
              {liveTierTitles.length > 0 && <> Live on Patreon: {liveTierTitles.join(", ")}.</>}
            </p>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Description</label>
            <textarea
              value={input.description}
              onChange={(e) => setInput((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="What this tier is for."
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-zinc-600 resize-none"
            />
          </div>
        </div>

        <div>
          <p className="text-xs text-zinc-500 mb-1.5">Benefits</p>
          {benefits.length === 0 ? (
            <p className="text-xs text-zinc-600">No benefits yet — create one in the Benefits list first.</p>
          ) : (
            <div className="space-y-1.5">
              {benefits.map((b) => (
                <label
                  key={b.id}
                  className="flex items-start gap-2.5 bg-zinc-800/60 border border-zinc-800 rounded-lg px-3 py-2 cursor-pointer hover:bg-zinc-800 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={input.benefitIds.includes(b.id)}
                    onChange={() => toggleBenefit(b.id)}
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    <span className="block text-sm text-white font-medium">{b.name}</span>
                    <span className="block text-xs text-zinc-500">{b.description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
