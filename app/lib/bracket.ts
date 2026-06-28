// Pure bracket utilities — no server dependencies, safe to import anywhere.

// Returns seed positions in bracket order so top seeds are separated until late rounds.
// e.g. size=8 → [1,8,4,5,2,7,3,6] → pairs: (1v8),(4v5),(2v7),(3v6)
export function getSeedOrder(size: number): number[] {
  if (size <= 1) return [1];
  if (size === 2) return [1, 2];
  const half = getSeedOrder(size / 2);
  const result: number[] = [];
  for (const s of half) {
    result.push(s);
    result.push(size + 1 - s);
  }
  return result;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function getRoundName(totalRounds: number, roundNum: number): string {
  const fromFinal = totalRounds - roundNum;
  if (fromFinal === 0) return "Final";
  if (fromFinal === 1) return "Semifinals";
  if (fromFinal === 2) return "Quarterfinals";
  return `Round of ${Math.pow(2, fromFinal + 1)}`;
}

export function nextMatchNumber(mn: number) { return Math.ceil(mn / 2); }
export function nextSlot(mn: number): "home" | "away" { return mn % 2 === 1 ? "home" : "away"; }

// ── Group Stage ────────────────────────────────────────────────────────────────

export const GROUP_STAGE_PREFIX = "group_";
export function getGroupStage(groupNum: number): string { return `${GROUP_STAGE_PREFIX}${groupNum}`; }
export function parseGroupNum(stage: string): number | null {
  if (!stage.startsWith(GROUP_STAGE_PREFIX)) return null;
  const n = parseInt(stage.slice(GROUP_STAGE_PREFIX.length), 10);
  return isNaN(n) ? null : n;
}

// Number of groups based on team count — must stay in sync with format-editor.tsx.
export function getNumGroups(n: number): number {
  if (n > 32) return 8;
  if (n > 16) return 4;
  return 2;
}

// Round-robin pairings for n teams (0-indexed indices).
// Uses the "circle method": fix position 0, rotate the rest.
// Returns array of rounds; each round is an array of [homeIdx, awayIdx].
export function roundRobinSchedule(n: number): [number, number][][] {
  const slots: number[] = Array.from({ length: n % 2 === 0 ? n : n + 1 }, (_, i) => (i < n ? i : -1));
  const nSlots = slots.length;
  const rounds: [number, number][][] = [];

  for (let r = 0; r < nSlots - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < nSlots / 2; i++) {
      const h = slots[i];
      const a = slots[nSlots - 1 - i];
      if (h !== -1 && a !== -1) round.push([h, a]);
    }
    if (round.length) rounds.push(round);
    // Rotate slots[1..] right by 1
    const last = slots[nSlots - 1];
    for (let i = nSlots - 1; i > 1; i--) slots[i] = slots[i - 1];
    slots[1] = last;
  }
  return rounds;
}

// Distribute teams into numGroups using greedy assignment.
// Each team (highest value first) is assigned to the group with the lowest
// current total, minimising spread across groups.
// value() defaults to 1 (equal weight), producing round-robin distribution.
export function snakeDraftGroups<T>(teams: T[], numGroups: number, value?: (t: T) => number): T[][] {
  const groups: T[][] = Array.from({ length: numGroups }, () => []);
  const totals: number[] = Array(numGroups).fill(0);
  for (const t of teams) {
    const idx = totals.indexOf(Math.min(...totals));
    groups[idx].push(t);
    totals[idx] += value ? value(t) : 1;
  }
  return groups;
}

export type GroupStanding = {
  teamId: string;
  wins: number;
  losses: number;
  goalDiff: number;
  goalsFor: number;
};

