import "server-only";
import { supabaseAdmin } from "./supabase";
import {
  generateSEMatchInserts, generateDEMatchInserts, generateSEPlaceholderInserts,
  DE_WINNERS, DE_LOSERS, wbLoserTarget,
  nextPow2, getSeedOrder,
  getNumGroups, getGroupStage, parseGroupNum,
  snakeDraftGroups, roundRobinSchedule,
  computeGroupStandings, seedGroupQualifiers,
  SWISS_STAGE, SWISS_ADVANCE_WINS, SWISS_ELIMINATE_LOSSES, SWISS8_ADVANCE_WINS, SWISS8_ELIMINATE_LOSSES,
  computeSwissRecords, generateSwissR1Inserts,
  generateSwissNextRoundInserts, seedSwissQualifiers,
  computeSwissRoundSizes, generateSwissPlaceholderInserts,
  SE_QUALIFIER, generateSEQualifierInserts,
  DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS, generateDEQualifierInserts,
  HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF, generateHybridMatchInserts, generateHybridPlaceholderInserts,
  HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF, generateHybrid8MatchInserts, generateHybrid8PlaceholderInserts,
  type BracketMatchInsert,
} from "./bracket";
import type { SeasonFormatConfig } from "@/app/dashboard/season/format-editor";

// Pair seeds for a cross-group Swiss R1. Each entry carries a groupIdx so the
// algorithm can enforce different-group matchups. Uses 1-vs-N, 2-vs-(N-1) fold
// ideal (best-vs-worst seeding), then backtracks to find any cross-group pairing,
// and only allows same-group as a true last resort.
function pairCrossGroupR1(
  seeds: { id: string; groupIdx: number }[]
): { homeId: string; awayId: string }[] {
  const n = seeds.length;
  if (n < 2) return [];
  const sameGroup = (i: number, j: number) => seeds[i].groupIdx === seeds[j].groupIdx;
  const half = Math.floor(n / 2);

  // Fold ideal: 1vN, 2v(N-1), ..., 8v9 for 16 seeds.
  // With cyclic group assignment (i%g), this is always conflict-free for even g.
  const ideal: [number, number][] = Array.from({ length: half }, (_, i) => [i, n - 1 - i]);
  if (ideal.every(([i, j]) => !sameGroup(i, j)))
    return ideal.map(([i, j]) => ({ homeId: seeds[i].id, awayId: seeds[j].id }));

  function backtrack(rem: number[], allowSame: boolean): [number, number][] | null {
    if (rem.length === 0) return [];
    const [first, ...rest] = rem;
    for (let k = 0; k < rest.length; k++) {
      if (allowSame || !sameGroup(first, rest[k])) {
        const sub = backtrack([...rest.slice(0, k), ...rest.slice(k + 1)], allowSame);
        if (sub !== null) return [[first, rest[k]], ...sub];
      }
    }
    return null;
  }

  const idx = Array.from({ length: n }, (_, i) => i);
  const result = backtrack(idx, false) ?? backtrack(idx, true)!;
  return result.map(([i, j]) => ({ homeId: seeds[i].id, awayId: seeds[j].id }));
}

function makeSwissR1Inserts(pairs: { homeId: string; awayId: string }[]): BracketMatchInsert[] {
  return pairs.map((p, i) => ({
    round: 1, match_number: i + 1, stage: SWISS_STAGE,
    home_team_id: p.homeId, away_team_id: p.awayId,
    home_score: null, away_score: null, status: "scheduled",
  }));
}

// Inserts a Swiss stage's R1 pairings plus deterministic placeholder rows (null
// team_ids) for every later round, so admins can schedule per-match times ahead of
// pairings. Round match counts only depend on team count and the advance/eliminate
// thresholds (computeSwissRoundSizes), never on who wins, so the whole stage's slot
// structure is knowable upfront — buildAndSaveNextSwissRound backfills each
// placeholder round's team_ids once that round's pairing actually resolves.
// Backfill round-1 pairings for `stage` into placeholder rows pre-created the moment
// the stage's size became knowable (e.g. at group-stage build time, long before the
// predecessor stage finishes) — updating in place rather than inserting fresh rows,
// since later rounds' placeholders already exist too. Falls back to a plain insert
// (optionally with extra rows, e.g. later-round placeholders) for stages/seasons
// that never got early placeholders — i.e. any season built before this shipped.
async function saveRoundOne(
  stage: string,
  r1Inserts: BracketMatchInsert[],
  fallbackExtraInserts: BracketMatchInsert[] = [],
): Promise<{ error?: string }> {
  const { data: existing } = await supabaseAdmin
    .from("matches")
    .select("id, match_number")
    .eq("stage", stage).eq("round", 1)
    .is("home_team_id", null)
    .order("match_number");

  const placeholders = existing ?? [];
  if (placeholders.length >= r1Inserts.length) {
    for (let i = 0; i < r1Inserts.length; i++) {
      const { error } = await supabaseAdmin.from("matches").update({
        home_team_id: r1Inserts[i].home_team_id,
        away_team_id: r1Inserts[i].away_team_id,
        home_score: r1Inserts[i].home_score,
        away_score: r1Inserts[i].away_score,
        status: r1Inserts[i].status,
      }).eq("id", placeholders[i].id);
      if (error) return { error: error.message };
    }
    return {};
  }

  const { error } = await supabaseAdmin.from("matches").insert([...r1Inserts, ...fallbackExtraInserts]);
  return { error: error?.message };
}

// Same as saveRoundOne, but for the Swiss stage specifically, where the fallback
// path also needs placeholders for every round after round 1.
async function saveSwissRoundOne(
  r1Inserts: BracketMatchInsert[],
  n: number,
  advanceWins: number,
  eliminateLosses: number,
): Promise<{ error?: string }> {
  const roundSizes = computeSwissRoundSizes(n, advanceWins, eliminateLosses);
  const laterRounds = roundSizes
    .slice(1)
    .flatMap((count, i) => generateSwissPlaceholderInserts(i + 2, count));
  return saveRoundOne(SWISS_STAGE, r1Inserts, laterRounds);
}

