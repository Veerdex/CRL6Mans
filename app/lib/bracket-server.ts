import "server-only";
import { supabaseAdmin } from "./supabase";
import {
  generateSEMatchInserts, generateDEMatchInserts,
  DE_WINNERS, DE_LOSERS, wbLoserTarget,
  nextPow2,
  getNumGroups, getGroupStage, parseGroupNum,
  snakeDraftGroups, roundRobinSchedule,
  computeGroupStandings, seedGroupQualifiers,
  SWISS_STAGE, SWISS_ADVANCE_WINS, SWISS_ELIMINATE_LOSSES,
  computeSwissRecords, generateSwissR1Inserts,
  generateSwissNextRoundInserts, seedSwissQualifiers,
  SE_QUALIFIER, generateSEQualifierInserts,
  DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS, generateDEQualifierInserts,
  type BracketMatchInsert,
} from "./bracket";
import type { SeasonFormatConfig } from "@/app/dashboard/season/format-editor";

// ── Group Stage ────────────────────────────────────────────────────────────────

async function buildGroupMatches(
  seeded: { id: string }[],
  format: SeasonFormatConfig,
): Promise<{ error?: string; ok?: boolean }> {
  const n = seeded.length;
  const numGroups = getNumGroups(n);

  // Assign teams to groups
  const teams = format.groupSeedingMethod === "random"
    ? [...seeded].sort(() => Math.random() - 0.5)
    : seeded;
  const groups = snakeDraftGroups(teams, numGroups);

  // Generate round-robin matches for each group
  const inserts: BracketMatchInsert[] = [];
  groups.forEach((groupTeams, gIdx) => {
    const stage = getGroupStage(gIdx + 1);
    const schedule = roundRobinSchedule(groupTeams.length);
    schedule.forEach((round, rIdx) => {
      round.forEach(([homeIdx, awayIdx], mIdx) => {
        inserts.push({
          round: rIdx + 1,
          match_number: mIdx + 1,
          stage,
          home_team_id: groupTeams[homeIdx].id,
          away_team_id: groupTeams[awayIdx].id,
          home_score: null,
          away_score: null,
          status: "scheduled",
        });
      });
    });
  });

  const { error } = await supabaseAdmin.from("matches").insert(inserts);
  if (error) return { error: error.message };
  return { ok: true };
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

  // Insert SE matches
  const seInserts = generateSEMatchInserts(qualified);
  const { error: insertError } = await supabaseAdmin.from("matches").insert(seInserts);
  if (insertError) return { error: insertError.message };

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

  // Rotate the bottom half left by 1 to prevent same-group R1 matchups.
  // seedGroupQualifiers produces [all rank-1s, all rank-2s, ...] in group order, so
  // both halves share the same group pattern. One left-rotation staggers them so every
  // R1 pair is cross-group (e.g. G1-winner vs G2-5th, not G1-winner vs G1-5th).
  const half = qualified.length / 2;
  const seeded = [
    ...qualified.slice(0, half),
    ...qualified.slice(half + 1),
    qualified[half],
  ];

  const inserts = generateSwissR1Inserts(seeded);
  const { error } = await supabaseAdmin.from("matches").insert(inserts);
  if (error) return { error: error.message };
  return { ok: true };
}