// Compute group standings from a set of group matches.
// Sorted by: wins desc → goalDiff desc → goalsFor desc.
export function computeGroupStandings(
  matches: { home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null }[]
): GroupStanding[] {
  const stats: Record<string, GroupStanding> = {};

  for (const m of matches) {
    for (const tid of [m.home_team_id, m.away_team_id]) {
      if (tid && !stats[tid]) stats[tid] = { teamId: tid, wins: 0, losses: 0, goalDiff: 0, goalsFor: 0 };
    }
    if (m.home_team_id && m.away_team_id && m.home_score !== null && m.away_score !== null) {
      const d = m.home_score - m.away_score;
      stats[m.home_team_id].goalsFor += m.home_score;
      stats[m.home_team_id].goalDiff += d;
      stats[m.away_team_id].goalsFor += m.away_score;
      stats[m.away_team_id].goalDiff -= d;
      if (d > 0) { stats[m.home_team_id].wins++; stats[m.away_team_id].losses++; }
      else        { stats[m.away_team_id].wins++; stats[m.home_team_id].losses++; }
    }
  }

  return Object.values(stats).sort((a, b) =>
    b.wins !== a.wins ? b.wins - a.wins :
    b.goalDiff !== a.goalDiff ? b.goalDiff - a.goalDiff :
    b.goalsFor - a.goalsFor
  );
}

// Seed qualifiers from multiple groups for SE.
// Cross-group: all rank-1s first (seeds 1..numGroups), then all rank-2s, etc.
// This gives top seeds (group winners) byes when total qualifiers isn't a power of 2.
export function seedGroupQualifiers(groupResults: GroupStanding[][], qualifiersPerGroup: number): { id: string }[] {
  const out: { id: string }[] = [];
  for (let rank = 0; rank < qualifiersPerGroup; rank++) {
    for (const group of groupResults) {
      if (group[rank]) out.push({ id: group[rank].teamId });
    }
  }
  return out;
}

// ── SE Qualifier ───────────────────────────────────────────────────────────────

export const SE_QUALIFIER = "se_qualifier";

// Generates a truncated SE bracket that plays only enough rounds to leave
// targetCount teams standing (e.g. 32 teams → 1 round → 16 remain).
export function generateSEQualifierInserts(
  teams: { id: string }[],
  targetCount = 16
): BracketMatchInsert[] {
  const n = teams.length;
  const size = nextPow2(n);
  const roundsNeeded = Math.round(Math.log2(size / targetCount));
  const order = getSeedOrder(size);
  const inserts: BracketMatchInsert[] = [];

  for (let i = 0; i < size / 2; i++) {
    const s1 = order[2 * i] - 1;
    const s2 = order[2 * i + 1] - 1;
    const t1 = s1 < n ? teams[s1] : null;
    const t2 = s2 < n ? teams[s2] : null;
    const bye = t2 === null;
    inserts.push({
      round: 1, match_number: i + 1, stage: SE_QUALIFIER,
      home_team_id: t1?.id ?? null, away_team_id: t2?.id ?? null,
      home_score: bye ? 1 : null, away_score: bye ? 0 : null,
      status: bye ? "completed" : "scheduled",
    });
  }

  for (let r = 2; r <= roundsNeeded; r++) {
    const count = size / Math.pow(2, r);
    for (let m = 1; m <= count; m++) {
      inserts.push({
        round: r, match_number: m, stage: SE_QUALIFIER,
        home_team_id: null, away_team_id: null,
        home_score: null, away_score: null, status: "pending",
      });
    }
  }

  return inserts;
}

// ── Swiss ──────────────────────────────────────────────────────────────────────

export const SWISS_STAGE = "swiss";
export const SWISS_ADVANCE_WINS = 3;
export const SWISS_ELIMINATE_LOSSES = 3;
// 8-team Swiss (hybrid_8): max 3 series per team → 2-win / 2-loss thresholds
export const SWISS8_ADVANCE_WINS = 2;
export const SWISS8_ELIMINATE_LOSSES = 2;

export type SwissRecord = {
  teamId: string;
  wins: number;
  losses: number;
  buchholz: number;
  opponents: string[];
};

export function computeSwissRecords(
  matches: { home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null }[],
  allTeamIds: string[]
): SwissRecord[] {
  const stats: Record<string, SwissRecord> = {};
  for (const id of allTeamIds) stats[id] = { teamId: id, wins: 0, losses: 0, buchholz: 0, opponents: [] };
  for (const m of matches) {
    if (!m.home_team_id || !m.away_team_id) continue;
    stats[m.home_team_id].opponents.push(m.away_team_id);
    stats[m.away_team_id].opponents.push(m.home_team_id);
    if (m.home_score !== null && m.away_score !== null) {
      if (m.home_score > m.away_score) { stats[m.home_team_id].wins++; stats[m.away_team_id].losses++; }
      else { stats[m.away_team_id].wins++; stats[m.home_team_id].losses++; }
    }
  }
  for (const rec of Object.values(stats)) {
    rec.buchholz = rec.opponents.reduce((s, id) => s + (stats[id]?.wins ?? 0), 0);
  }
  return Object.values(stats);
}

