import { Suspense } from "react";
import Link from "next/link";
import { getPoolView, type PoolPlayer } from "@/app/lib/fantasy-pool-data";
import { draftPicks, getDraftLeague, managerOnClock } from "@/app/lib/fantasy-draft-server";
import {
  ROSTER_SIZE,
  ROSTER_TIER_LIMITS,
  managerIndexForPick,
  pickRound,
  tierCounts,
  tierNeeded,
  totalDraftPicks,
} from "@/app/lib/fantasy-draft";
import { TIER_LABEL, type FantasyTier } from "@/app/lib/fantasy-pool";
import type { MemberView } from "@/app/lib/fantasy-leagues";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { TabSkeleton } from "../tab-skeleton";
import { TierBadge } from "../players/pool-table";
import { DraftClock, DraftPool } from "./draft-room";

export default function FantasyDraftPage({ params }: { params: Promise<{ league: string }> }) {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Suspense fallback={<TabSkeleton />}>
        <DraftRoom league={leagueFromParams(params)} />
      </Suspense>
    </div>
  );
}

const TIERS: FantasyTier[] = [1, 2, 3];

async function DraftRoom({ league: access }: { league: Promise<LeagueAccess> }) {
  const { viewer, view } = await access;
  const leagueId = view.league.id;

  if (view.league.status === "pre_draft") {
    return <Notice>The draft hasn&apos;t started yet. An admin starts every league&apos;s draft at once.</Notice>;
  }

  const [draft, pool, picks] = await Promise.all([
    getDraftLeague(leagueId),
    getPoolView(leagueId, viewer.isStaff),
    draftPicks(leagueId),
  ]);
  const order = draft?.draft_order ?? [];
  if (!draft || !order.length) return <Notice>The draft is being set up. Check back in a moment.</Notice>;

  const memberById = new Map(view.members.map((m) => [m.accountId, m]));
  const playerById = new Map(pool.players.map((p) => [p.id, p]));
  const n = order.length;
  const total = totalDraftPicks(n);
  const drafting = draft.status === "drafting";
  const onClock = managerOnClock(draft);
  const onClockMember = onClock ? memberById.get(onClock) : undefined;
  const viewerOnClock = !!viewer.accountId && onClock === viewer.accountId;

  const mine = viewer.accountId ? pool.players.filter((p) => p.manager?.accountId === viewer.accountId) : [];
  const counts = tierCounts(mine.map((p) => p.tier));
  const neededTiers = TIERS.filter((t) => tierNeeded(counts, t));

  // The managers picking next, after the one on the clock.
  const upcoming: string[] = [];
  for (let p = draft.current_pick + 1; p < Math.min(total, draft.current_pick + 1 + n); p++) {
    upcoming.push(order[managerIndexForPick(p, n)]);
  }

  return (
    <>
      {drafting ? (
        <section className="bg-zinc-800 border border-zinc-700 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Round {pickRound(draft.current_pick, n)} · Pick {draft.current_pick + 1} of {total}
            </p>
            <div className="mt-2 flex items-center gap-3 min-w-0">
              {onClockMember && <Avatar member={onClockMember} size="w-10 h-10" />}
              <p className="text-lg font-semibold text-white truncate">
                {viewerOnClock ? "You're on the clock" : `${onClockMember?.name ?? "Unknown"} is picking`}
              </p>
            </div>
            {upcoming.length > 0 && (
              <p className="mt-2 text-xs text-zinc-400 truncate">
                Up next: {upcoming.map((id) => (id === viewer.accountId ? "You" : memberById.get(id)?.name ?? "Unknown")).join(" → ")}
              </p>
            )}
          </div>
          <div className="text-center sm:text-right">
            <DraftClock
              leagueId={leagueId}
              pick={draft.current_pick}
              deadline={draft.pick_deadline}
              firesImmediately={viewerOnClock || viewer.isStaff}
            />
            <p className="text-xs text-zinc-500 mt-0.5">until autopick</p>
          </div>
        </section>
      ) : (
        <Notice>
          The draft is complete.{" "}
          <Link href={`/dashboard/fantasy/${leagueId}/roster`} className="text-indigo-300 hover:text-indigo-200 underline">
            See your roster
          </Link>
          .
        </Notice>
      )}

      {drafting && view.isMember && (
        <section className="flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="text-zinc-400">Your roster:</span>
          {TIERS.map((t) => (
            <span
              key={t}
              className={`rounded-lg border px-2.5 py-1 tabular-nums ${
                counts[t] >= ROSTER_TIER_LIMITS[t] ? "border-zinc-700 text-zinc-500" : "border-zinc-600 text-zinc-200"
              }`}
            >
              {TIER_LABEL[t]} {counts[t]}/{ROSTER_TIER_LIMITS[t]}
            </span>
          ))}
        </section>
      )}

      {drafting && (
        <DraftPool
          leagueId={leagueId}
          players={pool.players}
          canPick={viewerOnClock}
          neededTiers={neededTiers}
        />
      )}

      <DraftBoard
        order={order}
        picks={picks}
        currentPick={drafting ? draft.current_pick : -1}
        memberById={memberById}
        playerById={playerById}
        viewerId={viewer.accountId}
      />
    </>
  );
}

