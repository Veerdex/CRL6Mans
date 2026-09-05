// Derives final team placements for a finished event from its matches alone.
//
// Pure and dependency-free (only ./bracket, itself pure) so the archiver and any
// later recomputation agree. Deliberately reads the *stage strings* rather than
// the tournament's season_format preset: stage names like "de_grand_final" or
// "group_3" are self-describing and already live on every match row, whereas the
// stored format is loosely typed and can be edited mid-event.
//
// The output is ordered tiers, not numbers. Teams the bracket never separated
// (both semifinal losers, everyone knocked out in the same Swiss round) share a
// tier, and a tier collapses to the midpoint of the ranks it spans only at the
// point of use — so if that midpoint rule is ever revised, stored tiers still
// recompute where a stored 3.5 could not.

import {
  computeGroupStandings,
  computeSwissRecords,
  parseGroupNum,
  DE_GF,
  DE_LOSERS,
  DE_QUALIFIER_LOSERS,
  DE_QUALIFIER_WINNERS,
  DE_WINNERS,
  GROUP_STAGE_PREFIX,
  HYBRID8_GF,
  HYBRID8_LB,
  HYBRID8_SF,
  HYBRID8_UB,
  HYBRID_GF,
  HYBRID_LB,
  HYBRID_SF,
  HYBRID_UB,
  SE_QUALIFIER,
  SWISS_STAGE,
} from "./bracket";

const SINGLE_ELIMINATION = "single_elimination";

export type PlacementMatch = {
  stage: string | null;
  round: number;
  match_number: number;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status?: string | null;
};

/** Phases run in this order; placement walks them in reverse. */
type Phase = "final" | "swiss" | "qualifier";

type Shape = "bracket" | "swiss" | "group";

const PHASE_ORDER: Phase[] = ["final", "swiss", "qualifier"];

// How far into a bracket a stage sits. Ranking works off each team's *last
// loss*, so this scale only ever compares eliminations: a losers' bracket sits
// above the winners' bracket because in a double-elimination format nobody is
// actually knocked out in the WB — every WB loser drops down, and its real exit
// is the LB round it finally falls in. That one ordering makes upper-bracket
// dropdowns slot in among the LB teams with no special case.
const BRACKET_DEPTH: Record<string, number> = {
  [SINGLE_ELIMINATION]: 1,
  [SE_QUALIFIER]: 1,
  [DE_WINNERS]: 1,
  [DE_QUALIFIER_WINNERS]: 1,
  [HYBRID_UB]: 1,
  [HYBRID8_UB]: 1,
  [DE_LOSERS]: 2,
  [DE_QUALIFIER_LOSERS]: 2,
  [HYBRID_LB]: 2,
  [HYBRID8_LB]: 2,
  [HYBRID_SF]: 3,
  [HYBRID8_SF]: 3,
  [DE_GF]: 4,
  [HYBRID_GF]: 4,
  [HYBRID8_GF]: 4,
};

function phaseOf(stage: string | null): Phase | null {
  if (!stage) return null;
  if (stage === SWISS_STAGE) return "swiss";
  if (stage.startsWith(GROUP_STAGE_PREFIX)) return "qualifier";
  if (stage === SE_QUALIFIER || stage === DE_QUALIFIER_WINNERS || stage === DE_QUALIFIER_LOSERS) {
    return "qualifier";
  }
  return stage in BRACKET_DEPTH ? "final" : null;
}

function shapeOf(stage: string): Shape {
  if (stage === SWISS_STAGE) return "swiss";
  if (stage.startsWith(GROUP_STAGE_PREFIX)) return "group";
  return "bracket";
}

/** A match only describes an elimination once it is actually played out. */
function isDecided(m: PlacementMatch): boolean {
  if (m.status === "void" || m.status === "cancelled") return false;
  return (
    m.home_team_id !== null &&
    m.away_team_id !== null &&
    m.home_score !== null &&
    m.away_score !== null
  );
}

