"use client";

import { useState, useTransition } from "react";
import { setTierBenefits, type LiveTier, type TierBenefitAssignment } from "./patreon-tiers-actions";
import type { PatreonBenefit } from "@/app/lib/patreon-benefits";

// tier title -> benefit id -> per-tier value ("" for a plain on/off benefit).
type TierAssignments = Record<string, Record<string, string>>;

function formatTierPrice(amountCents: number | null): string | null {
  if (amountCents === null) return null;
  const dollars = amountCents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

function initialAssignments(
  tiers: LiveTier[],
  tierBenefitMap: Record<string, TierBenefitAssignment[]>,
): TierAssignments {
  return Object.fromEntries(
    tiers.map((t) => [t.title, Object.fromEntries((tierBenefitMap[t.title] ?? []).map((a) => [a.id, a.value ?? ""]))]),
  );
}

function sameAssignment(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && a[k] === b[k]);
}

// Cheapest first. A tier with no cached price has no place in the cumulative
// order, so it neither inherits nor is inherited from.
function cheaperTiers(tier: LiveTier, tiers: LiveTier[]): LiveTier[] {
  const cents = tier.amountCents;
  if (cents === null) return [];
  return tiers
    .filter((t): t is LiveTier & { amountCents: number } => t.amountCents !== null && t.amountCents < cents)
    .sort((a, b) => a.amountCents - b.amountCents);
}

