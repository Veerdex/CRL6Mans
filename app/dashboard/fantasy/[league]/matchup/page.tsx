import { Suspense } from "react";
import Link from "next/link";
import { getMatchupData, type ManagerWeek, type SlotLine, type SlotState } from "@/app/lib/fantasy-matchup-server";
import { weekLabel, type Matchup as WeekMatchup, type ScheduleWeek } from "@/app/lib/fantasy-schedule";
import { SLOT_LABEL } from "@/app/lib/fantasy-draft";
import type { MemberView } from "@/app/lib/fantasy-leagues";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import { LocalTime } from "@/app/dashboard/local-time";
import { leagueFromParams, type LeagueAccess } from "../league-access";
import { ComingSoon } from "../coming-soon";
import { TabSkeleton } from "../tab-skeleton";

type Query = { week?: string; manager?: string };

export default function FantasyMatchupPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<Query>;
}) {
  return (
    <Suspense fallback={<TabSkeleton />}>
      <Matchup league={leagueFromParams(params)} query={searchParams} />
    </Suspense>
  );
}

async function Matchup({ league, query }: { league: Promise<LeagueAccess>; query: Promise<Query> }) {
  const [{ viewer, view }, q] = await Promise.all([league, query]);
  const leagueId = view.league.id;

  if (view.league.status !== "active") {
    return (
      <ComingSoon title="Matchup">
        Head-to-head matchups start once the league&apos;s draft is finished and the season is under way.
      </ComingSoon>
    );
  }

  const requestedWeek = q.week && /^\d+$/.test(q.week) ? Number(q.week) : null;
  const data = await getMatchupData(leagueId, viewer.isStaff, requestedWeek);
  if (data.hiddenForTest) return <ComingSoon title="Matchup">Matchups open when the next season starts.</ComingSoon>;
  const week = data.schedule.weeks.find((w) => w.week === data.shownWeek);
  if (!week) {
    return <ComingSoon title="Matchup">This season has no group stage yet, so there are no fantasy weeks to play.</ComingSoon>;
  }

  const member = new Map(view.members.map((m) => [m.accountId, m]));
  const focus =
    (q.manager && week.matchups.find((m) => m.a === q.manager || m.b === q.manager)) ||
    (viewer.accountId && week.matchups.find((m) => m.a === viewer.accountId || m.b === viewer.accountId)) ||
    week.matchups[0];
  // The viewer's own side goes on the left.
  const [left, right] = focus && focus.b === viewer.accountId ? [focus.b, focus.a] : [focus?.a, focus?.b ?? null];
  const base = `/dashboard/fantasy/${leagueId}/matchup`;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <WeekNav weeks={data.schedule.weeks} shown={week.week} current={data.currentWeek} base={base} />

      {week.pending ? (
        <ComingSoon title={weekLabel(week)}>
          {week.kind === "semifinal"
            ? "The top four are seeded 1 v 4 and 2 v 3 once every regular-season week has closed."
            : "The final is set once both semifinals have closed."}
        </ComingSoon>
      ) : (
        <>
          <MatchupPicker week={week} focus={focus} member={member} viewerId={viewer.accountId} base={base} />
          {left && (
            <Board
              week={week}
              left={{ id: left, member: member.get(left), lineup: data.lineups.get(left) }}
              right={right ? { id: right, member: member.get(right), lineup: data.lineups.get(right) } : null}
              winner={focus?.winner ?? null}
              viewerId={viewer.accountId}
            />
          )}
        </>
      )}

      <Standings data={data.schedule.standings} member={member} viewerId={viewer.accountId} champion={data.schedule.champion} />
    </div>
  );
}

function managerName(m: MemberView | undefined, viewerId: string | null) {
  if (!m) return "Former manager";
  return m.accountId === viewerId ? "You" : m.name;
}