// A grand final is the one place a team can play twice in the same stage and
// round, so match_number orders it there (match 2 is the bracket reset) and
// nowhere else — everywhere else two teams knocked out in the same round tied,
// and sequencing them by match number would invent a separation the bracket
// never played.
const GRAND_FINAL_STAGES = new Set<string>([DE_GF, HYBRID_GF, HYBRID8_GF]);

function depthKey(m: PlacementMatch): number {
  const stage = m.stage ?? "";
  const seq = GRAND_FINAL_STAGES.has(stage) ? m.match_number : 0;
  return (BRACKET_DEPTH[stage] ?? 0) * 10000 + m.round * 100 + seq;
}

/**
 * Order teams by where each one was knocked out: the deepest match it *lost*.
 * Reading the last loss rather than the last match played is what makes a
 * double-elimination bracket work — a team's winners'-bracket defeat isn't an
 * exit, it's a dropdown, and only the losers'-bracket defeat that follows ends
 * its run. Reading losses rather than scanning rounds forward is also what keeps
 * a first-round bye from looking like a first-round exit.
 *
 * The champion is taken from the deepest decided match instead of "the team that
 * never lost", because a double-elimination bracket reset hands the eventual
 * winner a loss too.
 */
function rankBracket(matches: PlacementMatch[], eligible: Set<string>): string[][] {
  const lastLoss = new Map<string, number>();
  const lastWin = new Map<string, number>();
  let deepest = -1;
  let champion: string | null = null;

  for (const m of matches) {
    if (!isDecided(m)) continue;
    const key = depthKey(m);
    const homeWon = m.home_score! > m.away_score!;
    const winner = homeWon ? m.home_team_id! : m.away_team_id!;
    const loser = homeWon ? m.away_team_id! : m.home_team_id!;
    if (key > deepest) {
      deepest = key;
      champion = winner;
    }
    if (key > (lastWin.get(winner) ?? -1)) lastWin.set(winner, key);
    if (key > (lastLoss.get(loser) ?? -1)) lastLoss.set(loser, key);
  }

  const tiers: string[][] = [];
  if (champion && eligible.has(champion)) tiers.push([champion]);

  const rest = [...eligible].filter((id) => id !== champion);

  // Undefeated but not the champion: only reachable while a bracket is still
  // unfinished. Ranked ahead of anyone already knocked out.
  const alive = rest
    .filter((id) => !lastLoss.has(id) && lastWin.has(id))
    .sort((a, b) => lastWin.get(b)! - lastWin.get(a)!);
  tiers.push(...groupRuns(alive, (id) => String(lastWin.get(id)), (id) => id));

  const eliminated = rest
    .filter((id) => lastLoss.has(id))
    .sort((a, b) => lastLoss.get(b)! - lastLoss.get(a)!);
  tiers.push(...groupRuns(eliminated, (id) => String(lastLoss.get(id)), (id) => id));

  return tiers;
}

/**
 * Swiss non-advancers, tiered by record. No Buchholz tiebreak: Buchholz decides
 * pairings during the stage, but two teams that finished 2-3 genuinely tied for
 * placement — the format never played a match to separate them.
 */
function rankSwiss(matches: PlacementMatch[], eligible: Set<string>): string[][] {
  const participants = new Set<string>();
  for (const m of matches) {
    if (m.home_team_id) participants.add(m.home_team_id);
    if (m.away_team_id) participants.add(m.away_team_id);
  }
  // computeSwissRecords indexes by allTeamIds, so it has to see every team the
  // matches mention, not just the ones still needing a placement.
  const records = computeSwissRecords(matches.filter(isDecided), [...participants])
    .filter((r) => eligible.has(r.teamId))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses);

  return groupRuns(records, (r) => `${r.wins}-${r.losses}`, (r) => r.teamId);
}

/**
 * Group-stage non-advancers, tiered by finishing position within their own
 * group: every group's runner-up ties with every other group's runner-up.
 */