// Build a set of canonical "A:B" (lexicographic) keys from completed match history.
function buildPlayedSet(
  matches: { home_team_id: string | null; away_team_id: string | null }[],
): Set<string> {
  const s = new Set<string>();
  for (const m of matches) {
    if (m.home_team_id && m.away_team_id) {
      const a = m.home_team_id, b = m.away_team_id;
      s.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  return s;
}

// Compute average RV per team from player rows.
function computeAvgRV(
  teamIds: string[],
  players: { team_id: string | null; peak_2v2: number | null; current_2v2: number | null; peak_3v3: number | null; current_3v3: number | null }[],
): Record<string, number> {
  const rv: Record<string, number> = {};
  for (const id of teamIds) {
    const roster = players.filter(p => p.team_id === id);
    const sum = roster.reduce((s, p) =>
      s + (Number(p.peak_2v2) + Number(p.current_2v2)) * 0.3 +
           (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.2, 0);
    rv[id] = roster.length ? sum / roster.length : 0;
  }
  return rv;
}

// Reorder SE seeds to avoid R1 rematches from a prior stage without restructuring
// the bracket. For each R1 pair (determined by getSeedOrder), if both teams played
// before, swaps one seed with the nearest alternative that clears the rematch.
function avoidR1Rematches(
  seeds: { id: string }[],
  playedPairs: Set<string>,
): { id: string }[] {
  const n = seeds.length;
  const size = nextPow2(n);
  const order = getSeedOrder(size);
  const result = [...seeds];
  const hasPlayed = (a: string, b: string) =>
    playedPairs.has(a < b ? `${a}:${b}` : `${b}:${a}`);

  for (let i = 0; i < size / 2; i++) {
    const s1 = order[2 * i] - 1;
    const s2 = order[2 * i + 1] - 1;
    if (s1 >= n || s2 >= n) continue;
    if (!hasPlayed(result[s1].id, result[s2].id)) continue;

    // Swap result[s2] with the nearest seed that resolves the rematch.
    for (let delta = 1; delta < n; delta++) {
      let swapped = false;
      for (const c of [s2 + delta, s2 - delta]) {
        if (c < 0 || c >= n || c === s1) continue;
        if (!hasPlayed(result[s1].id, result[c].id)) {
          [result[s2], result[c]] = [result[c], result[s2]];
          swapped = true;
          break;
        }
      }
      if (swapped || !hasPlayed(result[s1].id, result[s2].id)) break;
    }
  }

  return result;
}

// Per-format ceiling on participating teams. When the pool exceeds this, only the
// top seeds (by season standing, then Rank Value) play; the rest are left out.
// Mirrors the maxTeams values in format-editor.tsx. Presets absent here are uncapped.
const PRESET_MAX_TEAMS: Record<string, number> = {
  group_single_elimination: 64,
  group_swiss_single_elimination: 64,
  group_swiss_hybrid: 32,
  group_swiss_hybrid_8: 32,
};

// ── Group Stage ────────────────────────────────────────────────────────────────

async function buildGroupMatches(
  seeded: { id: string }[],
  format: SeasonFormatConfig,
  avgMmr?: Record<string, number>,
): Promise<{ error?: string; ok?: boolean }> {
  const n = seeded.length;
  const numGroups = getNumGroups(n);

  // Assign teams to groups
  const teams = format.groupSeedingMethod === "random"
    ? [...seeded].sort(() => Math.random() - 0.5)
    : seeded;
  const groups = snakeDraftGroups(teams, numGroups, avgMmr ? (t) => avgMmr[t.id] ?? 0 : undefined);

  // Rounds per group size: single round-robin for groups of 6+, padded with
  // rematch rounds for small groups so they still get enough games. Keyed by the
  // smallest group so every group plays the same number of rounds. An admin-set
  // groupRounds overrides this default outright.
  //   3 → 8   4 → 6   5 → 8   6 → 5   7 → 6   8 → 7
  const ROUNDS_BY_GROUP_SIZE: Record<number, number> = { 3: 8, 4: 6, 5: 8, 6: 5, 7: 6, 8: 7 };
  const minGroupSize = Math.min(...groups.map(g => g.length));
  const targetRounds = format.groupRounds ?? ROUNDS_BY_GROUP_SIZE[minGroupSize] ?? Math.max(1, minGroupSize - 1);
  // Round up to a whole number of round-robin passes so byes distribute evenly and
  // every team in the smallest group plays the same number of games. A pass is
  // groupSize rounds for odd groups (one bye each round) or groupSize-1 for even.
  const minPassLen = minGroupSize % 2 === 0 ? minGroupSize - 1 : minGroupSize;
  const totalRounds = Math.max(1, Math.ceil(targetRounds / minPassLen) * minPassLen);

  const inserts: BracketMatchInsert[] = [];
  groups.forEach((groupTeams, gIdx) => {
    const stage = getGroupStage(gIdx + 1);
    const gSize = groupTeams.length;
    // A full round-robin pass. For odd groups every round has exactly one bye;
    // using the complete schedule (not dropping the last round) rotates the bye
    // evenly across all teams so none plays more games than the others.
    const roundsPerPass = roundRobinSchedule(gSize);
    if (roundsPerPass.length === 0) return;

    // Cycle through the round-robin, repeating passes (with home/away swapped on
    // alternate passes) until we've laid out totalRounds rounds.
    for (let r = 0; r < totalRounds; r++) {
      const passIdx = Math.floor(r / roundsPerPass.length);
      const roundInPass = r % roundsPerPass.length;
      const swap = passIdx % 2 === 1;
      roundsPerPass[roundInPass].forEach(([homeIdx, awayIdx], mIdx) => {
        const [h, a] = swap ? [awayIdx, homeIdx] : [homeIdx, awayIdx];
        inserts.push({
          round: r + 1,
          match_number: mIdx + 1,
          stage,
          home_team_id: groupTeams[h].id,
          away_team_id: groupTeams[a].id,
          home_score: null,
          away_score: null,
          status: "scheduled",
        });
      });
    }
  });

  const { error } = await supabaseAdmin.from("matches").insert(inserts);
  if (error) return { error: error.message };

  const downstream = downstreamPlaceholdersForGroupFormat(format.preset, n, numGroups, format);
  if (downstream.length) {
    const { error: dsError } = await supabaseAdmin.from("matches").insert(downstream);
    if (dsError) return { error: dsError.message };
  }

  return { ok: true };
}

// Pre-create every downstream stage's match skeleton the moment its size becomes
// knowable — for group-fed formats, that's the instant groups are built, since
// qualifier/Swiss/hybrid slot counts depend only on num_teams and format, never on
// group results. Lets admins pin match times for Swiss/SE/hybrid rounds before a
// single group game is played; the buildAndSaveXFromGroups/FromSwiss functions
// backfill these rows in place once real pairings are known.
function downstreamPlaceholdersForGroupFormat(
  preset: string | undefined,
  n: number,
  numGroups: number,
  format: SeasonFormatConfig,
): BracketMatchInsert[] {
  if (preset === "group_single_elimination") {
    const totalAdv = format.groupMaxAdvancing ?? Math.floor((n * 3) / 4);
    const qualifiersPerGroup = Math.max(1, Math.round(totalAdv / numGroups));
    return generateSEPlaceholderInserts(qualifiersPerGroup * numGroups, "single_elimination");
  }
  if (preset === "group_swiss_single_elimination") {
    const swissN = Math.floor(16 / numGroups) * numGroups;
    const roundSizes = computeSwissRoundSizes(swissN, SWISS_ADVANCE_WINS, SWISS_ELIMINATE_LOSSES);
    const swissInserts = roundSizes.flatMap((count, i) => generateSwissPlaceholderInserts(i + 1, count));
    return [...swissInserts, ...generateSEPlaceholderInserts(8, "single_elimination")];
  }
  if (preset === "group_swiss_hybrid") {
    const roundSizes = computeSwissRoundSizes(16, SWISS_ADVANCE_WINS, SWISS_ELIMINATE_LOSSES);
    const swissInserts = roundSizes.flatMap((count, i) => generateSwissPlaceholderInserts(i + 1, count));
    return [...swissInserts, ...generateHybridPlaceholderInserts()];
  }
  if (preset === "group_swiss_hybrid_8") {
    const roundSizes = computeSwissRoundSizes(8, SWISS8_ADVANCE_WINS, SWISS8_ELIMINATE_LOSSES);
    const swissInserts = roundSizes.flatMap((count, i) => generateSwissPlaceholderInserts(i + 1, count));
    return [...swissInserts, ...generateHybrid8PlaceholderInserts()];
  }
  return [];
}

// Swiss (fixed 16 seeds) + SE final (fixed 8 qualifiers) placeholder skeleton for the
// SE-qualifier and DE-qualifier formats — both narrow to exactly 16 survivors and
// exactly 8 SE-final qualifiers regardless of who wins, so this can be built the
// moment the qualifier bracket itself is created.
function swissAndSEFinalPlaceholders(): BracketMatchInsert[] {
  const roundSizes = computeSwissRoundSizes(16, SWISS_ADVANCE_WINS, SWISS_ELIMINATE_LOSSES);
  const swissInserts = roundSizes.flatMap((count, i) => generateSwissPlaceholderInserts(i + 1, count));
  return [...swissInserts, ...generateSEPlaceholderInserts(8, "single_elimination")];
}

// Called by the admin after group stage is complete to generate the SE bracket.
export async function buildAndSaveSEFromGroups(): Promise<{ error?: string; ok?: boolean }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("season_format, num_teams")
    .single();

  const format = settings?.season_format as SeasonFormatConfig | null;
  if (!format || format.preset !== "group_single_elimination") {
    return { error: "Format is not Group → SE." };
  }

  const n = (settings?.num_teams as number) ?? 0;
  if (!n) return { error: "No teams in league_settings." };

  const numGroups = getNumGroups(n);
  const teamsPerGroup = Math.ceil(n / numGroups);

  // Determine how many advance per group
  const totalAdv = format.groupMaxAdvancing ?? Math.floor((n * 3) / 4);
  const qualifiersPerGroup = Math.max(1, Math.round(totalAdv / numGroups));

  // Fetch all group matches
  const stages = Array.from({ length: numGroups }, (_, i) => getGroupStage(i + 1));
  const { data: allGroupMatches } = await supabaseAdmin
    .from("matches")
    .select("stage, home_team_id, away_team_id, home_score, away_score, status")
    .in("stage", stages);

  if (!allGroupMatches?.length) return { error: "No group matches found." };

  // Check all group matches are completed
  const pending = allGroupMatches.filter((m) => m.status !== "completed");
  if (pending.length > 0) return { error: `${pending.length} group match${pending.length === 1 ? "" : "es"} still need to be played.` };

  // Compute standings per group (ordered by group number)
  const groupStandings = stages.map((stage) =>
    computeGroupStandings(allGroupMatches.filter((m) => m.stage === stage))
  );

  // Seed qualifiers for SE
  const qualified = seedGroupQualifiers(groupStandings, qualifiersPerGroup);
  if (qualified.length < 2) return { error: "Not enough qualifiers to build SE bracket." };

  // Backfill the placeholder bracket scaffolded at group-build time (or insert fresh
  // for seasons built before that shipped).
  const seInserts = generateSEMatchInserts(qualified);
  const { error: insertError } = await saveRoundOne(
    "single_elimination",
    seInserts.filter(m => m.round === 1),
    seInserts.filter(m => m.round > 1),
  );
  if (insertError) return { error: insertError };

  // Advance SE R1 byes
  const { data: byeMatches } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, home_team_id")
    .eq("stage", "single_elimination")
    .eq("round", 1)
    .eq("status", "completed")
    .not("home_team_id", "is", null);

  for (const bye of byeMatches ?? []) {
    const nr   = 2;
    const nm   = Math.ceil(bye.match_number / 2);
    const slot = bye.match_number % 2 === 1 ? "home_team_id" : "away_team_id";
    const { data: nextMatch } = await supabaseAdmin
      .from("matches").select("id")
      .eq("stage", "single_elimination").eq("round", nr).eq("match_number", nm)
      .maybeSingle();
    if (nextMatch) {
      await supabaseAdmin.from("matches")
        .update({ [slot]: bye.home_team_id, status: "scheduled" })
        .eq("id", nextMatch.id);
    }
  }

  return { ok: true };
}

// ── Swiss Stage ────────────────────────────────────────────────────────────────

// Build Swiss R1 from group qualifiers (group → swiss → SE format).
export async function buildAndSaveSwissFromGroups(): Promise<{ error?: string; ok?: boolean }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("season_format, num_teams").single();
  const format = settings?.season_format as SeasonFormatConfig | null;
  if (!format || format.preset !== "group_swiss_single_elimination")
    return { error: "Format is not Group → Swiss → SE." };

  const n = (settings?.num_teams as number) ?? 0;
  if (!n) return { error: "No teams in league_settings." };

  const numGroups = getNumGroups(n);
  const qualifiersPerGroup = Math.floor(16 / numGroups);

  const stages = Array.from({ length: numGroups }, (_, i) => getGroupStage(i + 1));
  const { data: allGroupMatches } = await supabaseAdmin
    .from("matches")
    .select("stage, home_team_id, away_team_id, home_score, away_score, status")
    .in("stage", stages);

  if (!allGroupMatches?.length) return { error: "No group matches found." };
  const pending = allGroupMatches.filter(m => m.status !== "completed");
  if (pending.length > 0) return { error: `${pending.length} group match${pending.length === 1 ? "" : "es"} still pending.` };

  const groupStandings = stages.map(stage =>
    computeGroupStandings(allGroupMatches.filter(m => m.stage === stage))
  );
  const qualified = seedGroupQualifiers(groupStandings, qualifiersPerGroup);
  if (qualified.length !== 16) return { error: `Expected 16 qualifiers, got ${qualified.length}.` };

  // seedGroupQualifiers cycles through groups: [G0R1, G1R1, ..., G0R2, G1R2, ...]
  // so position i belongs to group i % numGroups. Tag each seed then pair cross-group.
  const seededWithGroup = qualified.map((t, i) => ({ id: t.id, groupIdx: i % numGroups }));
  const pairs = pairCrossGroupR1(seededWithGroup);
  const inserts = makeSwissR1Inserts(pairs);
  const { error } = await saveSwissRoundOne(inserts, 16, SWISS_ADVANCE_WINS, SWISS_ELIMINATE_LOSSES);
  if (error) return { error };
  return { ok: true };
}

// Build the next Swiss round from existing Swiss match results. Rounds beyond the
// current one may already exist as placeholder rows (null team_ids, from
// saveSwissRoundOne or the group/qualifier-stage scaffolding) — if so, this backfills
// them in place rather than inserting new rows, so any time an admin already pinned
// on a placeholder survives.
export async function buildAndSaveNextSwissRound(): Promise<{ error?: string; ok?: boolean }> {
  const [{ data: swissMatches }, { data: settings }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select("id, round, match_number, home_team_id, away_team_id, home_score, away_score, status")
      .eq("stage", SWISS_STAGE)
      .order("round").order("match_number"),
    supabaseAdmin.from("league_settings").select("season_format").single(),
  ]);

  if (!swissMatches?.length) return { error: "No Swiss matches found." };

  const isHybrid8 = (settings?.season_format as { preset?: string } | null)?.preset === "group_swiss_hybrid_8";
  const advanceWins = isHybrid8 ? SWISS8_ADVANCE_WINS : SWISS_ADVANCE_WINS;
  const eliminateLosses = isHybrid8 ? SWISS8_ELIMINATE_LOSSES : SWISS_ELIMINATE_LOSSES;

  // Placeholder rows for future rounds have no teams yet — only paired rounds count
  // toward "current round," or the stage would look complete the instant it starts.
  const pairedMatches = swissMatches.filter(m => m.home_team_id && m.away_team_id);
  if (!pairedMatches.length) return { error: "No Swiss matches found." };

  const currentRound = Math.max(...pairedMatches.map(m => m.round));
  const currentRoundMatches = pairedMatches.filter(m => m.round === currentRound);
  const pending = currentRoundMatches.filter(m => m.status !== "completed");
  if (pending.length > 0) return { error: `${pending.length} match${pending.length === 1 ? "" : "es"} in round ${currentRound} still pending.` };

  // Gather all team IDs
  const teamIds = [...new Set(swissMatches.flatMap(m =>
    [m.home_team_id, m.away_team_id].filter(Boolean) as string[]
  ))];
  const records = computeSwissRecords(swissMatches, teamIds);

  const active = records.filter(r => r.wins < advanceWins && r.losses < eliminateLosses);
  if (active.length === 0) return { error: "Swiss stage is complete — no active teams." };

  const nextRound = currentRound + 1;
  const inserts = generateSwissNextRoundInserts(records, nextRound, advanceWins, eliminateLosses);
  if (!inserts.length) return { error: "Could not generate pairings for next round." };

  const placeholders = swissMatches
    .filter(m => m.round === nextRound && !m.home_team_id && !m.away_team_id)
    .sort((a, b) => a.match_number - b.match_number);

  if (placeholders.length >= inserts.length) {
    for (let i = 0; i < inserts.length; i++) {
      const { error } = await supabaseAdmin.from("matches").update({
        home_team_id: inserts[i].home_team_id,
        away_team_id: inserts[i].away_team_id,
        status: "scheduled",
      }).eq("id", placeholders[i].id);
      if (error) return { error: error.message };
    }
  } else {
    const { error } = await supabaseAdmin.from("matches").insert(inserts);
    if (error) return { error: error.message };
  }
  return { ok: true };
}

