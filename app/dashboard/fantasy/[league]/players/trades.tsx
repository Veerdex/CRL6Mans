"use client";

import { useEffect, useState, useTransition } from "react";
import type { PoolPlayer } from "@/app/lib/fantasy-pool-data";
import { TIER_LABEL, TIER_NAME_CLASS, type FantasyTier } from "@/app/lib/fantasy-pool";
import { LINEUP_SLOTS, SLOT_LABEL } from "@/app/lib/fantasy-draft";
import { tradeShapeProblem, type TradeView } from "@/app/lib/fantasy-trades";
import {
  acceptFantasyTrade,
  cancelFantasyTrade,
  dismissFantasyTrade,
  proposeFantasyTrade,
  rejectFantasyTrade,
} from "../../actions";
import type { RosterMoves } from "./move-action";

const BUTTON = "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50";

export type PlayerLookup = (playerId: string) => PoolPlayer | undefined;

function PlayerName({ id, playerOf }: { id: string; playerOf: PlayerLookup }) {
  const p = playerOf(id);
  return <span className={p ? TIER_NAME_CLASS[p.tier] : "text-zinc-300"}>{p?.name ?? "Unknown player"}</span>;
}

export function TradeButton({
  player,
  moves,
  playerOf,
  rosterOf,
}: {
  player: PoolPlayer;
  moves: RosterMoves;
  playerOf: PlayerLookup;
  rosterOf: (managerId: string) => PoolPlayer[];
}) {
  const [open, setOpen] = useState(false);
  const manager = player.manager!;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${BUTTON} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}>
        Trade
      </button>
      {open && (
        <TradeBuilder
          target={player}
          manager={manager}
          theirs={rosterOf(manager.accountId)}
          moves={moves}
          playerOf={playerOf}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function TradeBuilder({
  target,
  manager,
  theirs,
  moves,
  playerOf,
  onClose,
}: {
  target: PoolPlayer;
  manager: { accountId: string; name: string };
  theirs: PoolPlayer[];
  moves: RosterMoves;
  playerOf: PlayerLookup;
  onClose: () => void;
}) {
  const [give, setGive] = useState<Set<string>>(new Set());
  const [get, setGet] = useState<Set<string>>(new Set([target.id]));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mine = [...moves.lineup].sort((a, b) => LINEUP_SLOTS.indexOf(a.slot) - LINEUP_SLOTS.indexOf(b.slot));
  const theirsSorted = [...theirs].sort((a, b) => a.tier - b.tier || (b.rating ?? 0) - (a.rating ?? 0));
  const tiersOf = (ids: Set<string>, source: { id: string; tier: FantasyTier }[]) =>
    source.filter((p) => ids.has(p.id)).map((p) => ({ tier: p.tier }));
  const problem = tradeShapeProblem(
    tiersOf(give, mine.map((e) => ({ id: e.playerId, tier: e.tier }))),
    tiersOf(get, theirsSorted),
  );

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
    setError(null);
  };

  const submit = () =>
    start(async () => {
      const res = await proposeFantasyTrade(moves.leagueId, manager.accountId, [...give], [...get]);
      if (res.error) setError(res.error);
      else onClose();
    });

  const row = (id: string, tier: FantasyTier, checked: boolean, onChange: () => void, detail: string) => (
    <label key={id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700/60 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className={`flex-1 truncate ${TIER_NAME_CLASS[tier]}`}>{playerOf(id)?.name ?? "Unknown player"}</span>
      <span className="text-xs text-zinc-500">{detail}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 text-left" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Trade with ${manager.name}`}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-800 p-4 space-y-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-white">Trade with {manager.name}</h3>
          <p className="text-xs text-zinc-400">
            Like for like: each side gives up the same tiers it gets back. Players arrive in the slots the players they
            replace leave, and points already banked stay where they were scored.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-medium text-zinc-300">You give</legend>
            {mine.map((e) => row(e.playerId, e.tier, give.has(e.playerId), () => toggle(give, setGive, e.playerId), SLOT_LABEL[e.slot]))}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-medium text-zinc-300">You get</legend>
            {theirsSorted.map((p) => row(p.id, p.tier, get.has(p.id), () => toggle(get, setGet, p.id), TIER_LABEL[p.tier]))}
          </fieldset>
        </div>

        {(error ?? (give.size > 0 && problem)) && <p className="text-xs text-red-400">{error ?? problem}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${BUTTON} text-zinc-300 hover:text-white`}>
            Close
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!!problem || pending}
            className={`${BUTTON} bg-indigo-500 text-on-accent hover:bg-indigo-400`}
          >
            {pending ? "Sending…" : "Propose trade"}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<TradeView["status"], { text: string; className: string }> = {
  pending: { text: "Pending", className: "text-amber-300" },
  accepted: { text: "Accepted", className: "text-emerald-400" },
  rejected: { text: "Rejected", className: "text-red-400" },
  cancelled: { text: "Cancelled", className: "text-zinc-400" },
  failed: { text: "Called off", className: "text-zinc-400" },
};

export function TradesPanel({ moves, playerOf }: { moves: RosterMoves; playerOf: PlayerLookup }) {
  if (!moves.trades.length) return null;
  return (
    <section className="rounded-xl border border-zinc-700 bg-zinc-800 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-white">Trades</h2>
      <ul className="space-y-2">
        {moves.trades.map((t) => (
          <TradeRow key={t.id} trade={t} moves={moves} playerOf={playerOf} />
        ))}
      </ul>
    </section>
  );
}

function TradeRow({ trade, moves, playerOf }: { trade: TradeView; moves: RosterMoves; playerOf: PlayerLookup }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const incoming = trade.receiverId === moves.managerId;
  const other = moves.managerNames[incoming ? trade.proposerId : trade.receiverId] ?? "A manager";
  const gets = trade.items.filter((i) => i.fromManagerId !== moves.managerId).map((i) => i.playerId);
  const gives = trade.items.filter((i) => i.fromManagerId === moves.managerId).map((i) => i.playerId);
  const open = trade.status === "pending";
  const status = STATUS_LABEL[trade.status];

  const act = (fn: (leagueId: string, tradeId: string) => Promise<{ error?: string }>) =>
    start(async () => {
      const res = await fn(moves.leagueId, trade.id);
      setError(res.error ?? null);
    });

  const dismiss = () => {
    setHidden(true);
    start(async () => {
      const res = await dismissFantasyTrade(moves.leagueId, trade.id);
      if (res.error) {
        setHidden(false);
        setError(res.error);
      }
    });
  };

  if (hidden) return null;

  const list = (ids: string[]) =>
    ids.map((id, i) => (
      <span key={id}>
        {i > 0 && ", "}
        <PlayerName id={id} playerOf={playerOf} />
      </span>
    ));

  return (
    <li className={`rounded-lg border border-zinc-700 px-3 py-2 text-sm ${open ? "bg-zinc-900/40" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-white">{incoming ? `${other} offers you a trade` : `Your offer to ${other}`}</span>
        <span className={`text-xs ${status.className}`}>{status.text}</span>
        {open && (
          <span className="ml-auto inline-flex gap-1.5">
            {incoming ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(acceptFantasyTrade)}
                  className={`${BUTTON} bg-emerald-600 text-on-accent hover:bg-emerald-500`}
                >
                  Accept
                </button>
                <button type="button" disabled={pending} onClick={() => act(rejectFantasyTrade)} className={`${BUTTON} text-zinc-300 hover:text-white`}>
                  Reject
                </button>
              </>
            ) : (
              <button type="button" disabled={pending} onClick={() => act(cancelFantasyTrade)} className={`${BUTTON} text-zinc-300 hover:text-white`}>
                Cancel
              </button>
            )}
          </span>
        )}
        {!open && (
          <button
            type="button"
            disabled={pending}
            onClick={dismiss}
            className={`ml-auto ${BUTTON} text-zinc-400 hover:text-white`}
          >
            Dismiss
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        You get {list(gets)} · you give {list(gives)}
      </p>
      {trade.note && !open && <p className="mt-1 text-xs text-zinc-500">{trade.note}</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </li>
  );
}