function rankGroups(matches: PlacementMatch[], eligible: Set<string>): string[][] {
  const byGroup = new Map<number, PlacementMatch[]>();
  for (const m of matches) {
    const num = parseGroupNum(m.stage ?? "");
    if (num === null) continue;
    const bucket = byGroup.get(num);
    if (bucket) bucket.push(m);
    else byGroup.set(num, [m]);
  }

  const byPosition = new Map<number, string[]>();
  for (const groupMatches of byGroup.values()) {
    computeGroupStandings(groupMatches.filter(isDecided)).forEach((standing, position) => {
      if (!eligible.has(standing.teamId)) return;
      const bucket = byPosition.get(position);
      if (bucket) bucket.push(standing.teamId);
      else byPosition.set(position, [standing.teamId]);
    });
  }

  return [...byPosition.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
}

/**
 * Placement tiers, best first. Every team in `allTeamIds` lands in exactly one
 * tier; teams that never played a decided match end up in a trailing tier
 * together.
 */
export function computePlacementTiers(
  matches: PlacementMatch[],
  allTeamIds: string[],
): string[][] {
  const remaining = new Set(allTeamIds);
  const tiers: string[][] = [];

  const byPhase = new Map<Phase, PlacementMatch[]>();
  for (const m of matches) {
    const phase = phaseOf(m.stage);
    if (!phase) continue;
    const bucket = byPhase.get(phase);
    if (bucket) bucket.push(m);
    else byPhase.set(phase, [m]);
  }

  for (const phase of PHASE_ORDER) {
    const phaseMatches = byPhase.get(phase);
    if (!phaseMatches) continue;

    // A phase holds one shape in every preset; partitioning anyway keeps the
    // walk honest if a future format mixes them.
    for (const shape of ["bracket", "swiss", "group"] as const) {
      const shapeMatches = phaseMatches.filter((m) => shapeOf(m.stage!) === shape);
      if (shapeMatches.length === 0) continue;

      const eligible = new Set<string>();
      for (const m of shapeMatches) {
        for (const id of [m.home_team_id, m.away_team_id]) {
          if (id && remaining.has(id)) eligible.add(id);
        }
      }
      if (eligible.size === 0) continue;

      const ranked =
        shape === "bracket" ? rankBracket(shapeMatches, eligible)
        : shape === "swiss" ? rankSwiss(shapeMatches, eligible)
        : rankGroups(shapeMatches, eligible);

      for (const tier of ranked) {
        for (const id of tier) remaining.delete(id);
        if (tier.length > 0) tiers.push(tier);
      }

      // Reached this stage but never finished a match in it — still ahead of
      // anyone eliminated in an earlier stage.
      const unplayed = [...eligible].filter((id) => remaining.has(id));
      if (unplayed.length > 0) {
        for (const id of unplayed) remaining.delete(id);
        tiers.push(unplayed);
      }
    }
  }

  if (remaining.size > 0) tiers.push([...remaining]);
  return tiers;
}

export type Placement = {
  /** Midpoint of the ranks this team's tier spans: 3.5 for a 3rd-4th band. */
  placement: number;
  /** How many teams shared it — needed to render the band back as "3rd-4th". */
  tierSize: number;
};

/** Collapse ordered tiers into the fractional placement each team is credited with. */
export function placementsFromTiers(tiers: string[][]): Map<string, Placement> {
  const out = new Map<string, Placement>();
  let rank = 1;
  for (const tier of tiers) {
    const placement = rank + (tier.length - 1) / 2;
    for (const id of tier) out.set(id, { placement, tierSize: tier.length });
    rank += tier.length;
  }
  return out;
}

export function computePlacements(
  matches: PlacementMatch[],
  allTeamIds: string[],
): Map<string, Placement> {
  return placementsFromTiers(computePlacementTiers(matches, allTeamIds));
}

/** Split an already-sorted list into runs of equal key. */
function groupRuns<T>(sorted: T[], keyOf: (item: T) => string, idOf: (item: T) => string): string[][] {
  const tiers: string[][] = [];
  let lastKey: string | null = null;
  for (const item of sorted) {
    const key = keyOf(item);
    if (key !== lastKey) {
      tiers.push([]);
      lastKey = key;
    }
    tiers[tiers.length - 1].push(idOf(item));
  }
  return tiers;
}