// Build SE bracket from the 8 Swiss qualifiers.
export async function buildAndSaveSEFromSwiss(): Promise<{ error?: string; ok?: boolean }> {
  const { data: swissMatches } = await supabaseAdmin
    .from("matches")
    .select("home_team_id, away_team_id, home_score, away_score, status")
    .eq("stage", SWISS_STAGE);

  if (!swissMatches?.length) return { error: "No Swiss matches found." };

  const pending = swissMatches.filter(m => m.status !== "completed");
  if (pending.length > 0) return { error: `${pending.length} Swiss match${pending.length === 1 ? "" : "es"} still pending.` };

  const teamIds = [...new Set(swissMatches.flatMap(m =>
    [m.home_team_id, m.away_team_id].filter(Boolean) as string[]
  ))];
  const records = computeSwissRecords(swissMatches, teamIds);
  const seeded = seedSwissQualifiers(records);
  if (seeded.length < 2) return { error: "Not enough Swiss qualifiers." };

  // Swap seeds to avoid R1 SE rematches from Swiss without breaking bracket structure.
  const swissPlayedPairs = buildPlayedSet(swissMatches);
  const qualified = avoidR1Rematches(seeded, swissPlayedPairs);

  const seInserts = generateSEMatchInserts(qualified);
  const { error: insertError } = await saveRoundOne(
    "single_elimination",
    seInserts.filter(m => m.round === 1),
    seInserts.filter(m => m.round > 1),
  );
  if (insertError) return { error: insertError };

  // Advance SE R1 byes
  const { data: byeMatches } = await supabaseAdmin
    .from("matches").select("id, round, match_number, home_team_id")
    .eq("stage", "single_elimination").eq("round", 1)
    .eq("status", "completed").not("home_team_id", "is", null);

  for (const bye of byeMatches ?? []) {
    const slot = bye.match_number % 2 === 1 ? "home_team_id" : "away_team_id";
    const { data: nextMatch } = await supabaseAdmin
      .from("matches").select("id")
      .eq("stage", "single_elimination").eq("round", 2)
      .eq("match_number", Math.ceil(bye.match_number / 2)).maybeSingle();
    if (nextMatch) {
      await supabaseAdmin.from("matches")
        .update({ [slot]: bye.home_team_id, status: "scheduled" }).eq("id", nextMatch.id);
    }
  }

  return { ok: true };
}