function DraftBoard({
  order,
  picks,
  currentPick,
  memberById,
  playerById,
  viewerId,
}: {
  order: string[];
  picks: { pick_no: number; player_id: string; auto: boolean }[];
  currentPick: number;
  memberById: Map<string, MemberView>;
  playerById: Map<string, PoolPlayer>;
  viewerId: string | null;
}) {
  const n = order.length;
  const byPick = new Map(picks.map((p) => [p.pick_no, p]));
  // rows[round][column] is the pick number that lands in that cell.
  const rows: number[][] = Array.from({ length: ROSTER_SIZE }, () => new Array<number>(n));
  for (let p = 0; p < totalDraftPicks(n); p++) rows[pickRound(p, n) - 1][managerIndexForPick(p, n)] = p;

  return (
    <section className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-700">
        <h2 className="text-sm font-semibold text-white">Draft board</h2>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-zinc-400">
              <th className="px-2 py-2 w-10 text-left font-medium">Rd</th>
              {order.map((id) => {
                const m = memberById.get(id);
                return (
                  <th key={id} className={`px-2 py-2 min-w-32 text-left font-medium ${id === viewerId ? "text-indigo-300" : ""}`}>
                    <span className="flex items-center gap-1.5 min-w-0">
                      {m && <Avatar member={m} size="w-5 h-5" />}
                      <span className="truncate">{id === viewerId ? "You" : m?.name ?? "Unknown"}</span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, r) => (
              <tr key={r} className="border-t border-zinc-700/60">
                <td className="px-2 py-1.5 text-zinc-500 tabular-nums">{r + 1}</td>
                {cells.map((pickNo, c) => {
                  const pick = byPick.get(pickNo);
                  const player = pick ? playerById.get(pick.player_id) : undefined;
                  const current = pickNo === currentPick;
                  return (
                    <td
                      key={c}
                      className={`px-2 py-1.5 align-top border-l border-zinc-700/60 ${current ? "bg-indigo-500/15 ring-1 ring-inset ring-indigo-500/60" : ""}`}
                    >
                      {pick ? (
                        <span className="flex items-center gap-1.5 min-w-0">
                          {player && <TierBadge tier={player.tier} />}
                          <span className="truncate text-zinc-100">{player?.name ?? "Unknown"}</span>
                          {pick.auto && <span className="text-[10px] text-amber-400" title="Autopicked">auto</span>}
                        </span>
                      ) : (
                        <span className="text-zinc-600 tabular-nums">{current ? "On the clock" : `#${pickNo + 1}`}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Avatar({ member, size }: { member: MemberView; size: string }) {
  return <PlayerAvatar discordId={member.discordId} avatar={member.avatar} username={member.username ?? member.name} className={size} cdnSize={64} />;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl mx-auto bg-zinc-800 border border-zinc-700 rounded-xl p-6 text-sm text-zinc-300 text-center">{children}</div>
  );
}
