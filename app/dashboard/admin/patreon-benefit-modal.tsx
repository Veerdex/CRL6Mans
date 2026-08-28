"use client";

import { useEffect, useState } from "react";
import type { Benefit, BenefitInput } from "./patreon-tiers-actions";

export function PatreonBenefitModal({
  benefit,
  onClose,
  onSave,
}: {
  benefit: Benefit | null;
  onClose: () => void;
  onSave: (input: BenefitInput) => Promise<{ error?: string } | void>;
}) {
  const [input, setInput] = useState<BenefitInput>(
    benefit ? { name: benefit.name, description: benefit.description } : { name: "", description: "" }
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
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 w-full max-w-md space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">{benefit ? "Edit benefit" : "New benefit"}</p>
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
              placeholder="e.g. Name color"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-zinc-600"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Description</label>
            <textarea
              value={input.description}
              onChange={(e) => setInput((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="What this benefit gives a supporter — shown to admins when picking benefits for a tier."
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-zinc-600 resize-none"
            />
          </div>
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