// Pair active teams for the next Swiss round.
// Teams grouped by W-L record, sorted Buchholz desc, paired top-half vs bottom-half.
// Rematches avoided by swapping within bucket.
export function pairSwissRound(
  records: SwissRecord[],
  advanceWins = SWISS_ADVANCE_WINS,
  eliminateLosses = SWISS_ELIMINATE_LOSSES
): [string, string][] {
  const active = records.filter(r => r.wins < advanceWins && r.losses < eliminateLosses);
  const buckets = new Map<string, SwissRecord[]>();
  for (const r of active) {
    const key = `${r.wins}-${r.losses}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }
  const pairs: [string, string][] = [];
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => b.buchholz - a.buchholz || a.teamId.localeCompare(b.teamId));
    pairs.push(...pairBucketSwiss(bucket));
  }
  return pairs;
}

function pairBucketSwiss(sorted: SwissRecord[]): [string, string][] {
  const n = sorted.length;
  if (n < 2) return [];

  // Pre-build a set of canonical "A:B" keys (lexicographic) for every past matchup.
  const played = new Set<string>();
  for (const r of sorted) {
    for (const opp of r.opponents) {
      played.add(r.teamId < opp ? `${r.teamId}:${opp}` : `${opp}:${r.teamId}`);
    }
  }
  const hasPlayed = (a: string, b: string) =>
    played.has(a < b ? `${a}:${b}` : `${b}:${a}`);

  // Backtrack over index lists, pairing the first unpaired team with each candidate
  // in Buchholz order. Returns null when no valid completion exists.
  function backtrack(remaining: number[], allowRematches: boolean): [number, number][] | null {
    if (remaining.length === 0) return [];
    const [first, ...rest] = remaining;
    for (let i = 0; i < rest.length; i++) {
      if (allowRematches || !hasPlayed(sorted[first].teamId, sorted[rest[i]].teamId)) {
        const sub = backtrack([...rest.slice(0, i), ...rest.slice(i + 1)], allowRematches);
        if (sub !== null) return [[first, rest[i]], ...sub];
      }
    }
    return null;
  }

  const indices = Array.from({ length: n }, (_, i) => i);
  // Try a perfect no-rematch pairing first; only allow rematches if truly unavoidable.
  const result = backtrack(indices, false) ?? backtrack(indices, true)!;
  return result.map(([i, j]) => [sorted[i].teamId, sorted[j].teamId]);
}

// R1: pair seed 1 vs 9, 2 vs 10, ..., 8 vs 16.
export function generateSwissR1Inserts(teams: { id: string }[]): BracketMatchInsert[] {
  const half = teams.length / 2;
  return Array.from({ length: half }, (_, i) => ({
    round: 1,
    match_number: i + 1,
    stage: SWISS_STAGE,
    home_team_id: teams[i].id,
    away_team_id: teams[i + half].id,
    home_score: null,
    away_score: null,
    status: "scheduled",
  }));
}

// Generate inserts for the next Swiss round from current records.
export function generateSwissNextRoundInserts(
  records: SwissRecord[],
  roundNum: number,
  advanceWins = SWISS_ADVANCE_WINS,
  eliminateLosses = SWISS_ELIMINATE_LOSSES
): BracketMatchInsert[] {
  const pairs = pairSwissRound(records, advanceWins, eliminateLosses);
  return pairs.map(([ homeId, awayId ], i) => ({
    round: roundNum,
    match_number: i + 1,
    stage: SWISS_STAGE,
    home_team_id: homeId,
    away_team_id: awayId,
    home_score: null,
    away_score: null,
    status: "scheduled",
  }));
}

// Seed Swiss qualifiers into SE, ordered by record quality then Buchholz.
export function seedSwissQualifiers(
  records: SwissRecord[],
  advanceWins = SWISS_ADVANCE_WINS
): { id: string }[] {
  const advanced = records.filter(r => r.wins === advanceWins);
  const result: { id: string }[] = [];
  for (let l = 0; l < advanceWins; l++) {
    const group = advanced.filter(r => r.losses === l);
    group.sort((a, b) => b.buchholz - a.buchholz);
    result.push(...group.map(r => ({ id: r.teamId })));
  }
  return result;
}

// ── DE Qualifier ──────────────────────────────────────────────────────────────

export const DE_QUALIFIER_WINNERS = "deq_winners";
export const DE_QUALIFIER_LOSERS  = "deq_losers";

// Generates a truncated DE that plays k WB rounds + 2*(k-1) LB rounds,
// leaving targetCount/2 teams alive in each bracket (default: 8+8=16).
// k = log2(size / (targetCount/2))
export function generateDEQualifierInserts(
  teams: { id: string }[],
  targetCount = 16
): BracketMatchInsert[] {
  const n    = teams.length;
  const size = nextPow2(n);
  const half = targetCount / 2;
  const k    = Math.round(Math.log2(size / half));
  const numLBQ = 2 * (k - 1);
  const order  = getSeedOrder(size);
  const out: BracketMatchInsert[] = [];

  // WB R1 (seeded, byes for missing seeds)
  for (let i = 0; i < size / 2; i++) {
    const s1  = order[2 * i] - 1;
    const s2  = order[2 * i + 1] - 1;
    const t1  = s1 < n ? teams[s1] : null;
    const t2  = s2 < n ? teams[s2] : null;
    const bye = t2 === null;
    out.push({
      round: 1, match_number: i + 1, stage: DE_QUALIFIER_WINNERS,
      home_team_id: t1?.id ?? null, away_team_id: t2?.id ?? null,
      home_score: bye ? 1 : null, away_score: bye ? 0 : null,
      status: bye ? "completed" : "scheduled",
    });
  }

  // WB R2..Rk
  for (let r = 2; r <= k; r++) {
    const count = size / Math.pow(2, r);
    for (let m = 1; m <= count; m++) {
      out.push({
        round: r, match_number: m, stage: DE_QUALIFIER_WINNERS,
        home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending",
      });
    }
  }

  // LB R1..numLBQ (same count formula as full DE)
  for (let r = 1; r <= numLBQ; r++) {
    const count = size / Math.pow(2, Math.ceil(r / 2) + 1);
    for (let m = 1; m <= count; m++) {
      out.push({
        round: r, match_number: m, stage: DE_QUALIFIER_LOSERS,
        home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending",
      });
    }
  }

  return out;
}

// ── Double Elimination ─────────────────────────────────────────────────────────

export const DE_WINNERS = "de_winners";
export const DE_LOSERS  = "de_losers";
export const DE_GF      = "de_grand_final";

export function getDEWBRounds(size: number): number { return Math.log2(size); }
export function getDELBRounds(size: number): number { return 2 * (Math.log2(size) - 1); }

// Where does a WB loser land in the LB?
export function wbLoserTarget(
  wbRound: number, matchNum: number
): { lbRound: number; lbMatchNum: number; slot: "home_team_id" | "away_team_id" } {
  if (wbRound === 1) {
    return {
      lbRound: 1,
      lbMatchNum: Math.ceil(matchNum / 2),
      slot: matchNum % 2 === 1 ? "home_team_id" : "away_team_id",
    };
  }
  return { lbRound: 2 * (wbRound - 1), lbMatchNum: matchNum, slot: "away_team_id" };
}

// Where does an LB winner advance?
export function lbWinnerTarget(
  lbRound: number, matchNum: number, numLBRounds: number
): { section: "losers" | "grand_final"; round: number; matchNum: number; slot: "home_team_id" | "away_team_id" } {
  if (lbRound === numLBRounds) {
    return { section: "grand_final", round: 1, matchNum: 1, slot: "away_team_id" };
  }
  if (lbRound % 2 === 1) {
    // After odd (feed/consolidate) → even (drop): same matchNum, LB survivor is home
    return { section: "losers", round: lbRound + 1, matchNum, slot: "home_team_id" };
  }
  // After even (drop) → odd (consolidate): halved matchNum
  return {
    section: "losers",
    round: lbRound + 1,
    matchNum: Math.ceil(matchNum / 2),
    slot: matchNum % 2 === 1 ? "home_team_id" : "away_team_id",
  };
}

// Feeder label for a pending WB slot
export function getDEWBFeederLabel(round: number, matchNum: number, slot: "home" | "away", numR1WB: number): string {
  if (round <= 1) return "TBD";
  const feeder = slot === "home" ? 2 * matchNum - 1 : 2 * matchNum;
  return `Winner of W-${getMatchLabel(round - 1, feeder, numR1WB)}`;
}

// Feeder label for a pending LB slot
export function getDELBFeederLabel(lbRound: number, matchNum: number, slot: "home" | "away", size: number): string {
  const numR1WB  = size / 2;
  const numR1LB  = size / 4;

  if (lbRound === 1) {
    const wbM = slot === "home" ? 2 * matchNum - 1 : 2 * matchNum;
    return `Loser of W-${getMatchLabel(1, wbM, numR1WB)}`;
  }
  if (lbRound % 2 === 0) {
    // Drop round: home = prev LB winner, away = WB loser
    if (slot === "home") return `Winner of L-${getLBMatchLabel(lbRound - 1, matchNum, numR1LB)}`;
    const wbRound = lbRound / 2 + 1;
    return `Loser of W-${getMatchLabel(wbRound, matchNum, numR1WB)}`;
  }
  // Consolidation: both come from prev LB round
  const prevM = slot === "home" ? 2 * matchNum - 1 : 2 * matchNum;
  return `Winner of L-${getLBMatchLabel(lbRound - 1, prevM, numR1LB)}`;
}

export function generateDEMatchInserts(teams: { id: string }[]): BracketMatchInsert[] {
  const n     = teams.length;
  const size  = nextPow2(n);
  const numWB = getDEWBRounds(size);
  const numLB = getDELBRounds(size);
  const order = getSeedOrder(size);
  const out: BracketMatchInsert[] = [];

  // WB R1 (seeded, byes handled same as SE)
  for (let i = 0; i < size / 2; i++) {
    const s1  = order[2 * i] - 1;
    const s2  = order[2 * i + 1] - 1;
    const t1  = s1 < n ? teams[s1] : null;
    const t2  = s2 < n ? teams[s2] : null;
    const bye = t2 === null;
    out.push({
      round: 1, match_number: i + 1, stage: DE_WINNERS,
      home_team_id: t1?.id ?? null, away_team_id: t2?.id ?? null,
      home_score: bye ? 1 : null, away_score: bye ? 0 : null,
      status: bye ? "completed" : "scheduled",
    });
  }

  // WB R2..Finals
  for (let r = 2; r <= numWB; r++) {
    const count = size / Math.pow(2, r);
    for (let m = 1; m <= count; m++) {
      out.push({ round: r, match_number: m, stage: DE_WINNERS,
        home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending" });
    }
  }

  // LB all rounds
  for (let r = 1; r <= numLB; r++) {
    const count = size / Math.pow(2, Math.ceil(r / 2) + 1);
    for (let m = 1; m <= count; m++) {
      out.push({ round: r, match_number: m, stage: DE_LOSERS,
        home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending" });
    }
  }

  // Grand Final: match 1 (main) + match 2 (bracket reset, if needed)
  out.push({ round: 1, match_number: 1, stage: DE_GF,
    home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending" });
  out.push({ round: 1, match_number: 2, stage: DE_GF,
    home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending" });

  return out;
}

// Sequential letter label for a match (A, B, C... across all rounds).
// For SE / WB — each round halves the match count.
export function getMatchLabel(round: number, matchNum: number, numR1Matches: number): string {
  let idx = 0;
  for (let r = 1; r < round; r++) idx += numR1Matches / Math.pow(2, r - 1);
  idx += matchNum - 1;
  if (idx < 26) return String.fromCharCode(65 + idx);
  return String.fromCharCode(65 + Math.floor(idx / 26) - 1) + String.fromCharCode(65 + (idx % 26));
}

// LB-specific label — odd/even rounds come in pairs (same count), then halve.
// e.g. numR1LB=2: R1→A,B  R2→C,D  R3→E  R4→F
export function getLBMatchLabel(round: number, matchNum: number, numR1LB: number): string {
  let idx = 0;
  for (let r = 1; r < round; r++) {
    idx += numR1LB / Math.pow(2, Math.floor((r - 1) / 2));
  }
  idx += matchNum - 1;
  if (idx < 26) return String.fromCharCode(65 + idx);
  return String.fromCharCode(65 + Math.floor(idx / 26) - 1) + String.fromCharCode(65 + (idx % 26));
}

// Label for a null slot waiting on a feeder match winner.
export function getFeederLabel(round: number, matchNum: number, slot: "home" | "away", numR1Matches: number): string {
  if (round <= 1) return "TBD";
  const feederMatch = slot === "home" ? 2 * matchNum - 1 : 2 * matchNum;
  return `Winner of ${getMatchLabel(round - 1, feederMatch, numR1Matches)}`;
}

export type BracketMatchInsert = {
  round: number;
  match_number: number;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  stage: string;
};

// ── Hybrid Bracket ─────────────────────────────────────────────────────────────
// 12-team bracket: 4 UB teams (group 1sts) + 8 LB teams (Swiss top 8).
//   hybrid_ub  R1: UB QF (4→2, losers drop to LB R3)
//   hybrid_lb  R1: LB R1 (8→4)
//              R2: LB R2 (4→2)
//              R3: LB QF (2 LB R2 winners + 2 UB losers → 2)
//   hybrid_sf  R1: SF (2 UB winners + 2 LB QF winners → 2)
//   hybrid_gf  R1: GF (1 match → champion)

export const HYBRID_UB = "hybrid_ub";
export const HYBRID_LB = "hybrid_lb";
export const HYBRID_SF = "hybrid_sf";
export const HYBRID_GF = "hybrid_gf";

// 8-team variant stage names (4 UB + 4 LB)
export const HYBRID8_UB = "hybrid8_ub";
export const HYBRID8_LB = "hybrid8_lb";
export const HYBRID8_SF = "hybrid8_sf";
export const HYBRID8_GF = "hybrid8_gf";

// Generate all match rows for the hybrid bracket given 4 UB seeds and 8 LB seeds.
// ubTeams: group 1sts (seeded 1-4), lbTeams: Swiss qualifiers (seeded 1-8).
export function generateHybridMatchInserts(
  ubTeams: { id: string }[],
  lbTeams: { id: string }[],
): BracketMatchInsert[] {
  const inserts: BracketMatchInsert[] = [];

  // UB R1: seed order [1,4,2,3] → M1=(1v4), M2=(2v3)
  const ubOrder = getSeedOrder(4); // [1,4,2,3]
  for (let i = 0; i < 2; i++) {
    inserts.push({
      round: 1, match_number: i + 1, stage: HYBRID_UB,
      home_team_id: ubTeams[ubOrder[2 * i] - 1].id,
      away_team_id: ubTeams[ubOrder[2 * i + 1] - 1].id,
      home_score: null, away_score: null, status: "scheduled",
    });
  }

  // LB R1: 4 matches (1v5, 2v6, 3v7, 4v8)
  for (let i = 0; i < 4; i++) {
    inserts.push({
      round: 1, match_number: i + 1, stage: HYBRID_LB,
      home_team_id: lbTeams[i].id,
      away_team_id: lbTeams[i + 4].id,
      home_score: null, away_score: null, status: "scheduled",
    });
  }

  // LB R2: 2 matches (pending)
  for (let m = 1; m <= 2; m++) {
    inserts.push({
      round: 2, match_number: m, stage: HYBRID_LB,
      home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending",
    });
  }

  // LB R3 (QF): 2 matches (pending — home from LB R2, away from UB loser)
  for (let m = 1; m <= 2; m++) {
    inserts.push({
      round: 3, match_number: m, stage: HYBRID_LB,
      home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending",
    });
  }

  // SF: 2 matches (pending — home from UB winner, away from LB QF winner)
  for (let m = 1; m <= 2; m++) {
    inserts.push({
      round: 1, match_number: m, stage: HYBRID_SF,
      home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending",
    });
  }

  // GF: 1 match
  inserts.push({
    round: 1, match_number: 1, stage: HYBRID_GF,
    home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending",
  });

  return inserts;
}

// 8-team hybrid: 4 UB seeds (group 1sts) + 4 LB seeds (Swiss top 4).
//   hybrid8_ub  R1: UB QF (4→2, losers drop directly to LB R2 / LB QF)
//   hybrid8_lb  R1: LB R1 (4→2)
//              R2: LB QF (2 LB R1 winners + 2 UB losers → 2)
//   hybrid8_sf  R1: SF (2 UB winners + 2 LB QF winners → 2)
//   hybrid8_gf  R1: GF
export function generateHybrid8MatchInserts(
  ubTeams: { id: string }[],
  lbTeams: { id: string }[],
): BracketMatchInsert[] {
  const inserts: BracketMatchInsert[] = [];

  // UB R1: seed order [1,4,2,3] → M1=(1v4), M2=(2v3)
  const ubOrder = getSeedOrder(4);
  for (let i = 0; i < 2; i++) {
    inserts.push({
      round: 1, match_number: i + 1, stage: HYBRID8_UB,
      home_team_id: ubTeams[ubOrder[2 * i] - 1].id,
      away_team_id: ubTeams[ubOrder[2 * i + 1] - 1].id,
      home_score: null, away_score: null, status: "scheduled",
    });
  }

  // LB R1: seed order [1,4,2,3] → M1=(1v4), M2=(2v3)
  const lbOrder = getSeedOrder(4);
  for (let i = 0; i < 2; i++) {
    inserts.push({
      round: 1, match_number: i + 1, stage: HYBRID8_LB,
      home_team_id: lbTeams[lbOrder[2 * i] - 1].id,
      away_team_id: lbTeams[lbOrder[2 * i + 1] - 1].id,
      home_score: null, away_score: null, status: "scheduled",
    });
  }

  // LB R2 (QF): 2 matches (home from LB R1 winner, away from UB R1 loser)
  for (let m = 1; m <= 2; m++) {
    inserts.push({
      round: 2, match_number: m, stage: HYBRID8_LB,
      home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending",
    });
  }

  // SF: 2 matches (home from UB winner, away from LB QF winner)
  for (let m = 1; m <= 2; m++) {
    inserts.push({
      round: 1, match_number: m, stage: HYBRID8_SF,
      home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending",
    });
  }

  // GF: 1 match
  inserts.push({
    round: 1, match_number: 1, stage: HYBRID8_GF,
    home_team_id: null, away_team_id: null, home_score: null, away_score: null, status: "pending",
  });

  return inserts;
}

export function generateSEMatchInserts(
  teams: { id: string }[],
  stage = "single_elimination"
): BracketMatchInsert[] {
  const n = teams.length;
  const size = nextPow2(n);
  const numRounds = Math.log2(size);
  const order = getSeedOrder(size);
  const inserts: BracketMatchInsert[] = [];

  for (let i = 0; i < size / 2; i++) {
    const s1 = order[2 * i] - 1;
    const s2 = order[2 * i + 1] - 1;
    const t1 = s1 < n ? teams[s1] : null;
    const t2 = s2 < n ? teams[s2] : null;
    const bye = t2 === null;
    inserts.push({
      round: 1, match_number: i + 1,
      home_team_id: t1?.id ?? null,
      away_team_id: t2?.id ?? null,
      home_score: bye ? 1 : null,
      away_score: bye ? 0 : null,
      status: bye ? "completed" : "scheduled",
      stage,
    });
  }

  for (let r = 2; r <= numRounds; r++) {
    const count = size / Math.pow(2, r);
    for (let m = 1; m <= count; m++) {
      inserts.push({
        round: r, match_number: m,
        home_team_id: null, away_team_id: null,
        home_score: null, away_score: null,
        status: "pending", stage,
      });
    }
  }

  return inserts;
}
