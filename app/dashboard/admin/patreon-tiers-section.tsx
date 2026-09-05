"use client";

import { useState, useTransition } from "react";
import { setTierBenefits, type LiveTier, type TierBenefitAssignment } from "./patreon-tiers-actions";
import type { PatreonBenefit } from "@/app/lib/patreon-benefits";

function formatTierPrice(amountCents: number | null): string | null {
  if (amountCents === null) return null;
  const dollars = amountCents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

// What a tier already gets from every cheaper tier, mapped to the tier it comes
// from. Cheapest first so a benefit assigned redundantly at several tiers is
// credited to the one it actually originates at. A tier with no cached price
// has no place in the cumulative order, so it neither inherits nor is inherited
// from.
function inheritedBenefits(
  tier: LiveTier,
  tiers: LiveTier[],
  tierBenefitMap: Record<string, TierBenefitAssignment[]>,
): Record<string, string> {
  const cents = tier.amountCents;
  if (cents === null) return {};

  const inherited: Record<string, string> = {};
  const cheaper = tiers
    .filter((t): t is LiveTier & { amountCents: number } => t.amountCents !== null && t.amountCents < cents)
    .sort((a, b) => a.amountCents - b.amountCents);
  for (const source of cheaper)
    for (const a of tierBenefitMap[source.title] ?? []) if (!(a.id in inherited)) inherited[a.id] = source.title;
  return inherited;
}

function ArrowButton({ dir, onClick, disabled }: { dir: "prev" | "next"; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous tier" : "Next tier"}
      className="shrink-0 p-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400 transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === "prev" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
      </svg>
    </button>
  );
}

function TierCard({
  tier,
  benefits,
  assigned,
  inherited,
}: {
  tier: LiveTier;
  benefits: PatreonBenefit[];
  assigned: TierBenefitAssignment[];
  inherited: Record<string, string>;
}) {
  // Presence of the key means the benefit is assigned; the string is its
  // per-tier value ("" for on/off benefits). Inherited ids are dropped so the
  // next save clears rows a cheaper tier already covers.
  const [selected, setSelected] = useState<Record<string, string>>(
    Object.fromEntries(assigned.filter((a) => !(a.id in inherited)).map((a) => [a.id, a.value ?? ""])),
  );
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      if (id in prev) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: "" };
    });
  }

  function handleSave() {
    setFeedback(null);
    startTransition(async () => {
      // Re-filtered rather than trusted from init: saving another card can turn
      // one of these into an inherited benefit while this one sits untouched.
      const assignments = Object.entries(selected)
        .filter(([id]) => !(id in inherited))
        .map(([id, value]) => ({ id, value: value || null }));
      const res = await setTierBenefits(tier.title, assignments);
      if (res.error) setFeedback({ msg: res.error, ok: false });
      else setFeedback({ msg: "Saved!", ok: true });
      setTimeout(() => setFeedback(null), 3000);
    });
  }

  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="space-y-1.5">
        {benefits.map((b) =>
          b.id in inherited ? (
            // Still listed, because a director reading this card needs to see
            // everything the tier grants — just not as a choice, since a
            // cheaper tier already decided it.
            <div key={b.id} className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg px-3 py-2">
              <div className="flex items-start gap-2.5">
                <input type="checkbox" checked disabled readOnly className="mt-0.5 shrink-0 opacity-50" />
                <span>
                  <span className="block text-sm text-zinc-400 font-medium">{b.title}</span>
                  <span className="block text-xs text-zinc-600">Inherited from {inherited[b.id]}</span>
                </span>
              </div>
            </div>
          ) : (
          <div
            key={b.id}
            className="bg-zinc-800/60 border border-zinc-800 rounded-lg px-3 py-2 hover:bg-zinc-800 transition-colors"
          >
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={b.id in selected} onChange={() => toggle(b.id)} className="mt-0.5 shrink-0" />
              <span>
                <span className="block text-sm text-white font-medium">{b.title}</span>
                <span className="block text-xs text-zinc-500">{b.description}</span>
              </span>
            </label>
            {b.valueLabel && b.id in selected && (
              <input
                type="text"
                value={selected[b.id]}
                onChange={(e) => setSelected((prev) => ({ ...prev, [b.id]: e.target.value }))}
                placeholder={b.valueLabel}
                className="mt-2 w-full text-xs px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-600"
              />
            )}
          </div>
          ),
        )}
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
  tierBenefitMap: Record<string, TierBenefitAssignment[]>;
}) {
  const [index, setIndex] = useState(0);
  // Clamped rather than trusted: a tier disappearing from Patreon shortens the
  // list under an index that was valid a render ago.
  const active = Math.min(index, Math.max(tiers.length - 1, 0));
  const step = (delta: number) => setIndex((active + delta + tiers.length) % tiers.length);
  const activeTier = tiers[active];
  const activePrice = activeTier ? formatTierPrice(activeTier.amountCents) : null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Tiers are pulled live from the Patreon campaign — they aren&apos;t created here. Benefits are a hardcoded catalog
        (edited in <code className="text-zinc-400">app/lib/patreon-benefits.ts</code>); pick which ones each tier includes.
        Tiers are cumulative: assign a benefit to the cheapest tier that gets it and every tier above inherits it, listed
        there as inherited rather than offered again.
      </p>

      {benefits.length === 0 ? (
        <p className="text-xs text-zinc-600">
          No benefits defined yet — add them in <code className="text-zinc-500">app/lib/patreon-benefits.ts</code>, then come
          back here to assign them to tiers.
        </p>
      ) : tiers.length === 0 ? (
        <p className="text-xs text-zinc-600">No tiers found on Patreon yet.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <ArrowButton dir="prev" onClick={() => step(-1)} disabled={tiers.length < 2} />
            <div className="text-center">
              <p className="text-sm font-semibold text-white">
                {activeTier.title}
                {activePrice && <span className="text-zinc-500 font-normal"> ({activePrice})</span>}
              </p>
              <p className="text-[11px] text-zinc-600">
                {active + 1} of {tiers.length}
              </p>
            </div>
            <ArrowButton dir="next" onClick={() => step(1)} disabled={tiers.length < 2} />
          </div>

          {/* Every card stays mounted and merely hidden, so arrowing away from one
              mid-edit doesn't silently discard its unsaved checkboxes. */}
          {tiers.map((tier, i) => (
            <div key={tier.title} className={i === active ? undefined : "hidden"}>
              <TierCard
                tier={tier}
                benefits={benefits}
                assigned={tierBenefitMap[tier.title] ?? []}
                inherited={inheritedBenefits(tier, tiers, tierBenefitMap)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