// Build Swiss R1 from SE qualifier winners (se_swiss_se format).
export async function buildAndSaveSwissFromSEQualifier(): Promise<{ error?: string; ok?: boolean }> {
  const { data: seqMatches } = await supabaseAdmin
    .from("matches")
    .select("round, match_number, home_team_id, away_team_id, home_score, away_score, status")
    .eq("stage", SE_QUALIFIER)
    .order("round").order("match_number");

  if (!seqMatches?.length) return { error: "No SE qualifier matches found." };
  const pending = seqMatches.filter(m => m.status !== "completed");
  if (pending.length > 0)
    return { error: `${pending.length} SE qualifier match${pending.length === 1 ? "" : "es"} still pending.` };

  const lastRound = Math.max(...seqMatches.map(m => m.round));
  const lastMatches = seqMatches
    .filter(m => m.round === lastRound)
    .sort((a, b) => a.match_number - b.match_number);

  if (lastMatches.length !== 16)
    return { error: `Expected 16 qualifier slots, got ${lastMatches.length}.` };

  const qualified = lastMatches.map(m => {
    const homeWon = (m.home_score ?? 0) > (m.away_score ?? 0);
    return { id: (homeWon ? m.home_team_id : m.away_team_id) as string };
  });

  // Sort by team RV so fold-seeding (1v16, 2v15, ...) is meaningful.
  const qualifiedIds = qualified.map(t => t.id);
  const { data: rvPlayers } = await supabaseAdmin
    .from("players")
    .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .in("team_id", qualifiedIds);
  const rvByTeam = computeAvgRV(qualifiedIds, rvPlayers ?? []);
  const seeded = [...qualified].sort((a, b) => (rvByTeam[b.id] ?? 0) - (rvByTeam[a.id] ?? 0));

  // Avoid rematches from the SE qualifier stage.
  const playedPairs = buildPlayedSet(seqMatches);
  const inserts = generateSwissR1Inserts(seeded, playedPairs);
  const { error } = await saveSwissRoundOne(inserts, 16, SWISS_ADVANCE_WINS, SWISS_ELIMINATE_LOSSES);
  if (error) return { error };
  return { ok: true };
}

