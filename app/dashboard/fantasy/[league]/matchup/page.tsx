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
  const records = new Map(
    data.schedule.standings.map((s) => [s.managerId, `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`]),
  );

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
          {left && (
            <Board
              week={week}
              left={{ id: left, member: member.get(left), lineup: data.lineups.get(left) }}
              right={right ? { id: right, member: member.get(right), lineup: data.lineups.get(right) } : null}
              winner={focus?.winner ?? null}
              viewerId={viewer.accountId}
              records={records}
            />
          )}
          <MatchupPicker week={week} focus={focus} member={member} viewerId={viewer.accountId} base={base} />
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
  // The board already shows the focused matchup, so only the others are listed.
  const others = week.matchups.filter((m) => m !== focus);
  if (!others.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Other matchups</div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {others.map((m) => (
          <li key={`${m.a}-${m.b}`}>
            <Link
              href={`${base}?week=${week.week}&manager=${m.a}`}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-800"
            >
              <span className={`truncate ${m.winner === m.a ? "text-white font-semibold" : "text-zinc-300"}`}>
                {managerName(member.get(m.a), viewerId)}
              </span>
              <span className="tabular-nums text-zinc-400">
                {m.b ? `${m.aPoints.toFixed(1)} – ${m.bPoints.toFixed(1)}` : "Bye"}
              </span>
              <span className={`truncate text-right ${m.winner === m.b ? "text-white font-semibold" : "text-zinc-300"}`}>
                {m.b ? managerName(member.get(m.b), viewerId) : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
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
  records,
}: {
  week: ScheduleWeek;
  left: Side;
  right: Side | null;
  winner: string | null;
  viewerId: string | null;
  records: Map<string, string>;
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

  const leftProjected = projectedTotal(leftStarters);
  const rightProjected = right ? projectedTotal(rightStarters) : null;

  return (
    <section className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
      <header className="grid grid-cols-2 gap-3 px-4 pt-4 pb-3 border-b border-zinc-700">
        <ManagerHeader
          side={left}
          viewerId={viewerId}
          won={winner === left.id}
          record={records.get(left.id)}
          projected={week.closed ? null : leftProjected}
          ahead={rightProjected === null || leftProjected >= rightProjected}
          align="left"
        />
        {right ? (
          <ManagerHeader
            side={right}
            viewerId={viewerId}
            won={winner === right.id}
            record={records.get(right.id)}
            projected={week.closed ? null : rightProjected}
            ahead={rightProjected !== null && rightProjected >= leftProjected}
            align="right"
          />
        ) : (
          <div className="self-center text-right text-sm text-zinc-500">Bye week · no opponent</div>
        )}
        <div className="col-span-2 text-center text-[11px] font-semibold uppercase tracking-wide">
          <span className="text-zinc-400">{weekLabel(week)}</span>
          <span className={week.closed ? "text-zinc-300" : "text-emerald-400"}> · {status}</span>
        </div>
      </header>

      <ul className="p-1.5 space-y-1.5">
        {leftStarters.map((line, i) => (
          <BoardRow key={line.slot} label={SLOT_LABEL[line.slot]} left={line} right={rightStarters[i] ?? null} hasRight={!!right} />
        ))}
      </ul>

      {(leftBench.length > 0 || rightBench.length > 0) && (
        <>
          <div className="px-4 py-1.5 border-t border-zinc-700 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Bench · scores nothing
          </div>
          <ul className="px-1.5 pb-1.5 space-y-1.5 opacity-75">
            {leftBench.map((line, i) => (
              <BoardRow key={line.slot} label="BN" left={line} right={rightBench[i] ?? null} hasRight={!!right} />
            ))}
          </ul>
        </>
      )}

      {!week.closed && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4 border-t border-zinc-700 bg-zinc-900/50">
          <span className="text-center text-3xl font-bold tabular-nums text-white">{leftProjected.toFixed(1)}</span>
          <span className="text-center text-sm font-bold leading-tight text-zinc-200">
            Projected
            <br />
            Totals
          </span>
          <span className="text-center text-3xl font-bold tabular-nums text-white">{rightProjected?.toFixed(1) ?? ""}</span>
        </div>
      )}
    </section>
  );
}

// The number beside a player: points once scored, the projection while still to play.
function slotValue(line: SlotLine | null): { value: number; scored: boolean } | null {
  if (!line) return null;
  if (line.state.kind === "scored") return { value: line.state.points, scored: true };
  if ((line.state.kind === "live" || line.state.kind === "upcoming") && line.player) return { value: line.player.projected, scored: false };
  return null;
}

// Points already banked plus the projection of every starter still to play.
function projectedTotal(starters: SlotLine[]) {
  return starters.reduce((sum, line) => sum + (slotValue(line)?.value ?? 0), 0);
}

function ManagerHeader({
  side,
  viewerId,
  won,
  record,
  projected,
  ahead,
  align,
}: {
  side: Side;
  viewerId: string | null;
  won: boolean;
  record: string | undefined;
  projected: number | null;
  ahead: boolean;
  align: "left" | "right";
}) {
  const m = side.member;
  const right = align === "right";
  return (
    <div className={`min-w-0 ${right ? "text-right" : ""}`}>
      <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
        {m && <PlayerAvatar discordId={m.discordId} avatar={m.avatar} username={m.username ?? m.name} className="w-12 h-12 sm:w-14 sm:h-14" cdnSize={128} />}
        <div>
          <div className={`text-3xl sm:text-4xl font-bold leading-none tabular-nums ${won ? "text-emerald-400" : "text-white"}`}>
            {(side.lineup?.total ?? 0).toFixed(1)}
          </div>
          {projected !== null && (
            <div className={`mt-1 flex items-center gap-1 text-xs tabular-nums text-zinc-400 ${right ? "flex-row-reverse" : ""}`}>
              {projected.toFixed(1)}
              <span className={ahead ? "text-emerald-400" : "text-red-400"} aria-label={ahead ? "projected to win" : "projected to lose"}>
                {ahead ? "▲" : "▼"}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 text-sm font-semibold text-white truncate">{managerName(m, viewerId)}</div>
      {record && <div className="text-xs text-zinc-400">{record}</div>}
    </div>
  );
}

function BoardRow({ label, left, right, hasRight }: { label: string; left: SlotLine; right: SlotLine | null; hasRight: boolean }) {
  const a = slotValue(left);
  const b = hasRight ? slotValue(right) : null;
  // Only real points win a slot; projections never earn the check.
  const bothScored = !!a?.scored && !!b?.scored;
  const leftBest = bothScored && a!.value > b!.value;
  const rightBest = bothScored && b!.value > a!.value;
  return (
    <li className="grid grid-cols-[1fr_2.5rem_1fr] sm:grid-cols-[1fr_3rem_1fr] items-stretch rounded-lg bg-zinc-900/60 overflow-hidden">
      <div className="flex items-center gap-2 px-2 sm:px-3 py-2.5 min-w-0">
        <div className="flex-1 min-w-0">
          <PlayerCell line={left} align="left" />
        </div>
        <SlotNumber value={a} best={leftBest} align="right" />
      </div>
      <span className="flex items-center justify-center bg-black/25 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      {hasRight && right ? (
        <div className="flex items-center gap-2 px-2 sm:px-3 py-2.5 min-w-0">
          <SlotNumber value={b} best={rightBest} align="left" />
          <div className="flex-1 min-w-0">
            <PlayerCell line={right} align="right" />
          </div>
        </div>
      ) : (
        <span />
      )}
    </li>
  );
}

function SlotNumber({ value, best, align }: { value: { value: number; scored: boolean } | null; best: boolean; align: "left" | "right" }) {
  if (!value) return <span className="w-14 shrink-0 text-center text-sm text-zinc-600">—</span>;
  const check = best ? (
    <span className="text-emerald-400" aria-label="higher">
      ✓
    </span>
  ) : null;
  return (
    <span
      className={`w-14 sm:w-16 shrink-0 flex items-center gap-1 text-sm tabular-nums ${align === "right" ? "justify-end" : "justify-start"} ${
        value.scored ? "font-semibold text-white" : "text-zinc-400"
      }`}
      title={value.scored ? "Points" : "Projected"}
    >
      {align === "right" && check}
      {value.value.toFixed(1)}
      {align === "left" && check}
    </span>
  );
}

function PlayerCell({ line, align }: { line: SlotLine; align: "left" | "right" }) {
  const right = align === "right";
  const { player, state } = line;
  if (!player) {
    return (
      <div className={`flex items-center gap-2 min-w-0 ${right ? "flex-row-reverse text-right" : ""}`}>
        <span className="hidden sm:block w-7 h-7 shrink-0 rounded-full border border-dashed border-zinc-600" aria-hidden />
        <span className="text-xs text-zinc-500 truncate">{state.kind === "missed" ? "No score" : "Empty"}</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 min-w-0 ${right ? "flex-row-reverse text-right" : ""}`}>
      <span className="hidden sm:block shrink-0">
        <PlayerAvatar discordId={player.discordId} avatar={player.avatar} username={player.username} className="w-7 h-7" cdnSize={64} />
      </span>
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
