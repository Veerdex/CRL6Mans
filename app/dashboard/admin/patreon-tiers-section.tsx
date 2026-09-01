"use client";

import { useState, useTransition } from "react";
import { setTierBenefits, type LiveTier } from "./patreon-tiers-actions";
import type { PatreonBenefit } from "@/app/lib/patreon-benefits";

function formatTierPrice(amountCents: number | null): string | null {
  if (amountCents === null) return null;
  const dollars = amountCents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

function TierCard({ tier, benefits, assignedIds }: { tier: LiveTier; benefits: PatreonBenefit[]; assignedIds: string[] }) {
  const [selected, setSelected] = useState<string[]>(assignedIds);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const price = formatTierPrice(tier.amountCents);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  }

  function handleSave() {
    setFeedback(null);
    startTransition(async () => {
      const res = await setTierBenefits(tier.title, selected);
      if (res.error) setFeedback({ msg: res.error, ok: false });
      else setFeedback({ msg: "Saved!", ok: true });
      setTimeout(() => setFeedback(null), 3000);
    });
  }

  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-white">
        {tier.title}
        {price && <span className="text-zinc-500 font-normal"> ({price})</span>}
      </p>
      <div className="space-y-1.5">
        {benefits.map((b) => (
          <label
            key={b.id}
            className="flex items-start gap-2.5 bg-zinc-800/60 border border-zinc-800 rounded-lg px-3 py-2 cursor-pointer hover:bg-zinc-800 transition-colors"
          >
            <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggle(b.id)} className="mt-0.5 shrink-0" />
            <span>
              <span className="block text-sm text-white font-medium">{b.title}</span>
              <span className="block text-xs text-zinc-500">{b.description}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        {feedback && <span className={`text-xs ${feedback.ok ? "text-green-400" : "text-red-400"}`}>{feedback.msg}</span>}
      </div>
    </div>
  );
}

export function PatreonTiersSection({
  tiers,
  benefits,
  tierBenefitMap,
}: {
  tiers: LiveTier[];
  benefits: PatreonBenefit[];
  tierBenefitMap: Record<string, string[]>;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Tiers are pulled live from the Patreon campaign — they aren&apos;t created here. Benefits are a hardcoded catalog
        (edited in <code className="text-zinc-400">app/lib/patreon-benefits.ts</code>); pick which ones each tier includes.
      </p>

      {benefits.length === 0 ? (
        <p className="text-xs text-zinc-600">
          No benefits defined yet — add them in <code className="text-zinc-500">app/lib/patreon-benefits.ts</code>, then come
          back here to assign them to tiers.
        </p>
      ) : tiers.length === 0 ? (
        <p className="text-xs text-zinc-600">No tiers found on Patreon yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tiers.map((tier) => (
            <TierCard key={tier.title} tier={tier} benefits={benefits} assignedIds={tierBenefitMap[tier.title] ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}