// Build Swiss R1 from DE qualifier survivors (de_swiss_se format).
// WB survivors (0 losses) seed top half; LB survivors (1 loss) seed bottom half.
export async function buildAndSaveSwissFromDEQualifier(): Promise<{ error?: string; ok?: boolean }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("season_format").single();
  const format = settings?.season_format as SeasonFormatConfig | null;
  if (!format || format.preset !== "de_swiss_single_elimination")
    return { error: "Format is not DE Qualifier → Swiss → SE." };

  const { data: deqMatches } = await supabaseAdmin
    .from("matches")
    .select("round, match_number, home_team_id, away_team_id, home_score, away_score, status, stage")
    .in("stage", [DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS])
    .order("stage").order("round").order("match_number");

  if (!deqMatches?.length) return { error: "No DE qualifier matches found." };
  const pending = deqMatches.filter(m => m.status !== "completed");
  if (pending.length > 0)
    return { error: `${pending.length} DE qualifier match${pending.length === 1 ? "" : "es"} still pending.` };

  function pickWinner(m: { home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null }): string | null {
    if (m.home_team_id && m.away_team_id) {
      return (m.home_score ?? 0) > (m.away_score ?? 0) ? m.home_team_id : m.away_team_id;
    }
    return m.home_team_id ?? m.away_team_id;
  }

  const wbMatches = deqMatches.filter(m => m.stage === DE_QUALIFIER_WINNERS);
  const lbMatches = deqMatches.filter(m => m.stage === DE_QUALIFIER_LOSERS);

  const maxWBRound = Math.max(...wbMatches.map(m => m.round));
  const maxLBRound = lbMatches.length ? Math.max(...lbMatches.map(m => m.round)) : 0;

  const wbSurvivors = wbMatches
    .filter(m => m.round === maxWBRound && m.status === "completed" && (m.home_team_id || m.away_team_id))
    .sort((a, b) => a.match_number - b.match_number)
    .map(m => ({ id: pickWinner(m) as string }));

  const lbSurvivors = lbMatches
    .filter(m => m.round === maxLBRound && m.status === "completed" && (m.home_team_id || m.away_team_id))
    .sort((a, b) => a.match_number - b.match_number)
    .map(m => ({ id: pickWinner(m) as string }));

  if (wbSurvivors.length + lbSurvivors.length !== 16)
    return { error: `Expected 16 qualifier survivors, got ${wbSurvivors.length + lbSurvivors.length}.` };

  // Sort within each bracket by RV so WB seeds 1-8 and LB seeds 9-16 reflect quality.
  const allIds = [...wbSurvivors, ...lbSurvivors].map(t => t.id);
  const { data: rvPlayers } = await supabaseAdmin
    .from("players")
    .select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .in("team_id", allIds);
  const rvByTeam = computeAvgRV(allIds, rvPlayers ?? []);
  const seeded = [
    ...wbSurvivors.sort((a, b) => (rvByTeam[b.id] ?? 0) - (rvByTeam[a.id] ?? 0)),
    ...lbSurvivors.sort((a, b) => (rvByTeam[b.id] ?? 0) - (rvByTeam[a.id] ?? 0)),
  ];

  // Avoid rematches from the DE qualifier stage.
  const playedPairs = buildPlayedSet(deqMatches);
  const inserts = generateSwissR1Inserts(seeded, playedPairs);
  const { error } = await saveSwissRoundOne(inserts, 16, SWISS_ADVANCE_WINS, SWISS_ELIMINATE_LOSSES);
  if (error) return { error };
  return { ok: true };
}

// ── Hybrid Bracket ─────────────────────────────────────────────────────────────

