import { supabaseAdmin } from "@/app/lib/supabase";
import { BracketCanvas } from "./bracket-canvas";
import {
  getRoundName, getMatchLabel, getLBMatchLabel, getFeederLabel,
  DE_WINNERS, DE_LOSERS, DE_GF,
  DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS,
  getDEWBRounds, getDELBRounds,
  getDEWBFeederLabel, getDELBFeederLabel,
  GROUP_STAGE_PREFIX, parseGroupNum,
} from "@/app/lib/bracket";
import { GroupStageClient } from "./group-stage-client";

const MATCH_H = 68;
const MATCH_W = 210;
const BASE_SLOT = 108;
const CONN_W = 48;

type DBMatch = {
  id: string;
  round: number;
  match_number: number;
  stage: string;
  status: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

type Team = { id: string; name: string; logo_url: string | null };

// ── Match state ───────────────────────────────────────────────────────────────

type MatchState = "bye" | "pending" | "waiting" | "ready" | "completed";

function getMatchState(m: DBMatch): MatchState {
  const hasScores = m.home_score !== null && m.away_score !== null;
  const homeSet = m.home_team_id !== null;
  const awaySet = m.away_team_id !== null;

  if (hasScores && (!homeSet || !awaySet)) return "bye";      // auto-win, one slot empty
  if (hasScores) return "completed";                           // result recorded
  if (homeSet && awaySet) return "ready";                      // both teams, no result yet
  if (homeSet || awaySet) return "waiting";                    // one team advanced, other TBD
  return "pending";                                            // both TBD
}

function slotLabel(
  teamId: string | null,
  match: DBMatch,
  slot: "home" | "away",
  teams: Record<string, Team>,
  numR1: number
): string {
  if (teamId) return teams[teamId]?.name ?? "?";
  const hasScores = match.home_score !== null || match.away_score !== null;
  if (hasScores) return "BYE";
  return getFeederLabel(match.round, match.match_number, slot, numR1);
}

// ── Styles per state ──────────────────────────────────────────────────────────

const STATE_STYLES: Record<MatchState, { card: string; label: string }> = {
  bye:       { card: "border-zinc-700/60 bg-zinc-900/40",                                    label: "text-[10px] font-semibold text-zinc-500 uppercase tracking-widest" },
  pending:   { card: "border-red-700/50 bg-red-950/20",                                      label: "text-[10px] font-semibold text-red-500 uppercase tracking-widest" },
  waiting:   { card: "border-amber-700/50 bg-amber-950/20",                                  label: "text-[10px] font-semibold text-amber-500 uppercase tracking-widest" },
  ready:     { card: "border-indigo-500/60 bg-indigo-950/25 shadow-indigo-900/30 shadow-md", label: "text-[10px] font-semibold text-indigo-400 uppercase tracking-widest" },
  completed: { card: "border-emerald-600/70 bg-emerald-950/30",                              label: "text-[10px] font-semibold text-emerald-400 uppercase tracking-widest" },
};

const STATE_LABELS: Record<MatchState, string> = {
  bye:       "BYE",
  pending:   "TBD",
  waiting:   "WAITING",
  ready:     "UPCOMING",
  completed: "FINAL",
};

// Small logo (or fallback dot) placed at the start of a team slot row.
function TeamLogo({ team, faded }: { team: Team | null; faded: boolean }) {
  if (!team) return <div className="w-2 h-2 rounded-full shrink-0 bg-zinc-700" />;
  if (!team.logo_url) return <div className="w-2 h-2 rounded-full shrink-0 bg-zinc-400" />;
  return (
    <img
      src={team.logo_url}
      alt=""
      className={`w-4 h-4 rounded shrink-0 object-cover ${faded ? "opacity-40" : ""}`}
    />
  );
}

// Renders a slot that has no team set.
// "Winner of X" / "Loser of X" labels become clickable with data-goto for canvas navigation.
function SlotText({ label, faded }: { label: string; faded: boolean }) {
  const m = label.match(/^(?:Winner|Loser) of (.+)$/);
  if (m) {
    return (
      <span
        data-goto={m[1]}
        className="flex-1 text-xs truncate cursor-pointer text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-300"
      >
        {label}
      </span>
    );
  }
  return (
    <span className={`flex-1 text-xs truncate ${faded ? "text-zinc-600 italic" : "text-zinc-300"}`}>
      {label}
    </span>
  );
}

// ── Match box ─────────────────────────────────────────────────────────────────

function MatchBox({ match, teams, numR1, matchId }: { match: DBMatch; teams: Record<string, Team>; numR1: number; matchId?: string }) {
  const state = getMatchState(match);
  const { card } = STATE_STYLES[state];
  const stateLabel = STATE_LABELS[state];
  const isBye = state === "bye";

  const completed = state === "completed";
  const homeWon = completed && (match.home_score ?? 0) > (match.away_score ?? 0);
  const awayWon = completed && (match.away_score ?? 0) > (match.home_score ?? 0);

  const homeLabel = slotLabel(match.home_team_id, match, "home", teams, numR1);
  const awayLabel = slotLabel(match.away_team_id, match, "away", teams, numR1);

  const homeFaded = !match.home_team_id || (completed && !homeWon);
  const awayFaded = !match.away_team_id || (completed && !awayWon);

  return (
    <div
      className={`rounded-lg overflow-hidden border ${card}`}
      style={{ width: MATCH_W, height: MATCH_H }}
      data-match-id={matchId}
    >
      {/* Home row */}
      <div className={`flex items-center gap-2 px-2 py-0.5 ${homeWon ? "bg-white/5 rounded mx-1" : ""}`} style={{ height: 33 }}>
        <TeamLogo team={match.home_team_id ? teams[match.home_team_id] : null} faded={homeFaded} />
        {match.home_team_id ? (
          <a href={`/dashboard/teams?search=${encodeURIComponent(teams[match.home_team_id]?.name ?? "")}&from=season`}
            className={`flex-1 text-xs truncate hover:underline ${homeWon ? "text-white font-semibold" : "text-zinc-300"}`}>
            {homeLabel}
          </a>
        ) : <SlotText label={homeLabel} faded={homeFaded} />}
        {completed && match.home_score !== null && (
          <span className={`text-xs font-mono font-bold shrink-0 w-4 text-right ${homeWon ? "text-white" : "text-zinc-500"}`}>{match.home_score}</span>
        )}
      </div>
      <div className="h-px bg-zinc-700/50 mx-2" />
      {/* Away row */}
      <div className={`flex items-center gap-2 px-2 py-0.5 ${awayWon ? "bg-white/5 rounded mx-1" : ""}`} style={{ height: 33 }}>
        <TeamLogo team={match.away_team_id ? teams[match.away_team_id] : null} faded={awayFaded} />
        {match.away_team_id ? (
          <a href={`/dashboard/teams?search=${encodeURIComponent(teams[match.away_team_id]?.name ?? "")}&from=season`}
            className={`flex-1 text-xs truncate hover:underline ${awayWon ? "text-white font-semibold" : "text-zinc-300"}`}>
            {awayLabel}
          </a>
        ) : <SlotText label={awayLabel} faded={awayFaded} />}
        {completed && match.away_score !== null && (
          <span className={`text-xs font-mono font-bold shrink-0 w-4 text-right ${awayWon ? "text-white" : "text-zinc-500"}`}>{match.away_score}</span>
        )}
      </div>
    </div>
  );
}

// ── Layout helpers ────────────────────────────────────────────────────────────

// SE / WB: spacing doubles every round
function matchCenter(round: number, matchNum: number): number {
  return BASE_SLOT * Math.pow(2, round - 1) * (matchNum - 0.5);
}

// LB: spacing doubles every TWO rounds (feed→drop same spacing, then consolidation doubles it)
function matchCenterLB(round: number, matchNum: number): number {
  return BASE_SLOT * Math.pow(2, Math.ceil(round / 2) - 1) * (matchNum - 0.5);
}

function getLBRoundName(roundNum: number, totalRounds: number): string {
  const fromEnd = totalRounds - roundNum;
  if (fromEnd === 0) return "LB Finals";
  if (fromEnd === 1) return "LB Semis";
  if (fromEnd === 2) return "LB Quarters";
  return `LB Round ${roundNum}`;
}

function matchTop(round: number, matchNum: number): number {
  return matchCenter(round, matchNum) - MATCH_H / 2;
}

// ── Main component ────────────────────────────────────────────────────────────

export async function SEBracketView({ stage = "single_elimination" }: { stage?: string } = {}) {
  const [{ data: matchesRaw }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select("id, round, match_number, stage, status, home_team_id, away_team_id, home_score, away_score")
      .eq("stage", stage)
      .order("round", { ascending: true })
      .order("match_number", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name, logo_url"),
  ]);

  if (!matchesRaw?.length) {
    return (
      <p className="text-zinc-500 text-sm">No bracket matches found.</p>
    );
  }

  const teams: Record<string, Team> = {};
  teamsRaw?.forEach((t) => { teams[t.id] = t; });

  const roundNums = [...new Set(matchesRaw.map((m) => m.round))].sort((a, b) => a - b);
  const totalRounds = roundNums.length;
  const numR1Matches = matchesRaw.filter((m) => m.round === 1).length;
  const bracketH = BASE_SLOT * numR1Matches;

  // Legend
  const legendItems: { state: MatchState; label: string }[] = [
    { state: "completed", label: "Completed" },
    { state: "ready",     label: "Upcoming" },
    { state: "waiting",   label: "Waiting" },
    { state: "pending",   label: "TBD" },
    { state: "bye",       label: "Bye" },
  ];

  return (
    <div className="space-y-3">
      {/* Legend — outside canvas so it stays readable */}
      <div className="flex flex-wrap gap-3">
        {legendItems.map(({ state, label }) => (
          <div key={state} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded border ${STATE_STYLES[state].card}`} />
            <span className="text-xs text-zinc-500">{label}</span>
          </div>
        ))}
      </div>

      {/* Pan/zoom canvas */}
      <BracketCanvas>
        <div className="flex p-3" style={{ height: bracketH + 36 }}>
          {roundNums.map((roundNum, rIdx) => {
            const roundMatches = matchesRaw.filter((m) => m.round === roundNum);
            const isLast = rIdx === roundNums.length - 1;
            const roundName = getRoundName(totalRounds, roundNum);

            return (
              <div key={roundNum} className="flex shrink-0">
                {/* Round column */}
                <div className="flex flex-col" style={{ width: MATCH_W }}>
                  <div className="h-9 flex items-center justify-center">
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                      {roundName}
                    </span>
                  </div>
                  <div className="relative flex-1">
                    {roundMatches.map((match) => {
                      const state = getMatchState(match);
                      const isBye = state === "bye";
                      const matchId = isBye ? null : getMatchLabel(match.round, match.match_number, numR1Matches);
                      const top = matchTop(match.round, match.match_number) - 16;
                      return (
                        <div
                          key={match.id}
                          className="absolute"
                          style={{ top, left: 0 }}
                        >
                          <div className="flex items-center gap-2 mb-1 px-1">
                            {matchId && (
                              <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5">
                                {matchId}
                              </span>
                            )}
                            <span className={STATE_STYLES[state].label}>
                              {STATE_LABELS[state]}
                            </span>
                          </div>
                          <MatchBox match={match} teams={teams} numR1={numR1Matches} matchId={isBye ? undefined : matchId ?? undefined} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Connector SVG */}
                {!isLast && (
                  <svg
                    className="shrink-0"
                    width={CONN_W}
                    height={bracketH}
                    style={{ marginTop: 36 }}
                  >
                    {roundMatches
                      .filter((m) => m.match_number % 2 === 1)
                      .map((m) => {
                        const m2 = roundMatches.find((x) => x.match_number === m.match_number + 1);
                        if (!m2) return null;
                        const y1 = matchCenter(m.round, m.match_number);
                        const y2 = matchCenter(m2.round, m2.match_number);
                        const yMid = (y1 + y2) / 2;
                        const mid = CONN_W / 2;
                        return (
                          <g key={m.match_number} stroke="#3f3f46" strokeWidth="1.5" fill="none">
                            <line x1={0} y1={y1} x2={mid} y2={y1} />
                            <line x1={0} y1={y2} x2={mid} y2={y2} />
                            <line x1={mid} y1={y1} x2={mid} y2={y2} />
                            <line x1={mid} y1={yMid} x2={CONN_W} y2={yMid} />
                          </g>
                        );
                      })}
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </BracketCanvas>
    </div>
  );
}

// ── DE Bracket View ───────────────────────────────────────────────────────────

function deLabelSlot(
  teamId: string | null,
  match: DBMatch,
  slot: "home" | "away",
  teams: Record<string, Team>,
  size: number,
  wbR1ByeNums: Set<number> = new Set(),
): string {
  if (teamId) return teams[teamId]?.name ?? "?";
  const hasScores = match.home_score !== null || match.away_score !== null;
  if (hasScores) return "BYE";

  // Pending LB R1 slot whose WB feeder was a bye → no loser will ever arrive
  if ((match.stage === DE_LOSERS || match.stage === DE_QUALIFIER_LOSERS) && match.round === 1) {
    const wbMatchNum = slot === "home" ? 2 * match.match_number - 1 : 2 * match.match_number;
    if (wbR1ByeNums.has(wbMatchNum)) return "BYE";
  }

  if (match.stage === DE_WINNERS || match.stage === DE_QUALIFIER_WINNERS)
    return getDEWBFeederLabel(match.round, match.match_number, slot, size / 2);
  if (match.stage === DE_LOSERS || match.stage === DE_QUALIFIER_LOSERS)
    return getDELBFeederLabel(match.round, match.match_number, slot, size);
  if (match.stage === DE_GF) {
    if (match.match_number === 2) return slot === "home" ? "WB Team" : "LB Team";
    const numR1WB = size / 2;
    const numR1LB = size / 4;
    const numWB   = getDEWBRounds(size);
    const numLB   = getDELBRounds(size);
    return slot === "home"
      ? `Winner of W-${getMatchLabel(numWB, 1, numR1WB)}`
      : `Winner of L-${getLBMatchLabel(numLB, 1, numR1LB)}`;
  }
  return "TBD";
}

function DEMatchBox({
  match, teams, size, matchId, wbR1ByeNums,
}: { match: DBMatch; teams: Record<string, Team>; size: number; matchId?: string; wbR1ByeNums?: Set<number> }) {
  const state = getMatchState(match);
  const { card } = STATE_STYLES[state];
  const isReset = match.stage === DE_GF && match.match_number === 2;
  const inactive = isReset && match.home_team_id === null; // reset not yet triggered

  const completed = state === "completed";
  const homeWon = completed && (match.home_score ?? 0) > (match.away_score ?? 0);
  const awayWon = completed && (match.away_score ?? 0) > (match.home_score ?? 0);
  const homeLabel = deLabelSlot(match.home_team_id, match, "home", teams, size, wbR1ByeNums);
  const awayLabel = deLabelSlot(match.away_team_id, match, "away", teams, size, wbR1ByeNums);
  const homeFaded = !match.home_team_id || (completed && !homeWon);
  const awayFaded = !match.away_team_id || (completed && !awayWon);

  const cardClass = inactive
    ? "border-zinc-800/30 bg-zinc-900/10 opacity-50"
    : card;

  return (
    <div className={`rounded-lg overflow-hidden border ${cardClass}`} style={{ width: MATCH_W, height: MATCH_H }}
      data-match-id={matchId}>
      <div className={`flex items-center gap-2 px-2 py-0.5 ${homeWon ? "bg-white/5 rounded mx-1" : ""}`} style={{ height: 33 }}>
        <TeamLogo team={match.home_team_id ? teams[match.home_team_id] : null} faded={homeFaded} />
        {match.home_team_id ? (
          <a href={`/dashboard/teams?search=${encodeURIComponent(teams[match.home_team_id]?.name ?? "")}&from=season`}
            className={`flex-1 text-xs truncate hover:underline ${homeWon ? "text-white font-semibold" : "text-zinc-300"}`}>
            {homeLabel}
          </a>
        ) : <SlotText label={homeLabel} faded={homeFaded} />}
        {completed && match.home_score !== null && (
          <span className={`text-xs font-mono font-bold shrink-0 w-4 text-right ${homeWon ? "text-white" : "text-zinc-500"}`}>{match.home_score}</span>
        )}
      </div>
      <div className="h-px bg-zinc-700/50 mx-2" />
      <div className={`flex items-center gap-2 px-2 py-0.5 ${awayWon ? "bg-white/5 rounded mx-1" : ""}`} style={{ height: 33 }}>
        <TeamLogo team={match.away_team_id ? teams[match.away_team_id] : null} faded={awayFaded} />
        {match.away_team_id ? (
          <a href={`/dashboard/teams?search=${encodeURIComponent(teams[match.away_team_id]?.name ?? "")}&from=season`}
            className={`flex-1 text-xs truncate hover:underline ${awayWon ? "text-white font-semibold" : "text-zinc-300"}`}>
            {awayLabel}
          </a>
        ) : <SlotText label={awayLabel} faded={awayFaded} />}
        {completed && match.away_score !== null && (
          <span className={`text-xs font-mono font-bold shrink-0 w-4 text-right ${awayWon ? "text-white" : "text-zinc-500"}`}>{match.away_score}</span>
        )}
      </div>
    </div>
  );
}

function DESectionView({
  sectionMatches, teams, size, numR1, totalRounds, labelPrefix, sectionTitle, sectionType,
  gfMain, gfReset, wbR1ByeNums,
}: {
  sectionMatches: DBMatch[];
  teams: Record<string, Team>;
  size: number;
  numR1: number;
  totalRounds: number;
  labelPrefix: string;
  sectionTitle: string;
  sectionType: "winners" | "losers";
  gfMain?: DBMatch | null;
  gfReset?: DBMatch | null;
  wbR1ByeNums?: Set<number>;
}) {
  const roundNums  = [...new Set(sectionMatches.map((m) => m.round))].sort((a, b) => a - b);
  const bracketH   = BASE_SLOT * numR1;
  const centerFn   = sectionType === "losers" ? matchCenterLB : matchCenter;
  const gfCenterY  = bracketH / 2; // GF always sits at vertical center of WB

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{sectionTitle}</h3>
      <div className="flex" style={{ height: bracketH + 36 }}>
        {roundNums.map((roundNum, rIdx) => {
          const roundMatches   = sectionMatches.filter((m) => m.round === roundNum);
          const isLast         = rIdx === roundNums.length - 1;
          const roundName      = sectionType === "losers"
            ? getLBRoundName(roundNum, totalRounds)
            : getRoundName(totalRounds, roundNum);
          // LB: connectors only on even rounds (those converge into the next consolidation round)
          const drawConnectors = !isLast && (sectionType === "winners" || roundNum % 2 === 0);

          return (
            <div key={roundNum} className="flex shrink-0">
              <div className="flex flex-col" style={{ width: MATCH_W }}>
                <div className="h-9 flex items-center justify-center">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{roundName}</span>
                </div>
                <div className="relative flex-1">
                  {roundMatches.map((match) => {
                    const state   = getMatchState(match);
                    const isBye   = state === "bye";
                    const rawLabel = sectionType === "losers"
                      ? getLBMatchLabel(match.round, match.match_number, numR1)
                      : getMatchLabel(match.round, match.match_number, numR1);
                    const matchId = isBye ? null : `${labelPrefix}-${rawLabel}`;
                    const center  = centerFn(match.round, match.match_number);
                    const top     = center - MATCH_H / 2 - 16;
                    return (
                      <div key={match.id} className="absolute" style={{ top, left: 0 }}>
                        <div className="flex items-center gap-2 mb-1 px-1">
                          {matchId && (
                            <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5">{matchId}</span>
                          )}
                          <span className={STATE_STYLES[state].label}>{STATE_LABELS[state]}</span>
                        </div>
                        <DEMatchBox match={match} teams={teams} size={size} matchId={isBye ? undefined : matchId ?? undefined} wbR1ByeNums={wbR1ByeNums} />
                      </div>
                    );
                  })}
                </div>
              </div>
              {drawConnectors ? (
                // Even LB round: pairs of matches consolidate → draw bracket-style connectors.
                <svg className="shrink-0" width={CONN_W} height={bracketH} style={{ marginTop: 36 }}>
                  {roundMatches
                    .filter((m) => m.match_number % 2 === 1)
                    .map((m) => {
                      const m2   = roundMatches.find((x) => x.match_number === m.match_number + 1);
                      if (!m2) return null;
                      const y1   = centerFn(m.round, m.match_number);
                      const y2   = centerFn(m2.round, m2.match_number);
                      const yMid = (y1 + y2) / 2;
                      const mid  = CONN_W / 2;
                      return (
                        <g key={m.match_number} stroke="#3f3f46" strokeWidth="1.5" fill="none">
                          <line x1={0} y1={y1} x2={mid} y2={y1} />
                          <line x1={0} y1={y2} x2={mid} y2={y2} />
                          <line x1={mid} y1={y1} x2={mid} y2={y2} />
                          <line x1={mid} y1={yMid} x2={CONN_W} y2={yMid} />
                        </g>
                      );
                    })}
                </svg>
              ) : !isLast && sectionType === "losers" ? (
                // Odd LB round: WB losers drop into same-count next round at identical y positions →
                // draw a straight horizontal line per match so the output isn't visually disconnected.
                <svg className="shrink-0" width={CONN_W} height={bracketH} style={{ marginTop: 36 }}>
                  {roundMatches.map((m) => {
                    const y = centerFn(m.round, m.match_number);
                    return (
                      <line key={m.match_number} x1={0} y1={y} x2={CONN_W} y2={y}
                        stroke="#3f3f46" strokeWidth="1.5" />
                    );
                  })}
                </svg>
              ) : (
                !isLast && <div style={{ width: CONN_W }} className="shrink-0" />
              )}
            </div>
          );
        })}

        {/* Grand Final columns — appended to Winners Bracket */}
        {gfMain && (() => {
          const gfState       = getMatchState(gfMain);
          const resetActive   = gfReset?.home_team_id != null;
          const resetState    = gfReset ? getMatchState(gfReset) : null;
          const gfTop         = gfCenterY - MATCH_H / 2 - 16;
          return (
            <>
              {/* Connector: straight horizontal line at bracket center */}
              <svg className="shrink-0" width={CONN_W} height={bracketH} style={{ marginTop: 36 }}>
                <line x1={0} y1={gfCenterY} x2={CONN_W} y2={gfCenterY} stroke="#3f3f46" strokeWidth="1.5" />
              </svg>

              {/* GF M1 */}
              <div className="flex flex-col shrink-0" style={{ width: MATCH_W }}>
                <div className="h-9 flex items-center justify-center">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Grand Final</span>
                </div>
                <div className="relative flex-1">
                  <div className="absolute" style={{ top: gfTop, left: 0 }}>
                    <div className="flex items-center gap-2 mb-1 px-1">
                      <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5">GF</span>
                      <span className={STATE_STYLES[gfState].label}>{STATE_LABELS[gfState]}</span>
                    </div>
                    <DEMatchBox match={gfMain} teams={teams} size={size} matchId="GF" />
                  </div>
                </div>
              </div>

              {/* GF Reset */}
              {gfReset && (
                <>
                  <svg className="shrink-0" width={CONN_W} height={bracketH} style={{ marginTop: 36 }}>
                    <line x1={0} y1={gfCenterY} x2={CONN_W} y2={gfCenterY} stroke="#3f3f46" strokeWidth="1.5" />
                  </svg>
                  <div className={`flex flex-col shrink-0 ${resetActive ? "" : "opacity-40"}`} style={{ width: MATCH_W }}>
                    <div className="h-9 flex items-center justify-center">
                      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                        {resetActive ? "GF Reset" : "GF Reset (if needed)"}
                      </span>
                    </div>
                    <div className="relative flex-1">
                      <div className="absolute" style={{ top: gfTop, left: 0 }}>
                        <div className="flex items-center gap-2 mb-1 px-1">
                          <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5">GF Reset</span>
                          {resetActive && resetState
                            ? <span className={STATE_STYLES[resetState].label}>{STATE_LABELS[resetState]}</span>
                            : <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">IF NEEDED</span>
                          }
                        </div>
                        <DEMatchBox match={gfReset} teams={teams} size={size} matchId="GF Reset" />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

export async function DEBracketView() {
  const [{ data: matchesRaw }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select("id, round, match_number, stage, status, home_team_id, away_team_id, home_score, away_score")
      .in("stage", [DE_WINNERS, DE_LOSERS, DE_GF])
      .order("round", { ascending: true })
      .order("match_number", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name, logo_url"),
  ]);

  if (!matchesRaw?.length) return <p className="text-zinc-500 text-sm">No bracket matches found.</p>;

  const teams: Record<string, Team> = {};
  teamsRaw?.forEach((t) => { teams[t.id] = t; });

  const wbMatches  = matchesRaw.filter((m) => m.stage === DE_WINNERS);
  const lbMatches  = matchesRaw.filter((m) => m.stage === DE_LOSERS);
  const gfMatches  = matchesRaw.filter((m) => m.stage === DE_GF);

  const numR1WB   = wbMatches.filter((m) => m.round === 1).length;
  const numR1LB   = lbMatches.filter((m) => m.round === 1).length;
  const size       = numR1WB * 2;
  const numWBRounds = getDEWBRounds(size);
  const numLBRounds = getDELBRounds(size);

  const legendItems: { state: MatchState; label: string }[] = [
    { state: "completed", label: "Completed" },
    { state: "ready",     label: "Upcoming" },
    { state: "waiting",   label: "Waiting" },
    { state: "pending",   label: "TBD" },
    { state: "bye",       label: "Bye" },
  ];

  // GF M2 (reset) is "active" only once teams are set
  const gfMain  = gfMatches.find((m) => m.match_number === 1) ?? null;
  const gfReset = gfMatches.find((m) => m.match_number === 2) ?? null;
  const resetActive = gfReset && gfReset.home_team_id !== null;

  // Set of WB R1 match numbers that are byes — used to label pending LB R1 slots correctly
  const wbR1ByeNums = new Set<number>(
    wbMatches
      .filter((m) => m.round === 1 && m.status === "completed" && m.away_team_id === null)
      .map((m) => m.match_number),
  );

  return (
    <div className="space-y-3">
      {/* Legend — outside canvas */}
      <div className="flex flex-wrap gap-3">
        {legendItems.map(({ state, label }) => (
          <div key={state} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded border ${STATE_STYLES[state].card}`} />
            <span className="text-xs text-zinc-500">{label}</span>
          </div>
        ))}
      </div>

      {/* Pan/zoom canvas */}
      <BracketCanvas>
        <div className="space-y-8 p-3">

          {/* Winners Bracket — Grand Final columns appended inline */}
          {wbMatches.length > 0 && (
            <DESectionView
              sectionMatches={wbMatches}
              teams={teams}
              size={size}
              numR1={numR1WB}
              totalRounds={numWBRounds}
              labelPrefix="W"
              sectionTitle="Winners Bracket"
              sectionType="winners"
              gfMain={gfMain}
              gfReset={gfReset}
            />
          )}

          {/* Losers Bracket */}
          {lbMatches.length > 0 && (
            <DESectionView
              sectionMatches={lbMatches}
              teams={teams}
              size={size}
              numR1={numR1LB}
              totalRounds={numLBRounds}
              labelPrefix="L"
              sectionTitle="Losers Bracket"
              sectionType="losers"
              wbR1ByeNums={wbR1ByeNums}
            />
          )}

        </div>
      </BracketCanvas>
    </div>
  );
}

