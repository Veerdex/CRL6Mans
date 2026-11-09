"use client";

import { useEffect, useState, useTransition } from "react";
import type { PoolPlayer } from "@/app/lib/fantasy-pool-data";
import type { LineupEntry } from "@/app/lib/fantasy-lineup";
import { swapInProblem } from "@/app/lib/fantasy-waivers";
import { SLOT_LABEL } from "@/app/lib/fantasy-draft";
import { FANTASY_TRADES_ENABLED } from "@/app/lib/fantasy-rules";
import { LocalTime } from "@/app/dashboard/local-time";
import type { TradeView } from "@/app/lib/fantasy-trades";
import { addFantasyFreeAgent, cancelFantasyClaim, claimFantasyPlayer } from "../../actions";
import { TradeButton, type PlayerLookup } from "./trades";

export type RosterMoves = {
  leagueId: string;
  managerId: string;
  /** Managers frozen by §7, the viewer possibly among them. */
  eliminated: string[];
  managerNames: Record<string, string>;
  trades: TradeView[];
  lineup: LineupEntry[];
  claims: { id: string; playerId: string; dropPlayerId: string }[];
  /** The viewer's place in the waiver order, 1 being first. */
  priority: { spot: number; of: number } | null;
};

const BUTTON = "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50";

export function MoveAction({
  player,
  moves,
  nameOf,
  playerOf,
  rosterOf,
}: {
  player: PoolPlayer;
  moves: RosterMoves;
  nameOf: (playerId: string) => string;
  playerOf: PlayerLookup;
  rosterOf: (managerId: string) => PoolPlayer[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const frozen = moves.eliminated.includes(moves.managerId);
  if (player.manager) {
    const mine = player.manager.accountId === moves.managerId;
    return !FANTASY_TRADES_ENABLED || mine || frozen || moves.eliminated.includes(player.manager.accountId) ? null : (
      <TradeButton player={player} moves={moves} playerOf={playerOf} rosterOf={rosterOf} />
    );
  }

  const claim = moves.claims.find((c) => c.playerId === player.id);
  const onWaivers = player.waiverClearsAt !== null;
  if (frozen && !claim) return null;

  if (claim && (!open || frozen)) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {!frozen && (
          <button type="button" onClick={() => setOpen(true)} className={`${BUTTON} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}>
            Edit
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await cancelFantasyClaim(moves.leagueId, claim.id);
              setError(res.error ?? null);
            })
          }
          className={`${BUTTON} bg-red-500/15 text-red-300 hover:bg-red-500/25`}
        >
          {pending ? "Withdrawing…" : "Withdraw"}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${BUTTON} ${onWaivers ? "bg-amber-500 text-on-accent hover:bg-amber-400" : "bg-indigo-500 text-on-accent hover:bg-indigo-400"}`}
      >
        {onWaivers ? "Claim" : "Add"}
      </button>
      {open && (
        <DropPicker
          player={player}
          moves={moves}
          nameOf={nameOf}
          currentDrop={claim?.dropPlayerId ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// The run fires on the first cron tick after 4 AM Pacific, so its time can pass
// before it has settled anything.
const runIsDue = (iso: string | null) => iso !== null && Date.parse(iso) <= Date.now();

function DropPicker({
  player,
  moves,
  nameOf,
  currentDrop,
  onClose,
}: {
  player: PoolPlayer;
  moves: RosterMoves;
  nameOf: (playerId: string) => string;
  currentDrop: string | null;
  onClose: () => void;
}) {
  const onWaivers = player.waiverClearsAt !== null;
  const candidates = moves.lineup.filter((e) => e.tier === player.tier);
  // A claim settles at the run, which checks the locks then, so only an
  // instant add has to respect them now.
  const problemFor = (e: LineupEntry) =>
    swapInProblem(
      { tier: player.tier, locked: false },
      { tier: e.tier, locked: !onWaivers && e.locked, onRoster: true },
    );
  const [drop, setDrop] = useState<string | null>(
    currentDrop ?? candidates.find((e) => !problemFor(e))?.playerId ?? null,
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    if (!drop) return;
    start(async () => {
      const res = onWaivers
        ? await claimFantasyPlayer(moves.leagueId, player.id, drop)
        : await addFantasyFreeAgent(moves.leagueId, player.id, drop);
      if (res.error) setError(res.error);
      else onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 text-left"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${onWaivers ? "Claim" : "Add"} ${player.name}`}
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-800 p-4 space-y-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-white">
            {onWaivers ? "Claim" : "Add"} {player.name}
          </h3>
          <p className="text-xs text-zinc-400">
            {onWaivers ? (
              <>
                {runIsDue(player.waiverClearsAt) ? (
                  <>His waiver run is due and hasn&apos;t finished yet. Claims settle in it,</>
                ) : (
                  <>
                    He&apos;s on waivers until <LocalTime iso={player.waiverClearsAt} upcoming />. Claims settle then,
                  </>
                )}{" "}
                in waiver order, and winning one sends you to the back of it.
                {moves.priority && (
                  <>
                    {" "}
                    You&apos;re{" "}
                    <strong className="text-white">
                      #{moves.priority.spot} of {moves.priority.of}
                    </strong>
                    .
                  </>
                )}
              </>
            ) : (
              "He's a free agent, so he joins your roster straight away."
            )}{" "}
            The player you drop goes on waivers.
          </p>
        </div>

        {candidates.length === 0 ? (
          <p className="text-sm text-zinc-300">You don&apos;t have a Tier {player.tier} player to drop for him.</p>
        ) : (
          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-medium text-zinc-300">Drop a Tier {player.tier} player</legend>
            {candidates.map((e) => {
              const problem = problemFor(e);
              return (
                <label
                  key={e.playerId}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    problem ? "text-zinc-500" : "text-zinc-200 hover:bg-zinc-700/60 cursor-pointer"
                  }`}
                  title={problem ?? undefined}
                >
                  <input
                    type="radio"
                    name="drop"
                    value={e.playerId}
                    checked={drop === e.playerId}
                    disabled={!!problem}
                    onChange={() => setDrop(e.playerId)}
                  />
                  <span className="flex-1 truncate">{nameOf(e.playerId)}</span>
                  <span className="text-xs text-zinc-500">{problem ? "In a match" : SLOT_LABEL[e.slot]}</span>
                </label>
              );
            })}
          </fieldset>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${BUTTON} text-zinc-300 hover:text-white`}>
            Close
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!drop || pending}
            className={`${BUTTON} bg-indigo-500 text-on-accent hover:bg-indigo-400`}
          >
            {pending ? "Saving…" : onWaivers ? (currentDrop ? "Update claim" : "Put in claim") : "Add and drop"}
          </button>
        </div>
      </div>
    </div>
  );
}