// Build Swiss R1 for the hybrid format: takes ranks 2-5 from each group (skip 1sts who go to UB).
export async function buildAndSaveSwissFromGroupsHybrid(): Promise<{ error?: string; ok?: boolean }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("season_format, num_teams").single();
  const format = settings?.season_format as SeasonFormatConfig | null;
  if (!format || format.preset !== "group_swiss_hybrid")
    return { error: "Format is not Group → Swiss → Hybrid." };

  const n = (settings?.num_teams as number) ?? 0;
  if (!n) return { error: "No teams in league_settings." };

  const numGroups = getNumGroups(n);
  const stages = Array.from({ length: numGroups }, (_, i) => getGroupStage(i + 1));
  const { data: allGroupMatches } = await supabaseAdmin
    .from("matches")
    .select("stage, home_team_id, away_team_id, home_score, away_score, status")
    .in("stage", stages);

  if (!allGroupMatches?.length) return { error: "No group matches found." };
  const pending = allGroupMatches.filter(m => m.status !== "completed");
  if (pending.length > 0) return { error: `${pending.length} group match${pending.length === 1 ? "" : "es"} still pending.` };

  const groupStandings = stages.map(stage =>
    computeGroupStandings(allGroupMatches.filter(m => m.stage === stage))
  );

  // Take ranks 1-5 (top 5 per group), then skip the first numGroups entries (rank-1 teams = UB seeds)
  const qualified5 = seedGroupQualifiers(groupStandings, 5);
  const swissSeeds = qualified5.slice(numGroups); // ranks 2-5 only (16 teams for 4 groups)
  if (swissSeeds.length !== 16) return { error: `Expected 16 Swiss seeds, got ${swissSeeds.length}.` };

  // After slicing out rank-1s, position i in swissSeeds still cycles groups with period numGroups.
  const seededWithGroup = swissSeeds.map((t, i) => ({ id: t.id, groupIdx: i % numGroups }));
  const pairs = pairCrossGroupR1(seededWithGroup);
  const inserts = makeSwissR1Inserts(pairs);
  const { error } = await saveSwissRoundOne(inserts, 16, SWISS_ADVANCE_WINS, SWISS_ELIMINATE_LOSSES);
  if (error) return { error };
  return { ok: true };
}

// Build hybrid bracket from group 1sts (UB seeds) + Swiss top 8 (LB seeds).
export async function buildAndSaveHybridFromSwiss(): Promise<{ error?: string; ok?: boolean }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("season_format, num_teams").single();
  const format = settings?.season_format as SeasonFormatConfig | null;
  if (!format || format.preset !== "group_swiss_hybrid")
    return { error: "Format is not Group → Swiss → Hybrid." };

  const n = (settings?.num_teams as number) ?? 0;
  if (!n) return { error: "No teams in league_settings." };

  // Verify Swiss is complete
  const { data: swissMatches } = await supabaseAdmin
    .from("matches")
    .select("home_team_id, away_team_id, home_score, away_score, status")
    .eq("stage", SWISS_STAGE);

  if (!swissMatches?.length) return { error: "No Swiss matches found." };
  const pending = swissMatches.filter(m => m.status !== "completed");
  if (pending.length > 0) return { error: `${pending.length} Swiss match${pending.length === 1 ? "" : "es"} still pending.` };

  // Swiss top 8 → LB seeds
  const teamIds = [...new Set(swissMatches.flatMap(m =>
    [m.home_team_id, m.away_team_id].filter(Boolean) as string[]
  ))];
  const records = computeSwissRecords(swissMatches, teamIds);
  const lbSeeds = seedSwissQualifiers(records);
  if (lbSeeds.length < 8) return { error: `Expected 8 Swiss qualifiers, got ${lbSeeds.length}.` };

  // Group 1sts → UB seeds
  const numGroups = getNumGroups(n);
  const stages = Array.from({ length: numGroups }, (_, i) => getGroupStage(i + 1));
  const { data: allGroupMatches } = await supabaseAdmin
    .from("matches")
    .select("stage, home_team_id, away_team_id, home_score, away_score, status")
    .in("stage", stages);

  if (!allGroupMatches?.length) return { error: "No group matches found." };
  const groupStandings = stages.map(stage =>
    computeGroupStandings(allGroupMatches.filter(m => m.stage === stage))
  );
  const ubSeeds = seedGroupQualifiers(groupStandings, 1); // only rank-1 from each group
  if (ubSeeds.length !== numGroups) return { error: `Expected ${numGroups} UB seeds, got ${ubSeeds.length}.` };
  if (ubSeeds.length !== 4) return { error: `Hybrid requires exactly 4 UB seeds (got ${ubSeeds.length}). Format requires 4 groups.` };

  // Pass Swiss match history so LB R1 avoids rematches from Swiss stage.
  const swissPlayedPairs = buildPlayedSet(swissMatches);
  const inserts = generateHybridMatchInserts(ubSeeds, lbSeeds.slice(0, 8), swissPlayedPairs);

  const { error: ubError } = await saveRoundOne(
    HYBRID_UB,
    inserts.filter(m => m.stage === HYBRID_UB),
  );
  if (ubError) return { error: ubError };

  const { error: lbError } = await saveRoundOne(
    HYBRID_LB,
    inserts.filter(m => m.stage === HYBRID_LB && m.round === 1),
    inserts.filter(m => m.stage !== HYBRID_UB && !(m.stage === HYBRID_LB && m.round === 1)),
  );
  if (lbError) return { error: lbError };

  return { ok: true };
}

// Build Swiss R1 for hybrid_8 format: takes ranks 2-3 from each group (skip 1sts).
export async function buildAndSaveSwissFromGroupsHybrid8(): Promise<{ error?: string; ok?: boolean }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("season_format, num_teams").single();
  const format = settings?.season_format as SeasonFormatConfig | null;
  if (!format || format.preset !== "group_swiss_hybrid_8")
    return { error: "Format is not Group → Swiss → Hybrid(8)." };

  const n = (settings?.num_teams as number) ?? 0;
  if (!n) return { error: "No teams in league_settings." };

  const numGroups = getNumGroups(n);
  const stages = Array.from({ length: numGroups }, (_, i) => getGroupStage(i + 1));
  const { data: allGroupMatches } = await supabaseAdmin
    .from("matches")
    .select("stage, home_team_id, away_team_id, home_score, away_score, status")
    .in("stage", stages);

  if (!allGroupMatches?.length) return { error: "No group matches found." };
  const pending = allGroupMatches.filter(m => m.status !== "completed");
  if (pending.length > 0) return { error: `${pending.length} group match${pending.length === 1 ? "" : "es"} still pending.` };

  const groupStandings = stages.map(stage =>
    computeGroupStandings(allGroupMatches.filter(m => m.stage === stage))
  );

  // Take top 3 per group, skip 1sts (UB seeds) → only ranks 2-3 go to Swiss
  const qualified3 = seedGroupQualifiers(groupStandings, 3);
  const swissSeeds = qualified3.slice(numGroups); // skip first numGroups (rank-1 teams)
  if (swissSeeds.length !== 8) return { error: `Expected 8 Swiss seeds, got ${swissSeeds.length}.` };

  const seededWithGroup = swissSeeds.map((t, i) => ({ id: t.id, groupIdx: i % numGroups }));
  const pairs = pairCrossGroupR1(seededWithGroup);
  const inserts = makeSwissR1Inserts(pairs);
  const { error } = await saveSwissRoundOne(inserts, 8, SWISS8_ADVANCE_WINS, SWISS8_ELIMINATE_LOSSES);
  if (error) return { error };
  return { ok: true };
}