// Build the next Swiss round from existing Swiss match results.
export async function buildAndSaveNextSwissRound(): Promise<{ error?: string; ok?: boolean }> {
  const { data: swissMatches } = await supabaseAdmin
    .from("matches")
    .select("round, match_number, home_team_id, away_team_id, home_score, away_score, status")
    .eq("stage", SWISS_STAGE)
    .order("round").order("match_number");

  if (!swissMatches?.length) return { error: "No Swiss matches found." };

  const currentRound = Math.max(...swissMatches.map(m => m.round));
  const currentRoundMatches = swissMatches.filter(m => m.round === currentRound);
  const pending = currentRoundMatches.filter(m => m.status !== "completed");
  if (pending.length > 0) return { error: `${pending.length} match${pending.length === 1 ? "" : "es"} in round ${currentRound} still pending.` };

  // Gather all team IDs
  const teamIds = [...new Set(swissMatches.flatMap(m =>
    [m.home_team_id, m.away_team_id].filter(Boolean) as string[]
  ))];
  const records = computeSwissRecords(swissMatches, teamIds);

  const active = records.filter(r => r.wins < SWISS_ADVANCE_WINS && r.losses < SWISS_ELIMINATE_LOSSES);
  if (active.length === 0) return { error: "Swiss stage is complete — no active teams." };

  const inserts = generateSwissNextRoundInserts(records, currentRound + 1);
  if (!inserts.length) return { error: "Could not generate pairings for next round." };

  const { error } = await supabaseAdmin.from("matches").insert(inserts);
  if (error) return { error: error.message };
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
  const qualified = seedSwissQualifiers(records);
  if (qualified.length < 2) return { error: "Not enough Swiss qualifiers." };

  const seInserts = generateSEMatchInserts(qualified);
  const { error: insertError } = await supabaseAdmin.from("matches").insert(seInserts);
  if (insertError) return { error: insertError.message };

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

  // Rotate bottom half to vary cross-bracket matchups in Swiss R1
  const half = qualified.length / 2;
  const seeded = [...qualified.slice(0, half), ...qualified.slice(half + 1), qualified[half]];

  const inserts = generateSwissR1Inserts(seeded);
  const { error } = await supabaseAdmin.from("matches").insert(inserts);
  if (error) return { error: error.message };
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

  const qualified = [...wbSurvivors, ...lbSurvivors];
  if (qualified.length !== 16)
    return { error: `Expected 16 qualifier survivors, got ${qualified.length}.` };

  // Rotate bottom half to avoid same-bracket R1 rematches
  const half = qualified.length / 2;
  const seeded = [...qualified.slice(0, half), ...qualified.slice(half + 1), qualified[half]];

  const inserts = generateSwissR1Inserts(seeded);
  const { error } = await supabaseAdmin.from("matches").insert(inserts);
  if (error) return { error: error.message };
  return { ok: true };
}

// ── Main bracket builder ───────────────────────────────────────────────────────

export async function buildAndSaveBracket(): Promise<{ error?: string; ok?: boolean }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("season_format")
    .single();

  if (!settings?.season_format) return { error: "No season format configured." };

  // Wipe existing bracket matches
  await supabaseAdmin.from("matches").delete().not("stage", "is", null);

  // Seed teams: wins desc, then avg peak MMR desc
  const { data: teamsRaw } = await supabaseAdmin
    .from("teams").select("id, name, wins");

  if (!teamsRaw?.length) return { error: "No teams found." };
  if (teamsRaw.length < 2) return { error: "Need at least 2 teams to generate a bracket." };

  const { data: players } = await supabaseAdmin
    .from("players").select("team_id, peak_2v2, peak_3v3").not("team_id", "is", null);

  const avgMmr: Record<string, number> = {};
  teamsRaw.forEach((t) => {
    const roster = players?.filter((p) => p.team_id === t.id) ?? [];
    const sum = roster.reduce(
      (s, p) => s + Math.max(Number(p.peak_2v2) || 0, Number(p.peak_3v3) || 0), 0
    );
    avgMmr[t.id] = roster.length ? sum / roster.length : 0;
  });

  const seeded = [...teamsRaw].sort((a, b) => {
    const diff = (b.wins ?? 0) - (a.wins ?? 0);
    return diff !== 0 ? diff : (avgMmr[b.id] ?? 0) - (avgMmr[a.id] ?? 0);
  });

  const format = settings.season_format as SeasonFormatConfig | null;
  const isDE         = format?.preset === "double_elimination";
  const isGroup      = format?.preset === "group_single_elimination" || format?.preset === "group_swiss_single_elimination";
  const isSESwissSE  = format?.preset === "se_swiss_single_elimination";
  const isDESwissSE  = format?.preset === "de_swiss_single_elimination";

  if (isGroup) {
    return await buildGroupMatches(seeded, format!);
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
    return { ok: true };
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

    return { ok: true };
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

  return { ok: true };
}