function WeekNav({ weeks, shown, current, base }: { weeks: ScheduleWeek[]; shown: number; current: number | null; base: string }) {
  return (
    <nav aria-label="Weeks" className="flex flex-wrap justify-center gap-2">
      {weeks.map((w) => {
        const active = w.week === shown;
        return (
          <Link
            key={w.week}
            href={`${base}?week=${w.week}`}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              active ? "bg-indigo-500 border-indigo-500 text-on-accent" : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {weekLabel(w)}
            {w.week === current && !w.closed && (
              <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-pure-white" : "bg-emerald-400"}`} aria-label="current week" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function MatchupPicker({
  week,
  focus,
  member,
  viewerId,
  base,
}: {
  week: ScheduleWeek;
  focus: WeekMatchup | undefined;
  member: Map<string, MemberView>;
  viewerId: string | null;
  base: string;
}) {
  if (week.matchups.length < 2) return null;
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {week.matchups.map((m) => {
        const active = m === focus;
        return (
          <li key={`${m.a}-${m.b}`}>
            <Link
              href={`${base}?week=${week.week}&manager=${m.a}`}
              aria-current={active ? "true" : undefined}
              className={`block rounded-lg border px-3 py-2 text-xs transition-colors ${
                active ? "border-indigo-500 bg-zinc-800" : "border-zinc-700 bg-zinc-800/60 hover:bg-zinc-800"
              }`}
            >
              <PickerRow name={managerName(member.get(m.a), viewerId)} points={m.aPoints} won={m.winner === m.a} />
              {m.b ? (
                <PickerRow name={managerName(member.get(m.b), viewerId)} points={m.bPoints} won={m.winner === m.b} />
              ) : (
                <div className="text-zinc-500">Bye</div>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function PickerRow({ name, points, won }: { name: string; points: number; won: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`truncate ${won ? "text-white font-semibold" : "text-zinc-300"}`}>{name}</span>
      <span className={`tabular-nums ${won ? "text-white font-semibold" : "text-zinc-400"}`}>{points.toFixed(1)}</span>
    </div>
  );
}

type Side = { id: string; member: MemberView | undefined; lineup: ManagerWeek | undefined };

function Board({
  week,
  left,
  right,
  winner,
  viewerId,
}: {
  week: ScheduleWeek;
  left: Side;
  right: Side | null;
  winner: string | null;
  viewerId: string | null;
}) {
  const leftStarters = left.lineup?.starters ?? [];
  const rightStarters = right?.lineup?.starters ?? [];
  const leftBench = left.lineup?.bench ?? [];
  const rightBench = right?.lineup?.bench ?? [];
  const status = week.closed
    ? winner
      ? `Final · ${winner === viewerId ? "You win" : `${managerName(winner === left.id ? left.member : right?.member, viewerId)} wins`}`
      : right
        ? "Final · Tie"
        : "Final"
    : "In progress";

  return (
    <section className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3 border-b border-zinc-700">
        <ManagerHeader side={left} viewerId={viewerId} won={winner === left.id} align="left" />
        <div className="text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{weekLabel(week)}</div>
          <div className={`text-[11px] ${week.closed ? "text-zinc-300" : "text-emerald-400"}`}>{status}</div>
        </div>
        {right ? (
          <ManagerHeader side={right} viewerId={viewerId} won={winner === right.id} align="right" />
        ) : (
          <div className="text-right text-sm text-zinc-500">Bye week · no opponent</div>
        )}
      </header>

      <ul className="divide-y divide-zinc-700/60">
        {leftStarters.map((line, i) => (
          <BoardRow key={line.slot} label={SLOT_LABEL[line.slot]} left={line} right={rightStarters[i] ?? null} hasRight={!!right} />
        ))}
      </ul>

      {(leftBench.length > 0 || rightBench.length > 0) && (
        <>
          <div className="px-4 py-1.5 border-t-2 border-zinc-600 bg-zinc-900/40 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Bench · scores nothing
          </div>
          <ul className="divide-y divide-zinc-700/60 opacity-75">
            {leftBench.map((line, i) => (
              <BoardRow key={line.slot} label="BN" left={line} right={rightBench[i] ?? null} hasRight={!!right} bench />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ManagerHeader({ side, viewerId, won, align }: { side: Side; viewerId: string | null; won: boolean; align: "left" | "right" }) {
  const m = side.member;
  return (
    <div className={`flex items-center gap-2 min-w-0 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      {m && <PlayerAvatar discordId={m.discordId} avatar={m.avatar} username={m.username ?? m.name} className="w-8 h-8" cdnSize={64} />}
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white truncate">{managerName(m, viewerId)}</div>
        <div className={`text-xl font-bold tabular-nums ${won ? "text-emerald-400" : "text-white"}`}>
          {(side.lineup?.total ?? 0).toFixed(1)}
        </div>
      </div>
    </div>
  );
}

function BoardRow({
  label,
  left,
  right,
  hasRight,
  bench = false,
}: {
  label: string;
  left: SlotLine;
  right: SlotLine | null;
  hasRight: boolean;
  bench?: boolean;
}) {
  return (
    <li className="grid grid-cols-[1fr_3rem_2.5rem_3rem_1fr] sm:grid-cols-[1fr_3.5rem_3rem_3.5rem_1fr] items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2">
      <PlayerCell line={left} align="left" />
      <Points state={left.state} bench={bench} align="right" />
      <span className="text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      {hasRight && right ? <Points state={right.state} bench={bench} align="left" /> : <span />}
      {hasRight && right ? <PlayerCell line={right} align="right" /> : <span />}
    </li>
  );
}

function Points({ state, bench, align }: { state: SlotState; bench: boolean; align: "left" | "right" }) {
  const side = align === "right" ? "text-right" : "text-left";
  if (state.kind === "scored") {
    return <span className={`${side} text-sm font-semibold tabular-nums text-white`}>{state.points.toFixed(1)}</span>;
  }
  return <span className={`${side} text-sm tabular-nums text-zinc-600`}>{bench ? "" : "—"}</span>;
}

function PlayerCell({ line, align }: { line: SlotLine; align: "left" | "right" }) {
  const right = align === "right";
  const { player, state } = line;
  if (!player) {
    return (
      <div className={`flex items-center gap-2 min-w-0 ${right ? "flex-row-reverse text-right" : ""}`}>
        <span className="w-7 h-7 shrink-0 rounded-full border border-dashed border-zinc-600" aria-hidden />
        <span className="text-xs text-zinc-500 truncate">{state.kind === "missed" ? "No score" : "Empty"}</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 min-w-0 ${right ? "flex-row-reverse text-right" : ""}`}>
      <PlayerAvatar discordId={player.discordId} avatar={player.avatar} username={player.username} className="w-7 h-7" cdnSize={64} />
      <div className="min-w-0">
        <div className={`flex whitespace-nowrap ${right ? "justify-end" : ""}`}>
          <PlayerName displayName={player.name} username={player.username} discordId={player.discordId || null} className="text-sm text-white truncate" />
        </div>
        <StateLine state={state} team={player.team?.name ?? null} />
      </div>
    </div>
  );
}

function StateLine({ state, team }: { state: SlotState; team: string | null }) {
  const cls = "block text-[11px] truncate";
  switch (state.kind) {
    case "scored":
      return <span className={`${cls} text-zinc-400`}>{state.forfeit ? "Series forfeited" : team ?? "Final"}</span>;
    case "live":
      return <span className={`${cls} text-amber-400`}>Playing now · locked</span>;
    case "upcoming":
      return (
        <span className={`${cls} text-zinc-400`}>
          {state.opponent ? `vs ${state.opponent}` : "Opponent TBD"}
          {state.at ? (
            <>
              {" · "}
              <LocalTime iso={state.at} upcoming />
            </>
          ) : (
            " · not scheduled"
          )}
        </span>
      );
    case "bye":
      return (
        <span className={`${cls} text-zinc-400`}>
          <span className="rounded bg-zinc-700 px-1 font-semibold text-zinc-200">BYE</span> no series this week
        </span>
      );
    case "forfeit":
      return <span className={`${cls} text-zinc-400`}>Forfeited · slot still open</span>;
    case "spent":
      return <span className={`${cls} text-zinc-500`}>Played outside this slot</span>;
    case "ineligible":
      return <span className={`${cls} text-red-400`}>Ineligible · not on a team</span>;
    default:
      return <span className={`${cls} text-zinc-400`}>{team ?? ""}</span>;
  }
}

function Standings({
  data,
  member,
  viewerId,
  champion,
}: {
  data: { managerId: string; wins: number; losses: number; ties: number; pointsFor: number }[];
  member: Map<string, MemberView>;
  viewerId: string | null;
  champion: string | null;
}) {
  const anyTies = data.some((s) => s.ties > 0);
  return (
    <section className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-700 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Standings</h2>
        {champion && <span className="text-xs text-amber-300">Champion: {managerName(member.get(champion), viewerId)}</span>}
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
            <th className="w-10 px-4 py-2 text-left font-semibold">#</th>
            <th className="px-2 py-2 text-left font-semibold">Manager</th>
            <th className="px-2 py-2 text-right font-semibold">{anyTies ? "W-L-T" : "W-L"}</th>
            <th className="px-4 py-2 text-right font-semibold">Pts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-700/60">
          {data.map((s, i) => {
            const m = member.get(s.managerId);
            return (
              <tr key={s.managerId} className={s.managerId === viewerId ? "bg-zinc-700/30" : undefined}>
                <td className="px-4 py-2 text-zinc-400 tabular-nums">{i + 1}</td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2 min-w-0">
                    {m && <PlayerAvatar discordId={m.discordId} avatar={m.avatar} username={m.username ?? m.name} className="w-5 h-5" cdnSize={32} />}
                    <span className="text-white truncate">{managerName(m, viewerId)}</span>
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-zinc-300">
                  {s.wins}-{s.losses}
                  {anyTies ? `-${s.ties}` : ""}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-300">{s.pointsFor.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 border-t border-zinc-700 text-[11px] text-zinc-500">
        Regular-season weeks only, counted once a week closes. Ties in the record break on total points. The top four go
        to the playoffs.
      </p>
    </section>
  );
}