// What a tier already gets from every cheaper tier, mapped to the tier it comes
// from — the cheapest source wins, since that is where the benefit starts.
// Rows duplicated across tiers stay harmless only while every benefit value is
// null: the runtime resolver breaks a contested id by letting the
// highest-priced row win the value.
function inheritedBenefits(tier: LiveTier, tiers: LiveTier[], assignments: TierAssignments): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const source of cheaperTiers(tier, tiers))
    for (const id of Object.keys(assignments[source.title] ?? {})) if (!(id in inherited)) inherited[id] = source.title;
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
  benefits,
  selected,
  inherited,
  dirtyElsewhere,
  onToggle,
  onSetValue,
  onSave,
}: {
  benefits: PatreonBenefit[];
  selected: Record<string, string>;
  inherited: Record<string, string>;
  dirtyElsewhere: string[];
  onToggle: (benefitId: string) => void;
  onSetValue: (benefitId: string, value: string) => void;
  onSave: () => Promise<{ error?: string }>;
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  function handleSave() {
    setFeedback(null);
    startTransition(async () => {
      const res = await onSave();
      setFeedback(res.error ? { msg: res.error, ok: false } : { msg: "Saved!", ok: true });
      setTimeout(() => setFeedback(null), 3000);
    });
  }

  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="space-y-1.5">
        {benefits.map((b) =>
          b.id in inherited ? (
            // Clickable rather than merely informational: claiming it here moves
            // where the benefit starts, which is the only way to take it off a
            // cheaper tier without losing it on this one.
            <div
              key={b.id}
              className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg px-3 py-2 hover:bg-zinc-900/80 transition-colors"
            >
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked onChange={() => onToggle(b.id)} className="mt-0.5 shrink-0 opacity-60" />
                <span>
                  <span className="block text-sm text-zinc-400 font-medium">{b.title}</span>
                  <span className="block text-xs text-zinc-600">
                    Inherited from {inherited[b.id]} — click to start it here instead, dropping it from{" "}
                    {inherited[b.id]}.
                  </span>
                </span>
              </label>
            </div>
          ) : (
            <div
              key={b.id}
              className="bg-zinc-800/60 border border-zinc-800 rounded-lg px-3 py-2 hover:bg-zinc-800 transition-colors"
            >
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={b.id in selected}
                  onChange={() => onToggle(b.id)}
                  className="mt-0.5 shrink-0"
                />
                <span>
                  <span className="block text-sm text-white font-medium">{b.title}</span>
                  <span className="block text-xs text-zinc-500">{b.description}</span>
                  {b.id in selected && (
                    <span className="block text-xs text-zinc-600 mt-0.5">
                      Starts here — every more expensive tier inherits it, and unchecking takes it from all of them.
                    </span>
                  )}
                </span>
              </label>
              {b.valueLabel && b.id in selected && (
                <input
                  type="text"
                  value={selected[b.id]}
                  onChange={(e) => onSetValue(b.id, e.target.value)}
                  placeholder={b.valueLabel}
                  className="mt-2 w-full text-xs px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-600"
                />
              )}
            </div>
          ),
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        {dirtyElsewhere.length > 0 && (
          <span className="text-[11px] text-zinc-500">Also saves pending changes to {dirtyElsewhere.join(", ")}.</span>
        )}
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
  // Held for the section rather than per card: claiming an inherited benefit
  // edits two tiers at once, and per-card state would leave the cheaper card
  // still showing a benefit it no longer starts.
  const [assignments, setAssignments] = useState<TierAssignments>(() => initialAssignments(tiers, tierBenefitMap));
  const [saved, setSaved] = useState<TierAssignments>(() => initialAssignments(tiers, tierBenefitMap));

  // Clamped rather than trusted: a tier disappearing from Patreon shortens the
  // list under an index that was valid a render ago.
  const active = Math.min(index, Math.max(tiers.length - 1, 0));
  const step = (delta: number) => setIndex((active + delta + tiers.length) % tiers.length);
  const dirty = tiers
    .filter((t) => !sameAssignment(assignments[t.title] ?? {}, saved[t.title] ?? {}))
    .map((t) => t.title);

  function toggle(tierTitle: string, benefitId: string) {
    setAssignments((prev) => {
      const next = { ...prev };
      if (benefitId in (prev[tierTitle] ?? {})) {
        const own = { ...prev[tierTitle] };
        delete own[benefitId];
        next[tierTitle] = own;
        return next;
      }
      // A benefit starts at exactly one tier, so claiming it here has to clear
      // it from everything cheaper — that is what turns "inherited" into
      // "starts here" instead of adding a redundant second row.
      const tier = tiers.find((t) => t.title === tierTitle);
      if (tier)
        for (const source of cheaperTiers(tier, tiers))
          if (benefitId in (prev[source.title] ?? {})) {
            const stripped = { ...prev[source.title] };
            delete stripped[benefitId];
            next[source.title] = stripped;
          }
      next[tierTitle] = { ...prev[tierTitle], [benefitId]: "" };
      return next;
    });
  }

  function setValue(tierTitle: string, benefitId: string, value: string) {
    setAssignments((prev) => ({ ...prev, [tierTitle]: { ...prev[tierTitle], [benefitId]: value } }));
  }

  // Commits every tier that differs from what is stored, not just the one on
  // screen: one click can change two tiers, and saving half of that would
  // either drop the benefit entirely or hand it back to the cheaper tier.
  async function saveAll(): Promise<{ error?: string }> {
    const snapshot = assignments;
    for (const title of dirty) {
      const res = await setTierBenefits(
        title,
        Object.entries(snapshot[title] ?? {}).map(([id, value]) => ({ id, value: value || null })),
      );
      if (res.error) return res;
    }
    setSaved(snapshot);
    return {};
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Tiers are pulled live from the Patreon campaign — they aren&apos;t created here. Benefits are a hardcoded catalog
        (edited in <code className="text-zinc-400">app/lib/patreon-benefits.ts</code>); pick which ones each tier includes.
        Tiers are cumulative: a benefit starts at one tier and every more expensive tier inherits it. Click an inherited
        benefit to move its starting point to the tier you&apos;re on — the cheaper tiers lose it, this one and everything
        above it keep it.
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
          <div className="flex items-center justify-center gap-2">
            <ArrowButton dir="prev" onClick={() => step(-1)} disabled={tiers.length < 2} />
            <div className="text-center">
              {/* Every title is stacked into the same grid cell so the block is
                  always as wide as the longest one — the arrows hold their
                  position instead of shifting with each tier's name. */}
              <div className="grid">
                {tiers.map((tier, i) => {
                  const price = formatTierPrice(tier.amountCents);
                  return (
                    <p
                      key={tier.title}
                      aria-hidden={i !== active}
                      className={`col-start-1 row-start-1 text-sm font-semibold text-white whitespace-nowrap${
                        i === active ? "" : " invisible"
                      }`}
                    >
                      {tier.title}
                      {price && <span className="text-zinc-500 font-normal"> ({price})</span>}
                    </p>
                  );
                })}
              </div>
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
                benefits={benefits}
                selected={assignments[tier.title] ?? {}}
                inherited={inheritedBenefits(tier, tiers, assignments)}
                dirtyElsewhere={dirty.filter((t) => t !== tier.title)}
                onToggle={(benefitId) => toggle(tier.title, benefitId)}
                onSetValue={(benefitId, value) => setValue(tier.title, benefitId, value)}
                onSave={saveAll}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