// Build the 8-team hybrid bracket from group 1sts (UB) + Swiss top 4 (LB).
export async function buildAndSaveHybrid8FromSwiss(): Promise<{ error?: string; ok?: boolean }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("season_format, num_teams").single();
  const format = settings?.season_format as SeasonFormatConfig | null;
  if (!format || format.preset !== "group_swiss_hybrid_8")
    return { error: "Format is not Group → Swiss → Hybrid(8)." };

  const n = (settings?.num_teams as number) ?? 0;
  if (!n) return { error: "No teams in league_settings." };

  // Verify Swiss complete
  const { data: swissMatches } = await supabaseAdmin
    .from("matches")
    .select("home_team_id, away_team_id, home_score, away_score, status")
    .eq("stage", SWISS_STAGE);

  if (!swissMatches?.length) return { error: "No Swiss matches found." };
  const pending = swissMatches.filter(m => m.status !== "completed");
  if (pending.length > 0) return { error: `${pending.length} Swiss match${pending.length === 1 ? "" : "es"} still pending.` };

  // Swiss top 4 → LB seeds (hybrid_8 uses 2-win threshold)
  const teamIds = [...new Set(swissMatches.flatMap(m =>
    [m.home_team_id, m.away_team_id].filter(Boolean) as string[]
  ))];
  const records = computeSwissRecords(swissMatches, teamIds);
  const lbSeeds = seedSwissQualifiers(records, SWISS8_ADVANCE_WINS);
  if (lbSeeds.length < 4) return { error: `Expected 4 Swiss qualifiers, got ${lbSeeds.length}.` };

  // Group 1sts → UB seeds
  const numGroups = getNumGroups(n);
  const stages = Array.from({ length: numGroups }, (_, i) => getGroupStage(i + 1));
  const { data: allGroupMatches } = await supabaseAdmin
    .from("matches")
    .select("stage, home_team_id, away_team_id, home_score, away_score, status")
    .in("stage", stages);

  if (!allGroupMatches?.length) return { error: "No group matches found." };
  const groupStandings = stages.map(stage =>
    computeGroupStandings(allGroupMatches.filter(m => m.stage === stage))
  );
  const ubSeeds = seedGroupQualifiers(groupStandings, 1);
  if (ubSeeds.length !== 4) return { error: `Expected 4 UB seeds (group 1sts), got ${ubSeeds.length}.` };

  const inserts = generateHybrid8MatchInserts(ubSeeds, lbSeeds.slice(0, 4));

  const { error: ubError } = await saveRoundOne(
    HYBRID8_UB,
    inserts.filter(m => m.stage === HYBRID8_UB),
  );
  if (ubError) return { error: ubError };

  const { error: lbError } = await saveRoundOne(
    HYBRID8_LB,
    inserts.filter(m => m.stage === HYBRID8_LB && m.round === 1),
    inserts.filter(m => m.stage !== HYBRID8_UB && !(m.stage === HYBRID8_LB && m.round === 1)),
  );
  if (lbError) return { error: lbError };

  return { ok: true };
}

// ── Main bracket builder ───────────────────────────────────────────────────────

