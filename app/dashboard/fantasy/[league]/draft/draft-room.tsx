"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PoolPlayer } from "@/app/lib/fantasy-pool-data";
import { TIER_LABEL, type FantasyTier } from "@/app/lib/fantasy-pool";
import { makeFantasyPick, triggerFantasyAutopick } from "../../actions";
import { PoolTable } from "../players/pool-table";

const POLL_MS = 10_000;
const YOUR_TURN_SOUND = "/sounds/fantasy-your-turn.mp3";

function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The pick clock, plus the two things that keep the room live: a pulse poll
 * that refreshes the page when the pick moves, and the autopick trigger once
 * the clock runs out (docs/fantasy-rl.md §8). The cron is the backstop for
 * when nobody has the room open.
 */
export function DraftClock({
  leagueId,
  pick,
  deadline,
  firesImmediately,
  yourTurn,
}: {
  leagueId: string;
  pick: number;
  deadline: string | null;
  /** The manager on the clock and staff fire the autopick at once; everyone else waits a jittered few seconds. */
  firesImmediately: boolean;
  yourTurn: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  // Once per pick, so back-to-back picks at the turn of a round each chime.
  // A browser that hasn't seen a click on the page yet blocks the play; the
  // banner still says it.
  const chimedPick = useRef<number | null>(null);
  useEffect(() => {
    if (!yourTurn || chimedPick.current === pick) return;
    chimedPick.current = pick;
    new Audio(YOUR_TURN_SOUND).play().catch(() => {});
  }, [yourTurn, pick]);

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // Compared against the last pulse rather than props, so a refresh still in
  // flight can't queue a second one behind it.
  const lastKey = useRef(`${pick}`);
  useEffect(() => {
    lastKey.current = `${pick}`;
  }, [pick]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/fantasy/draft-pulse?league=${leagueId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const pulse = (await res.json()) as { pick: number; status: string };
        const key = pulse.status === "drafting" ? `${pulse.pick}` : pulse.status;
        if (key === lastKey.current) return;
        lastKey.current = key;
        router.refresh();
      } catch {
        // Transient; the next tick retries.
      }
    };
    const id = setInterval(poll, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [leagueId, router]);

  const [delay] = useState(() => (firesImmediately ? 0 : 4000 + Math.random() * 3000));
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (!deadline || now === null || fired.current === deadline) return;
    if (now - new Date(deadline).getTime() < delay) return;
    fired.current = deadline;
    triggerFantasyAutopick(leagueId).then(() => router.refresh());
  }, [now, deadline, delay, leagueId, router]);

  if (!deadline) return null;
  const left = now === null ? null : new Date(deadline).getTime() - now;
  const color =
    left !== null && left <= 60_000 ? "text-red-400" : left !== null && left <= 180_000 ? "text-amber-400" : "text-zinc-200";
  return (
    <span className={`font-mono text-2xl font-semibold tabular-nums ${color}`} aria-live="off">
      {left === null ? "–:––" : left <= 0 ? "Autopicking…" : formatClock(left)}
    </span>
  );
}

export function DraftPool({
  leagueId,
  players,
  canPick,
  neededTiers,
}: {
  leagueId: string;
  players: PoolPlayer[];
  canPick: boolean;
  neededTiers: FantasyTier[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needed = new Set(neededTiers);

  const draft = (p: PoolPlayer) => {
    setError(null);
    setPickingId(p.id);
    startTransition(async () => {
      const res = await makeFantasyPick(leagueId, p.id);
      if (res.error) setError(res.error);
      router.refresh();
      setPickingId(null);
    });
  };

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-400 text-center">{error}</p>}
      <PoolTable
        players={players}
        defaultAvailableOnly
        renderAction={(p) => {
          if (p.manager) return null;
          const full = !needed.has(p.tier);
          return (
            <button
              type="button"
              disabled={!canPick || full || pending}
              title={full ? `Your ${TIER_LABEL[p.tier]} slots are full` : !canPick ? "It isn't your pick" : undefined}
              onClick={() => draft(p)}
              className="px-3 py-1 rounded-lg text-xs font-semibold transition-colors bg-indigo-600 hover:bg-indigo-500 text-on-accent disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed"
            >
              {pickingId === p.id ? "Drafting…" : "Draft"}
            </button>
          );
        }}
      />
    </div>
  );
}
