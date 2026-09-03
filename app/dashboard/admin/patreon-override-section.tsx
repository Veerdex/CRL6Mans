"use client";

import { useState, useTransition } from "react";
import { setTierOverride, type LiveTier, type OverrideCandidate, type TierOverride } from "./patreon-tiers-actions";

function formatTierPrice(amountCents: number | null): string | null {
  if (amountCents === null) return null;
  const dollars = amountCents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

function formatSetAt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function PatreonOverrideSection({
  tiers,
  candidates,
  overrides,
}: {
  tiers: LiveTier[];
  candidates: OverrideCandidate[];
  overrides: TierOverride[];
}) {
  const [discordId, setDiscordId] = useState("");
  const [tierTitle, setTierTitle] = useState(tiers[0]?.title ?? "");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  function apply(id: string, tier: string | null, successMsg: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await setTierOverride(id, tier);
      if (res.error) setFeedback({ msg: res.error, ok: false });
      else setFeedback({ msg: successMsg, ok: true });
      setTimeout(() => setFeedback(null), 3000);
    });
  }

  const noTiers = tiers.length === 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Grants a player every benefit of the chosen tier without a real pledge, so perks can be checked before anyone
        subscribes. This is entitlements only — it does <strong className="text-zinc-400">not</strong> count toward patron
        totals or MRR in the Patreon section, and does not add anyone to the public &quot;Our Patrons&quot; list on the
        Support Us tab. Overrides survive the Patreon sync, so clear them when you&apos;re done testing.
      </p>

      {noTiers ? (
        <p className="text-xs text-zinc-600">
          No tier prices cached yet — open <span className="text-zinc-500">Tiers &amp; Benefits</span> once to pull them
          from the Patreon campaign, then come back.
        </p>
      ) : (
        <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-zinc-300">Give a player a tier</p>
          <div className="flex flex-wrap gap-3">
            <select
              value={discordId}
              onChange={(e) => setDiscordId(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white min-w-0 flex-1 sm:flex-none sm:w-64"
            >
              <option value="">Select a player…</option>
              {candidates.map((c) => (
                <option key={c.discordId} value={c.discordId}>
                  {c.name}
                  {c.username && c.username !== c.name ? ` (@${c.username})` : ""}
                </option>
              ))}
            </select>
            <select
              value={tierTitle}
              onChange={(e) => setTierTitle(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              {tiers.map((t) => {
                const price = formatTierPrice(t.amountCents);
                return (
                  <option key={t.title} value={t.title}>
                    {t.title}
                    {price ? ` (${price})` : ""}
                  </option>
                );
              })}
            </select>
            <button
              onClick={() => apply(discordId, tierTitle, "Override applied.")}
              disabled={isPending || !discordId || !tierTitle}
              className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
            >
              {isPending ? "Saving…" : "Apply"}
            </button>
          </div>
          {feedback && <p className={`text-xs ${feedback.ok ? "text-green-400" : "text-red-400"}`}>{feedback.msg}</p>}
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Active Overrides</p>
        {overrides.length === 0 ? (
          <p className="text-sm text-zinc-500">None — nobody is on a test tier.</p>
        ) : (
          <div className="space-y-2">
            {overrides.map((o) => (
              <div
                key={o.discordId}
                className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3"
              >
                <span className="flex-1 text-sm text-white font-medium truncate min-w-0">{o.name}</span>
                <span className="text-xs text-zinc-400 shrink-0">{o.tierTitle}</span>
                {o.setAt && <span className="text-xs text-zinc-600 shrink-0 hidden sm:inline">{formatSetAt(o.setAt)}</span>}
                <button
                  onClick={() => apply(o.discordId, null, `Cleared ${o.name}.`)}
                  disabled={isPending}
                  className="text-xs text-red-500 hover:text-red-400 disabled:opacity-40 transition-colors shrink-0"
                >
                  Clear
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