export async function buildAndSaveBracket(): Promise<{ error?: string; ok?: boolean; cutTeams?: number }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("season_format")
    .single();

  if (!settings?.season_format) return { error: "No season format configured." };

  // Wipe existing bracket matches
  await supabaseAdmin.from("matches").delete().not("stage", "is", null);

  // Only include teams that have at least one player assigned — this prevents
  // empty slot rows (configured for future seasons) from being seeded into the bracket.
  const { data: players } = await supabaseAdmin
    .from("players").select("team_id, peak_2v2, current_2v2, peak_3v3, current_3v3").not("team_id", "is", null);

  const activeTeamIds = [...new Set((players ?? []).map((p) => p.team_id as string).filter(Boolean))];
  if (!activeTeamIds.length) return { error: "No teams found." };
  if (activeTeamIds.length < 2) return { error: "Need at least 2 teams to generate a bracket." };

  const { data: teamsRaw } = await supabaseAdmin
    .from("teams").select("id, name, wins").in("id", activeTeamIds);

  const avgMmr: Record<string, number> = {};
  (teamsRaw ?? []).forEach((t) => {
    const roster = players?.filter((p) => p.team_id === t.id) ?? [];
    const sum = roster.reduce(
      (s, p) => s + (Number(p.peak_2v2) + Number(p.current_2v2)) * 0.3 + (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.2, 0
    );
    avgMmr[t.id] = roster.length ? sum / roster.length : 0;
  });

  let seeded = [...(teamsRaw ?? [])].sort((a, b) => {
    const diff = (b.wins ?? 0) - (a.wins ?? 0);
    return diff !== 0 ? diff : (avgMmr[b.id] ?? 0) - (avgMmr[a.id] ?? 0);
  });

  const format = settings.season_format as SeasonFormatConfig | null;

  // Enforce the format's team ceiling: keep the top seeds, drop the rest. The cut
  // teams keep their rosters but play no matches. num_teams is realigned so the
  // later-stage builders (which read it back) size their brackets to the survivors.
  let cutTeams = 0;
  const maxTeams = format?.preset ? PRESET_MAX_TEAMS[format.preset] : undefined;
  if (maxTeams !== undefined && seeded.length > maxTeams) {
    cutTeams = seeded.length - maxTeams;
    seeded = seeded.slice(0, maxTeams);
    await supabaseAdmin.from("league_settings")
      .update({ num_teams: maxTeams, updated_at: new Date().toISOString() })
      .not("id", "is", null);
  }

  const isDE            = format?.preset === "double_elimination";
  const isGroup         = format?.preset === "group_single_elimination" || format?.preset === "group_swiss_single_elimination" || format?.preset === "group_swiss_hybrid" || format?.preset === "group_swiss_hybrid_8";
  const isSESwissSE     = format?.preset === "se_swiss_single_elimination";
  const isDESwissSE     = format?.preset === "de_swiss_single_elimination";

  if (isGroup) {
    const groupResult = await buildGroupMatches(seeded, format!, avgMmr);
    return groupResult.ok ? { ok: true, cutTeams } : groupResult;
  }

  // SE Qualifier format: generate only enough SE rounds to reach 16 teams.
  if (isSESwissSE) {
    const inserts = generateSEQualifierInserts(seeded, 16);
    const { error: insertError } = await supabaseAdmin.from("matches").insert(inserts);
    if (insertError) return { error: insertError.message };

    // Advance R1 bye winners into later rounds
    for (let r = 1; ; r++) {
      const { data: byeMatches } = await supabaseAdmin
        .from("matches").select("id, round, match_number, home_team_id")
        .eq("stage", SE_QUALIFIER).eq("round", r)
        .eq("status", "completed").not("home_team_id", "is", null);
      if (!byeMatches?.length) break;
      for (const bye of byeMatches) {
        const slot = bye.match_number % 2 === 1 ? "home_team_id" : "away_team_id";
        const { data: next } = await supabaseAdmin.from("matches").select("id")
          .eq("stage", SE_QUALIFIER).eq("round", r + 1)
          .eq("match_number", Math.ceil(bye.match_number / 2)).maybeSingle();
        if (next) await supabaseAdmin.from("matches")
          .update({ [slot]: bye.home_team_id, status: "scheduled" }).eq("id", next.id);
      }
    }

    // The qualifier bracket always narrows to exactly 16 (regardless of who wins),
    // so Swiss and the SE final can be scaffolded now, before any qualifier is played.
    const { error: dsError } = await supabaseAdmin.from("matches").insert(swissAndSEFinalPlaceholders());
    if (dsError) return { error: dsError.message };

    return { ok: true, cutTeams };
  }

  // DE Qualifier format: truncated DE that narrows to 16 survivors (8 WB + 8 LB).
  if (isDESwissSE) {
    const inserts = generateDEQualifierInserts(seeded, 16);
    const { error: insertError } = await supabaseAdmin.from("matches").insert(inserts);
    if (insertError) return { error: insertError.message };

    // Advance WB R1 bye winners into WB R2
    const { data: byeMatches } = await supabaseAdmin
      .from("matches").select("id, round, match_number, home_team_id")
      .eq("stage", DE_QUALIFIER_WINNERS).eq("round", 1)
      .eq("status", "completed").not("home_team_id", "is", null);

    for (const bye of byeMatches ?? []) {
      const nm   = Math.ceil(bye.match_number / 2);
      const slot = bye.match_number % 2 === 1 ? "home_team_id" : "away_team_id";
      const { data: next } = await supabaseAdmin.from("matches").select("id")
        .eq("stage", DE_QUALIFIER_WINNERS).eq("round", 2).eq("match_number", nm).maybeSingle();
      if (next) {
        await supabaseAdmin.from("matches")
          .update({ [slot]: bye.home_team_id, status: "scheduled" }).eq("id", next.id);
      }
      // WB byes produce no loser — no LB entry needed
    }

    // Ghost LB R1 matches whose both WB R1 feeders are byes
    const { data: wbR1All } = await supabaseAdmin
      .from("matches").select("match_number, status, away_team_id")
      .eq("stage", DE_QUALIFIER_WINNERS).eq("round", 1);
    const wbByeSet = new Set<number>(
      (wbR1All ?? []).filter(m => m.status === "completed" && !m.away_team_id).map(m => m.match_number)
    );
    const { data: lbR1Matches } = await supabaseAdmin
      .from("matches").select("id, match_number")
      .eq("stage", DE_QUALIFIER_LOSERS).eq("round", 1);
    for (const m of lbR1Matches ?? []) {
      if (wbByeSet.has(2 * m.match_number - 1) && wbByeSet.has(2 * m.match_number)) {
        await supabaseAdmin.from("matches")
          .update({ status: "completed", home_score: 0, away_score: 0 }).eq("id", m.id);
      }
    }

    // The qualifier bracket always narrows to exactly 16 (regardless of who wins),
    // so Swiss and the SE final can be scaffolded now, before any qualifier is played.
    const { error: dsError } = await supabaseAdmin.from("matches").insert(swissAndSEFinalPlaceholders());
    if (dsError) return { error: dsError.message };

    return { ok: true, cutTeams };
  }

  const inserts = isDE ? generateDEMatchInserts(seeded) : generateSEMatchInserts(seeded);

  const { error: insertError } = await supabaseAdmin.from("matches").insert(inserts);
  if (insertError) return { error: insertError.message };

  // Advance WB R1 bye winners (SE: single_elimination, DE: de_winners)
  const byeStage = isDE ? DE_WINNERS : "single_elimination";

  const { data: byeMatches } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, home_team_id")
    .eq("stage", byeStage)
    .eq("round", 1)
    .eq("status", "completed")
    .not("home_team_id", "is", null);

  for (const bye of byeMatches ?? []) {
    const nr   = bye.round + 1;
    const nm   = Math.ceil(bye.match_number / 2);
    const slot = bye.match_number % 2 === 1 ? "home_team_id" : "away_team_id";

    const { data: nextMatch } = await supabaseAdmin
      .from("matches").select("id")
      .eq("stage", byeStage).eq("round", nr).eq("match_number", nm)
      .maybeSingle();

    if (nextMatch) {
      await supabaseAdmin.from("matches")
        .update({ [slot]: bye.home_team_id, status: "scheduled" })
        .eq("id", nextMatch.id);
    }

    // DE: byes don't create a loser, so no LB entry needed
  }

  // DE: ghost any LB R1 match whose BOTH feeder WB R1 matches are byes.
  // When both WB R1 feeders are byes, no loser will ever arrive in either slot,
  // so the LB R1 match is permanently empty. Mark it completed with null teams
  // so later rounds can detect it and auto-complete downstream matches as byes.
  if (isDE) {
    const size = nextPow2(seeded.length);
    const numLBR1 = size / 4; // LB R1 match count = size / 2^(ceil(1/2)+1)

    const { data: wbR1All } = await supabaseAdmin
      .from("matches")
      .select("match_number, status, away_team_id")
      .eq("stage", DE_WINNERS)
      .eq("round", 1);

    const wbByeSet = new Set<number>(
      (wbR1All ?? [])
        .filter((m) => m.status === "completed" && !m.away_team_id)
        .map((m) => m.match_number),
    );

    for (let m = 1; m <= numLBR1; m++) {
      if (wbByeSet.has(2 * m - 1) && wbByeSet.has(2 * m)) {
        // Both WB R1 feeders (home=2m-1, away=2m) are byes — ghost this LB R1 match
        await supabaseAdmin.from("matches")
          .update({ status: "completed", home_score: 0, away_score: 0 })
          .eq("stage", DE_LOSERS)
          .eq("round", 1)
          .eq("match_number", m);
      }
    }
  }

  return { ok: true, cutTeams };
}
