import type { ReactNode } from "react";
import { WeekSwitcher, MatchupSwitcher, type MatchupChip } from "./matchup-switcher";
import type { ManagerWeek, SlotLine, SlotState } from "@/app/lib/fantasy-matchup-server";
import {
  weekLabel,
  winChance,
  type Matchup as WeekMatchup,
  type Schedule,
  type ScheduleWeek,
  type SideOutlook,
} from "@/app/lib/fantasy-schedule";
import { SLOT_LABEL } from "@/app/lib/fantasy-draft";
import { TIER_NAME_CLASS } from "@/app/lib/fantasy-pool";
import type { MemberView } from "@/app/lib/fantasy-leagues";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { PlayerName } from "@/app/dashboard/player-name";
import { LocalTime } from "@/app/dashboard/local-time";
import { ComingSoon } from "../coming-soon";

// The Matchup tab's rendering, kept apart from the page's data loading so
// app/preview/fantasy-matchup can draw it from mock data.
export function MatchupView({
  schedule,
  lineups,
  currentWeek,
  shownWeek,
  members,
  viewerId,
  focusManager,
}: {
  schedule: Schedule;
  lineups: Map<number, Map<string, ManagerWeek>>;
  currentWeek: number | null;
  shownWeek: ScheduleWeek;
  members: MemberView[];
  viewerId: string | null;
  focusManager: string | null;
}) {
  const member = new Map(members.map((m) => [m.accountId, m]));
  const records = new Map(schedule.standings.map((s) => [s.managerId, `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`]));

  const panels: Record<number, ReactNode> = {};
  for (const w of schedule.weeks) {
    panels[w.week] = (
      <WeekPanel
        week={w}
        lineups={lineups.get(w.week)}
        member={member}
        viewerId={viewerId}
        records={records}
        focusManager={w.week === shownWeek.week ? focusManager : null}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <WeekSwitcher
        tabs={schedule.weeks.map((w) => ({ week: w.week, label: weekLabel(w), current: w.week === currentWeek && !w.closed }))}
        initial={shownWeek.week}
        panels={panels}
      />
      <Standings data={schedule.standings} member={member} viewerId={viewerId} champion={schedule.champion} />
    </div>
  );
}

function managerName(m: MemberView | undefined, viewerId: string | null) {
  if (!m) return "Former manager";
  return m.accountId === viewerId ? "You" : m.name;
}

function WeekPanel({
  week,
  lineups,
  member,
  viewerId,
  records,
  focusManager,
}: {
  week: ScheduleWeek;
  lineups: Map<string, ManagerWeek> | undefined;
  member: Map<string, MemberView>;
  viewerId: string | null;
  records: Map<string, string>;
  focusManager: string | null;
}) {
  if (week.pending) {
    return (
      <ComingSoon title={weekLabel(week)}>
        {week.kind === "semifinal"
          ? "The top four are seeded 1 v 4 and 2 v 3 once every regular-season week has closed."
          : "The final is set once both semifinals have closed."}
      </ComingSoon>
    );
  }
  const involves = (m: WeekMatchup, id: string | null) => !!id && (m.a === id || m.b === id);
  const found = week.matchups.findIndex((m) => involves(m, focusManager));
  const own = week.matchups.findIndex((m) => involves(m, viewerId));
  const initial = found >= 0 ? found : own >= 0 ? own : 0;

  const boards = week.matchups.map((m) => {
    // The viewer's own side goes on the left.
    const [left, right] = m.b && m.b === viewerId ? [m.b, m.a] : [m.a, m.b];
    return (
      <Board
        key={m.a}
        week={week}
        left={{ id: left, member: member.get(left), lineup: lineups?.get(left) }}
        right={right ? { id: right, member: member.get(right), lineup: lineups?.get(right) } : null}
        winner={m.winner}
        viewerId={viewerId}
        records={records}
      />
    );
  });
  const chips: MatchupChip[] = week.matchups.map((m) => ({
    managerId: m.a,
    a: managerName(member.get(m.a), viewerId),
    b: m.b ? managerName(member.get(m.b), viewerId) : null,
    score: m.b ? `${m.aPoints.toFixed(1)} – ${m.bPoints.toFixed(1)}` : "Bye",
    aWon: m.winner === m.a,
    bWon: !!m.b && m.winner === m.b,
  }));
  return <MatchupSwitcher key={week.week} week={week.week} chips={chips} boards={boards} initial={initial} />;
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
    <section className="-mx-4 sm:mx-0 bg-zinc-800 border-y sm:border border-zinc-700 sm:rounded-xl overflow-hidden">
      <header className="grid grid-cols-[1fr_auto_1fr] gap-2 sm:gap-3 px-4 pt-4 pb-3 border-b border-zinc-700">
        <ManagerHeader
          side={left}
          viewerId={viewerId}
          won={winner === left.id}
          record={records.get(left.id)}
          projected={week.closed ? null : leftProjected}
          ahead={rightProjected === null || leftProjected >= rightProjected}
          align="left"
        />
        {right && !week.closed ? (
          <WinChance p={winChance(outlook(leftStarters), outlook(rightStarters))} />
        ) : (
          <span />
        )}
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
        <div className="col-span-3 text-center text-[11px] font-semibold uppercase tracking-wide">
          <span className="text-zinc-400">{weekLabel(week)}</span>
          <span className={week.closed ? "text-zinc-300" : "text-emerald-400"}> · {status}</span>
        </div>
      </header>

      <ul className="p-1 sm:p-1.5 space-y-1 sm:space-y-1.5">
        {leftStarters.map((line, i) => (
          <BoardRow key={line.slot} label={SLOT_LABEL[line.slot]} left={line} right={rightStarters[i] ?? null} hasRight={!!right} />
        ))}
      </ul>

      {(leftBench.length > 0 || rightBench.length > 0) && (
        <>
          <div className="px-4 py-1.5 border-t border-zinc-700 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Bench · scores nothing
          </div>
          <ul className="px-1 pb-1 sm:px-1.5 sm:pb-1.5 space-y-1 sm:space-y-1.5 opacity-75">
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

// What a slot has scored: its points once played, 0 until then, nothing for an empty or missed slot.
type SlotScore = { points: number; scored: boolean; projected: number | null };

function slotScore(line: SlotLine | null): SlotScore | null {
  if (!line || !line.player) return null;
  if (line.state.kind === "scored") return { points: line.state.points, scored: true, projected: line.projected };
  return { points: 0, scored: false, projected: line.projected };
}

// Points already banked plus the projection of every starter still to play.
function projectedTotal(starters: SlotLine[]) {
  const o = outlook(starters);
  return o.banked + o.remaining.reduce((s, p) => s + p, 0);
}

function outlook(starters: SlotLine[]): SideOutlook {
  const side: SideOutlook = { banked: 0, remaining: [] };
  for (const line of starters) {
    if (line.state.kind === "scored") side.banked += line.state.points;
    else if (line.projected !== null) side.remaining.push(line.projected);
  }
  return side;
}

// The favourite's chance, with the arrow on their side. Never 100% while a
// series is still to play, however lopsided.
function WinChance({ p }: { p: number }) {
  const settled = p === 0 || p === 1;
  const raw = Math.round(Math.max(p, 1 - p) * 100);
  const pct = settled ? raw : Math.min(99, raw);
  const leftFav = p > 0.5 && pct > 50;
  const rightFav = p < 0.5 && pct > 50;
  const arrow = "text-emerald-400 text-sm";
  return (
    <div className="self-center flex flex-col items-center">
      <div
        className="flex items-center gap-1 text-lg sm:text-xl font-bold tabular-nums text-white"
        aria-label={`${leftFav ? "Left" : rightFav ? "Right" : "Neither"} side favoured, ${pct}% to win`}
      >
        {leftFav && <span className={arrow}>◀</span>}
        {pct}%
        {rightFav && <span className={arrow}>▶</span>}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Win odds</div>
    </div>
  );
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
  const a = slotScore(left);
  const b = hasRight ? slotScore(right) : null;
  // Only a slot both sides have played can be won.
  const bothScored = !!a?.scored && !!b?.scored;
  const leftBest = bothScored && a!.points > b!.points;
  const rightBest = bothScored && b!.points > a!.points;
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

// Points as the main number, the projection in a pill under it. Once the series
// is in, the points turn green or red for beating or missing the projection.
function SlotNumber({ value, best, align }: { value: SlotScore | null; best: boolean; align: "left" | "right" }) {
  if (!value) return <span className="w-14 sm:w-16 shrink-0 text-center text-sm text-zinc-600">—</span>;
  const { points, scored, projected } = value;
  const tone = !scored
    ? "text-zinc-300"
    : projected === null || points.toFixed(1) === projected.toFixed(1)
      ? "text-white"
      : points > projected
        ? "text-emerald-400"
        : "text-red-400";
  const check = best ? (
    <span className="text-emerald-400" aria-label="higher">
      ✓
    </span>
  ) : null;
  const end = align === "right";
  return (
    <span className={`w-14 sm:w-16 shrink-0 flex flex-col gap-0.5 ${end ? "items-end" : "items-start"}`}>
      <span className={`flex items-center gap-1 text-sm font-semibold tabular-nums ${tone}`} title="Points">
        {end && check}
        {points.toFixed(1)}
        {!end && check}
      </span>
      {projected !== null && (
        <span
          className="rounded-full border border-zinc-700 bg-zinc-800 px-1.5 text-[10px] leading-4 tabular-nums text-zinc-400"
          title="Projected"
        >
          {projected.toFixed(1)}
        </span>
      )}
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
          <PlayerName displayName={player.name} username={player.username} discordId={player.discordId || null} className={`text-sm font-medium truncate ${TIER_NAME_CLASS[player.tier]}`} />
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
              <LocalTime iso={state.at} weekday />
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
