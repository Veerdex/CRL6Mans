"use client";

import { useState, useTransition, type ReactNode } from "react";
import { LINEUP_SLOTS, SLOT_LABEL, isStarterSlot, type LineupSlot } from "@/app/lib/fantasy-draft";
import { moveTargets, type LineupEntry } from "@/app/lib/fantasy-lineup";
import { moveLineupSlot, moveOrphanLineupSlot } from "../../actions";

// Tap a position to pick its player up, then tap where they should go. A tap
// beats dragging on a phone, and the targets come from the same rules the
// action enforces, so every highlighted slot is one the move will be accepted for.
export function LineupEditor({
  leagueId,
  title,
  lineup,
  cells,
  orphanTeamId,
}: {
  leagueId: string;
  /** §11: the owner is setting an orphaned team's lineup rather than their own. */
  orphanTeamId?: string;
  title: string;
  lineup: LineupEntry[];
  cells: Record<LineupSlot, ReactNode>;
}) {
  const [selected, setSelected] = useState<LineupSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bySlot = new Map(lineup.map((e) => [e.slot, e]));
  const targets = new Set(selected ? moveTargets(lineup, selected, LINEUP_SLOTS) : []);
  const anyLocked = lineup.some((e) => e.locked);

  function tap(slot: LineupSlot) {
    setError(null);
    if (selected === slot) return setSelected(null);
    if (selected && targets.has(slot)) {
      const from = selected;
      startTransition(async () => {
        const res = orphanTeamId
          ? await moveOrphanLineupSlot(leagueId, orphanTeamId, from, slot)
          : await moveLineupSlot(leagueId, from, slot);
        if (res.error) setError(res.error);
        setSelected(null);
      });
      return;
    }
    const entry = bySlot.get(slot);
    setSelected(entry && !entry.locked ? slot : null);
  }

  return (
    <section className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-700 space-y-0.5">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p className="text-xs text-zinc-400">
          {selected
            ? "Tap a highlighted position to move them there, or tap them again to cancel."
            : "Tap a player's position to move them. Starters score; the bench doesn't."}
        </p>
      </header>
      {error && <p className="px-4 py-2 text-xs text-red-300 bg-red-500/10 border-b border-zinc-700">{error}</p>}
      <ul className={`divide-y divide-zinc-700/60 ${pending ? "opacity-60" : ""}`}>
        {LINEUP_SLOTS.map((slot, i) => {
          const entry = bySlot.get(slot);
          const isSelected = selected === slot;
          const isTarget = targets.has(slot);
          const dimmed = selected !== null && !isSelected && !isTarget;
          const disabled = pending || (selected ? dimmed : !entry || entry.locked);
          return (
            <li
              key={slot}
              className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                !isStarterSlot(slot) && isStarterSlot(LINEUP_SLOTS[i - 1]) ? "border-t-2 border-t-zinc-600" : ""
              } ${isSelected ? "bg-indigo-500/15" : isTarget ? "bg-indigo-500/5" : ""}`}
            >
              <button
                type="button"
                onClick={() => tap(slot)}
                disabled={disabled}
                aria-pressed={isSelected}
                aria-label={
                  entry?.locked
                    ? `${SLOT_LABEL[slot]}, locked while their match is being played`
                    : isTarget
                      ? `Move to ${SLOT_LABEL[slot]}`
                      : SLOT_LABEL[slot]
                }
                className={`w-16 shrink-0 whitespace-nowrap rounded-md border px-1.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  isSelected
                    ? "bg-indigo-500 border-indigo-500 text-on-accent"
                    : isTarget
                      ? "border-indigo-400 border-dashed text-indigo-200 hover:bg-indigo-500/20"
                      : entry?.locked
                        ? "border-zinc-700 text-zinc-500 cursor-not-allowed"
                        : dimmed
                          ? "border-zinc-700 text-zinc-600"
                          : `border-zinc-600 hover:bg-zinc-700 ${isStarterSlot(slot) ? "text-zinc-200" : "text-zinc-400"}`
                }`}
              >
                {entry?.locked ? `🔒 ${SLOT_LABEL[slot]}` : SLOT_LABEL[slot]}
              </button>
              {cells[slot]}
            </li>
          );
        })}
      </ul>
      {anyLocked && (
        <p className="px-4 py-2 text-xs text-zinc-500 border-t border-zinc-700">
          🔒 Locked players are mid-match and can&apos;t move until their series is reported.
        </p>
      )}
    </section>
  );
}