// ── DE Qualifier Bracket View ─────────────────────────────────────────────────

export async function DEQualifierBracketView() {
  const [{ data: matchesRaw }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select("id, round, match_number, stage, status, home_team_id, away_team_id, home_score, away_score")
      .in("stage", [DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS])
      .order("round", { ascending: true })
      .order("match_number", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name, logo_url"),
  ]);

  if (!matchesRaw?.length) return <p className="text-zinc-500 text-sm">No bracket matches found.</p>;

  const teams: Record<string, Team> = {};
  teamsRaw?.forEach((t) => { teams[t.id] = t; });

  const wbMatches = matchesRaw.filter((m) => m.stage === DE_QUALIFIER_WINNERS);
  const lbMatches = matchesRaw.filter((m) => m.stage === DE_QUALIFIER_LOSERS);

  const numR1WB    = wbMatches.filter((m) => m.round === 1).length;
  const numR1LB    = lbMatches.filter((m) => m.round === 1).length;
  const size       = numR1WB * 2;
  const numWBRounds = [...new Set(wbMatches.map((m) => m.round))].length;
  const numLBRounds = [...new Set(lbMatches.map((m) => m.round))].length;

  const legendItems: { state: MatchState; label: string }[] = [
    { state: "completed", label: "Completed" },
    { state: "ready",     label: "Upcoming" },
    { state: "waiting",   label: "Waiting" },
    { state: "pending",   label: "TBD" },
    { state: "bye",       label: "Bye" },
  ];

  const wbR1ByeNums = new Set<number>(
    wbMatches
      .filter((m) => m.round === 1 && m.status === "completed" && m.away_team_id === null)
      .map((m) => m.match_number),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {legendItems.map(({ state, label }) => (
          <div key={state} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded border ${STATE_STYLES[state].card}`} />
            <span className="text-xs text-zinc-500">{label}</span>
          </div>
        ))}
      </div>
      <BracketCanvas>
        <div className="space-y-8 p-3">
          {wbMatches.length > 0 && (
            <DESectionView
              sectionMatches={wbMatches}
              teams={teams}
              size={size}
              numR1={numR1WB}
              totalRounds={numWBRounds}
              labelPrefix="W"
              sectionTitle="Winners Bracket"
              sectionType="winners"
            />
          )}
          {lbMatches.length > 0 && (
            <DESectionView
              sectionMatches={lbMatches}
              teams={teams}
              size={size}
              numR1={numR1LB}
              totalRounds={numLBRounds}
              labelPrefix="L"
              sectionTitle="Losers Bracket"
              sectionType="losers"
              wbR1ByeNums={wbR1ByeNums}
            />
          )}
        </div>
      </BracketCanvas>
    </div>
  );
}

// ── Group Bracket View ────────────────────────────────────────────────────────

export async function GroupBracketView({ qualifiersPerGroup, topDirectQualifiers }: { qualifiersPerGroup: number; topDirectQualifiers?: number }) {
  const [{ data: matchesRaw }, { data: teamsRaw }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select("id, round, match_number, stage, status, home_team_id, away_team_id, home_score, away_score")
      .like("stage", `${GROUP_STAGE_PREFIX}%`)
      .order("stage", { ascending: true })
      .order("round", { ascending: true })
      .order("match_number", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name, logo_url"),
  ]);

  if (!matchesRaw?.length) return <p className="text-zinc-500 text-sm">No group matches found.</p>;

  const teams: Record<string, { id: string; name: string; logo_url: string | null }> = {};
  teamsRaw?.forEach((t) => { teams[t.id] = t; });

  const groupTeamIds = [...new Set(matchesRaw.flatMap(m => [m.home_team_id, m.away_team_id].filter(Boolean) as string[]))];
  const teamTitles: Record<string, string> = {};
  if (groupTeamIds.length) {
    const { data: groupPlayers } = await supabaseAdmin
      .from("players")
      .select("team_id, display_name, username, peak_2v2, current_2v2, peak_3v3, current_3v3")
      .in("team_id", groupTeamIds);
    const rvOf = (p: { peak_2v2: string | null; current_2v2: string | null; peak_3v3: string | null; current_3v3: string | null }) =>
      Math.round((Number(p.peak_2v2 ?? 0) + Number(p.current_2v2 ?? 0)) * 0.3 + (Number(p.peak_3v3 ?? 0) + Number(p.current_3v3 ?? 0)) * 0.2);
    const byTeam: Record<string, { display_name: string | null; username: string; peak_2v2: string | null; current_2v2: string | null; peak_3v3: string | null; current_3v3: string | null }[]> = {};
    for (const p of (groupPlayers ?? [])) {
      if (!p.team_id) continue;
      (byTeam[p.team_id] ??= []).push(p as never);
    }
    for (const [tid, roster] of Object.entries(byTeam)) {
      teamTitles[tid] = roster.sort((a, b) => rvOf(b) - rvOf(a)).map(p => `${p.display_name ?? p.username} (${rvOf(p)})`).join("\n");
    }
  }

  const groupNums = [...new Set(matchesRaw.map((m) => parseGroupNum(m.stage)!))].sort((a, b) => a - b);

  // Attach groupNum to each match so the client component doesn't need to re-parse stage strings
  const matches = matchesRaw.map((m) => ({ ...m, groupNum: parseGroupNum(m.stage)! }));

  return (
    <GroupStageClient
      groupNums={groupNums}
      matches={matches}
      teams={teams}
      qualifiersPerGroup={qualifiersPerGroup}
      topDirectQualifiers={topDirectQualifiers ?? qualifiersPerGroup}
      teamTitles={teamTitles}
    />
  );
}
