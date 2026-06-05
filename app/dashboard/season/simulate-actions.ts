"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isAdmin } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getGuildChannels, deleteChannel } from "@/app/lib/discord-api";
import {
  DE_WINNERS, DE_LOSERS, DE_GF,
  getDEWBRounds, getDELBRounds,
  wbLoserTarget, lbWinnerTarget,
  nextPow2,
  GROUP_STAGE_PREFIX,
  SWISS_STAGE,
  SE_QUALIFIER,
  DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS,
} from "@/app/lib/bracket";

async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");
}

async function simulateSingleMatch(match: {
  id: string; round: number; match_number: number;
  home_team_id: string; away_team_id: string; stage: string;
}) {
  const homeWins = Math.random() > 0.5;
  const winnerScore = Math.floor(Math.random() * 2) + 3; // 3 or 4
  const loserScore = Math.floor(Math.random() * 3);       // 0, 1, or 2
  const homeScore = homeWins ? winnerScore : loserScore;
  const awayScore = homeWins ? loserScore : winnerScore;

  await supabaseAdmin.from("matches")
    .update({ home_score: homeScore, away_score: awayScore, status: "completed" })
    .eq("id", match.id);

  const winnerId = homeWins ? match.home_team_id : match.away_team_id;
  const nr = match.round + 1;
  const nm = Math.ceil(match.match_number / 2);
  const slot = match.match_number % 2 === 1 ? "home_team_id" : "away_team_id";

  const { data: nextMatch } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id")
    .eq("stage", match.stage)
    .eq("round", nr)
    .eq("match_number", nm)
    .maybeSingle();

  if (nextMatch) {
    const other = slot === "home_team_id" ? nextMatch.away_team_id : nextMatch.home_team_id;
    await supabaseAdmin.from("matches")
      .update({ [slot]: winnerId, ...(other ? { status: "scheduled" } : {}) })
      .eq("id", nextMatch.id);
  }
}

// ── Group stage helpers ───────────────────────────────────────────────────────

async function getReadyGroupMatches() {
  // Find all scheduled group matches ordered by group then round
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, home_team_id, away_team_id, stage")
    .like("stage", `${GROUP_STAGE_PREFIX}%`)
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null)
    .is("home_score", null)
    .order("stage", { ascending: true })
    .order("round", { ascending: true })
    .order("match_number", { ascending: true });
  return data ?? [];
}

async function simulateGroupSingleMatch(match: {
  id: string; round: number; match_number: number;
  home_team_id: string; away_team_id: string; stage: string;
}) {
  const homeWins  = Math.random() > 0.5;
  const winScore  = 3;                              // BO5: first to 3
  const loseScore = Math.floor(Math.random() * 3); // 0, 1, or 2
  await supabaseAdmin.from("matches")
    .update({
      home_score: homeWins ? winScore : loseScore,
      away_score: homeWins ? loseScore : winScore,
      status: "completed",
    })
    .eq("id", match.id);
}

// ── Swiss helpers ─────────────────────────────────────────────────────────────

async function getReadySwissMatches() {
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, home_team_id, away_team_id, stage")
    .eq("stage", SWISS_STAGE)
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null)
    .is("home_score", null)
    .order("round", { ascending: true })
    .order("match_number", { ascending: true });
  return data ?? [];
}

async function simulateSwissSingleMatch(match: {
  id: string; home_team_id: string; away_team_id: string;
}) {
  const homeWins = Math.random() > 0.5;
  const winScore  = 3;                               // BO5: first to 3
  const loseScore = Math.floor(Math.random() * 3);  // 0, 1, or 2
  await supabaseAdmin.from("matches")
    .update({
      home_score: homeWins ? winScore : loseScore,
      away_score: homeWins ? loseScore : winScore,
      status: "completed",
    })
    .eq("id", match.id);
}

// ── SE Qualifier helper ───────────────────────────────────────────────────────

async function getReadySEQualifierMatches() {
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, home_team_id, away_team_id, stage")
    .eq("stage", SE_QUALIFIER)
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null)
    .is("home_score", null)
    .order("round", { ascending: true })
    .order("match_number", { ascending: true });
  return data ?? [];
}

// ── DE Qualifier helpers ──────────────────────────────────────────────────────

async function getDEQSizes() {
  const [{ data: wb }, { data: lb }] = await Promise.all([
    supabaseAdmin.from("matches").select("round, match_number").eq("stage", DE_QUALIFIER_WINNERS),
    supabaseAdmin.from("matches").select("round").eq("stage", DE_QUALIFIER_LOSERS),
  ]);
  if (!wb?.length) return null;
  const numWBQ  = Math.max(...wb.map(m => m.round));
  const numLBQ  = lb?.length ? Math.max(...lb.map(m => m.round)) : 0;
  const numR1WB = wb.filter(m => m.round === 1).length;
  return { numWBQ, numLBQ, size: numR1WB * 2 };
}

async function getReadyDEQualifierMatches(stage: string) {
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, home_team_id, away_team_id, stage")
    .eq("stage", stage)
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null)
    .is("home_score", null)
    .order("round", { ascending: true })
    .order("match_number", { ascending: true });
  return data ?? [];
}

async function willDEQLBSlotArrive(lbRound: number, lbMatchNum: number, slot: "home" | "away"): Promise<boolean> {
  if (lbRound === 1) {
    const wbMatchNum = slot === "home" ? 2 * lbMatchNum - 1 : 2 * lbMatchNum;
    const { data: wb } = await supabaseAdmin
      .from("matches").select("status, away_team_id")
      .eq("stage", DE_QUALIFIER_WINNERS).eq("round", 1).eq("match_number", wbMatchNum)
      .maybeSingle();
    return !(wb?.status === "completed" && !wb.away_team_id);
  }
  if (lbRound % 2 === 0) {
    if (slot === "away") return true;
    const { data: prev } = await supabaseAdmin
      .from("matches").select("status, home_team_id, away_team_id")
      .eq("stage", DE_QUALIFIER_LOSERS).eq("round", lbRound - 1).eq("match_number", lbMatchNum)
      .maybeSingle();
    return !(prev?.status === "completed" && !prev.home_team_id && !prev.away_team_id);
  }
  const prevMatchNum = slot === "home" ? 2 * lbMatchNum - 1 : 2 * lbMatchNum;
  const { data: prev } = await supabaseAdmin
    .from("matches").select("status, home_team_id, away_team_id")
    .eq("stage", DE_QUALIFIER_LOSERS).eq("round", lbRound - 1).eq("match_number", prevMatchNum)
    .maybeSingle();
  return !(prev?.status === "completed" && !prev.home_team_id && !prev.away_team_id);
}

async function checkAndAutoCompleteDEQLBMatch(
  lbRound: number, lbMatchNum: number,
  sizes: { numWBQ: number; numLBQ: number; size: number },
) {
  const { data: m } = await supabaseAdmin
    .from("matches").select("id, home_team_id, away_team_id, status")
    .eq("stage", DE_QUALIFIER_LOSERS).eq("round", lbRound).eq("match_number", lbMatchNum)
    .maybeSingle();

  if (!m || m.status === "completed") return;
  const hasHome = !!m.home_team_id;
  const hasAway = !!m.away_team_id;
  if (hasHome && hasAway) return;
  if (!hasHome && !hasAway) return;

  const emptyIsHome = !hasHome;
  const arriving = await willDEQLBSlotArrive(lbRound, lbMatchNum, emptyIsHome ? "home" : "away");
  if (arriving) return;

  const winnerId = (hasHome ? m.home_team_id : m.away_team_id)!;
  await supabaseAdmin.from("matches")
    .update({ home_score: 1, away_score: 0, status: "completed" }).eq("id", m.id);

  if (lbRound < sizes.numLBQ) {
    const target = lbWinnerTarget(lbRound, lbMatchNum, sizes.numLBQ);
    if (target.section === "losers") {
      await setMatchSlot(DE_QUALIFIER_LOSERS, target.round, target.matchNum, target.slot, winnerId);
      await checkAndAutoCompleteDEQLBMatch(target.round, target.matchNum, sizes);
    }
  }
  // lbRound === numLBQ: winner is a qualifier survivor, no further routing
}

async function simulateDEQualifierSingleMatch(
  match: { id: string; round: number; match_number: number; stage: string; home_team_id: string; away_team_id: string },
  sizes: { numWBQ: number; numLBQ: number; size: number },
) {
  const homeWins  = Math.random() > 0.5;
  const winScore  = Math.floor(Math.random() * 2) + 3;
  const loseScore = Math.floor(Math.random() * 3);

  await supabaseAdmin.from("matches")
    .update({
      home_score: homeWins ? winScore : loseScore,
      away_score: homeWins ? loseScore : winScore,
      status: "completed",
    })
    .eq("id", match.id);

  const winnerId = homeWins ? match.home_team_id : match.away_team_id;
  const loserId  = homeWins ? match.away_team_id : match.home_team_id;

  if (match.stage === DE_QUALIFIER_WINNERS) {
    if (match.round < sizes.numWBQ) {
      const nm   = Math.ceil(match.match_number / 2);
      const slot = match.match_number % 2 === 1 ? "home_team_id" : "away_team_id";
      await setMatchSlot(DE_QUALIFIER_WINNERS, match.round + 1, nm, slot, winnerId);
    }
    // Last WB round: winner is a qualifier survivor, no further routing

    const { lbRound, lbMatchNum, slot } = wbLoserTarget(match.round, match.match_number);
    await setMatchSlot(DE_QUALIFIER_LOSERS, lbRound, lbMatchNum, slot, loserId);
    await checkAndAutoCompleteDEQLBMatch(lbRound, lbMatchNum, sizes);
  }

  if (match.stage === DE_QUALIFIER_LOSERS && match.round < sizes.numLBQ) {
    const target = lbWinnerTarget(match.round, match.match_number, sizes.numLBQ);
    if (target.section === "losers") {
      await setMatchSlot(DE_QUALIFIER_LOSERS, target.round, target.matchNum, target.slot, winnerId);
    }
    // target.section === "grand_final" only when lbRound === numLBQ, caught by outer guard
  }
  // Last LB round: winner is a qualifier survivor, no further routing
}

// ── SE helper ─────────────────────────────────────────────────────────────────

async function getReadyMatches() {
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, home_team_id, away_team_id, stage")
    .eq("stage", "single_elimination")
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null)
    .is("home_score", null)
    .order("round", { ascending: true })
    .order("match_number", { ascending: true });
  return data ?? [];
}

// ── DE helpers ────────────────────────────────────────────────────────────────

async function getDESizes() {
  const { data } = await supabaseAdmin.from("league_settings").select("num_teams").single();
  const n = data?.num_teams ?? 0;
  if (!n) return null;
  const size = nextPow2(n);
  return { size, numWB: getDEWBRounds(size), numLB: getDELBRounds(size) };
}

async function setMatchSlot(stage: string, round: number, matchNum: number, slot: string, teamId: string) {
  const { data: m } = await supabaseAdmin
    .from("matches").select("id, home_team_id, away_team_id")
    .eq("stage", stage).eq("round", round).eq("match_number", matchNum)
    .maybeSingle();
  if (!m) return;
  const other = slot === "home_team_id" ? m.away_team_id : m.home_team_id;
  await supabaseAdmin.from("matches")
    .update({ [slot]: teamId, ...(other ? { status: "scheduled" } : {}) })
    .eq("id", m.id);
}

// Returns false if the given slot in an LB match will NEVER receive a team
// (because the upstream source was a WB bye or a ghost LB match with no teams).
async function willLBSlotArrive(lbRound: number, lbMatchNum: number, slot: "home" | "away"): Promise<boolean> {
  if (lbRound === 1) {
    // home ← loser of WB R1 M(2m-1), away ← loser of WB R1 M(2m)
    const wbMatchNum = slot === "home" ? 2 * lbMatchNum - 1 : 2 * lbMatchNum;
    const { data: wb } = await supabaseAdmin
      .from("matches").select("status, away_team_id")
      .eq("stage", DE_WINNERS).eq("round", 1).eq("match_number", wbMatchNum)
      .maybeSingle();
    // A WB bye has status=completed and no away team (no real opponent existed)
    return !(wb?.status === "completed" && !wb.away_team_id);
  }

  if (lbRound % 2 === 0) {
    // Drop round: away ← WB loser (always arrives eventually), home ← prev LB winner
    if (slot === "away") return true;
    const { data: prev } = await supabaseAdmin
      .from("matches").select("status, home_team_id, away_team_id")
      .eq("stage", DE_LOSERS).eq("round", lbRound - 1).eq("match_number", lbMatchNum)
      .maybeSingle();
    // Ghost: completed but both team slots null (no team ever played here)
    return !(prev?.status === "completed" && !prev.home_team_id && !prev.away_team_id);
  }

  // Odd consolidation round (r > 1): home ← LB R(r-1) M(2m-1), away ← LB R(r-1) M(2m)
  const prevMatchNum = slot === "home" ? 2 * lbMatchNum - 1 : 2 * lbMatchNum;
  const { data: prev } = await supabaseAdmin
    .from("matches").select("status, home_team_id, away_team_id")
    .eq("stage", DE_LOSERS).eq("round", lbRound - 1).eq("match_number", prevMatchNum)
    .maybeSingle();
  return !(prev?.status === "completed" && !prev.home_team_id && !prev.away_team_id);
}

// After a team lands in an LB match, auto-complete it as a bye if the other slot
// will never be filled, then recursively propagate through the LB.
async function checkAndAutoCompleteLBMatch(
  lbRound: number, lbMatchNum: number,
  sizes: { numWB: number; numLB: number; size: number },
) {
  const { data: m } = await supabaseAdmin
    .from("matches").select("id, home_team_id, away_team_id, status")
    .eq("stage", DE_LOSERS).eq("round", lbRound).eq("match_number", lbMatchNum)
    .maybeSingle();

  if (!m || m.status === "completed") return;

  const hasHome = !!m.home_team_id;
  const hasAway = !!m.away_team_id;
  if (hasHome && hasAway) return; // real match — leave it
  if (!hasHome && !hasAway) return; // no teams yet — nothing to do

  const emptyIsHome = !hasHome;
  const arriving = await willLBSlotArrive(lbRound, lbMatchNum, emptyIsHome ? "home" : "away");
  if (arriving) return; // the other team is still en route

  // The other slot will never be filled → auto-complete as a bye
  const winnerId = (hasHome ? m.home_team_id : m.away_team_id)!;
  await supabaseAdmin.from("matches")
    .update({ home_score: 1, away_score: 0, status: "completed" })
    .eq("id", m.id);

  const target = lbWinnerTarget(lbRound, lbMatchNum, sizes.numLB);
  if (target.section === "grand_final") {
    await setMatchSlot(DE_GF, 1, 1, "away_team_id", winnerId);
  } else {
    await setMatchSlot(DE_LOSERS, target.round, target.matchNum, target.slot, winnerId);
    await checkAndAutoCompleteLBMatch(target.round, target.matchNum, sizes);
  }
}

async function simulateDESingleMatch(match: {
  id: string; round: number; match_number: number; stage: string;
  home_team_id: string; away_team_id: string;
}, sizes: { numWB: number; numLB: number; size: number }) {
  const homeWins   = Math.random() > 0.5;
  const winScore   = Math.floor(Math.random() * 2) + 3;
  const loseScore  = Math.floor(Math.random() * 3);
  const homeScore  = homeWins ? winScore : loseScore;
  const awayScore  = homeWins ? loseScore : winScore;

  await supabaseAdmin.from("matches")
    .update({ home_score: homeScore, away_score: awayScore, status: "completed" })
    .eq("id", match.id);

  const winnerId = homeWins ? match.home_team_id : match.away_team_id;
  const loserId  = homeWins ? match.away_team_id : match.home_team_id;

  if (match.stage === DE_WINNERS) {
    // Advance winner in WB (or to GF if this is WB Finals)
    if (match.round < sizes.numWB) {
      const nr   = match.round + 1;
      const nm   = Math.ceil(match.match_number / 2);
      const slot = match.match_number % 2 === 1 ? "home_team_id" : "away_team_id";
      await setMatchSlot(DE_WINNERS, nr, nm, slot, winnerId);
    } else {
      await setMatchSlot(DE_GF, 1, 1, "home_team_id", winnerId);
    }
    // Drop loser to LB, then auto-complete the LB match as a bye if its other slot
    // will never be filled (because that slot's source was a WB bye or ghost LB match).
    const { lbRound, lbMatchNum, slot } = wbLoserTarget(match.round, match.match_number);
    await setMatchSlot(DE_LOSERS, lbRound, lbMatchNum, slot, loserId);
    await checkAndAutoCompleteLBMatch(lbRound, lbMatchNum, sizes);
  }

  if (match.stage === DE_LOSERS) {
    const target = lbWinnerTarget(match.round, match.match_number, sizes.numLB);
    if (target.section === "grand_final") {
      await setMatchSlot(DE_GF, 1, 1, "away_team_id", winnerId);
    } else {
      await setMatchSlot(target.section === "losers" ? DE_LOSERS : DE_GF, target.round, target.matchNum, target.slot, winnerId);
    }
    // Loser eliminated — no further action
  }

  if (match.stage === DE_GF && match.match_number === 1) {
    // home = WB team (never lost), away = LB team (lost once)
    if (!homeWins) {
      // LB team wins — bracket reset: same teams fight again
      await supabaseAdmin.from("matches")
        .update({ home_team_id: match.home_team_id, away_team_id: match.away_team_id, status: "scheduled" })
        .eq("stage", DE_GF).eq("match_number", 2);
    }
    // If WB team wins: GF M2 stays pending/inactive — season over
  }
  // GF M2 (reset): winner is champion, no routing needed
}

async function getReadyDEMatches(stage: string) {
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, home_team_id, away_team_id, stage")
    .eq("stage", stage)
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null)
    .is("home_score", null)
    .order("round", { ascending: true })
    .order("match_number", { ascending: true });
  return data ?? [];
}

export async function simulateMatch(): Promise<{ error?: string; ok?: boolean }> {
  await verifyAdmin();

  // Group stage first
  const groupReady = await getReadyGroupMatches();
  if (groupReady.length) {
    await simulateGroupSingleMatch(groupReady[0] as Parameters<typeof simulateGroupSingleMatch>[0]);
    revalidatePath("/dashboard/season");
    return { ok: true };
  }

  // SE Qualifier (before Swiss)
  const seqReady = await getReadySEQualifierMatches();
  if (seqReady.length) {
    await simulateSingleMatch(seqReady[0] as Parameters<typeof simulateSingleMatch>[0]);
    revalidatePath("/dashboard/season");
    return { ok: true };
  }

  // DE Qualifier (before Swiss)
  const deqSizes = await getDEQSizes();
  if (deqSizes) {
    for (const stage of [DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS]) {
      const ready = await getReadyDEQualifierMatches(stage);
      if (ready.length) {
        await simulateDEQualifierSingleMatch(
          ready[0] as Parameters<typeof simulateDEQualifierSingleMatch>[0], deqSizes
        );
        revalidatePath("/dashboard/season");
        return { ok: true };
      }
    }
  }

  // Swiss
  const swissReady = await getReadySwissMatches();
  if (swissReady.length) {
    await simulateSwissSingleMatch(swissReady[0] as Parameters<typeof simulateSwissSingleMatch>[0]);
    revalidatePath("/dashboard/season");
    return { ok: true };
  }

  // SE
  const seReady = await getReadyMatches();
  if (seReady.length) {
    await simulateSingleMatch(seReady[0] as Parameters<typeof simulateSingleMatch>[0]);
    revalidatePath("/dashboard/season");
    return { ok: true };
  }

  // DE (WB → LB → GF order)
  const sizes = await getDESizes();
  if (sizes) {
    for (const stage of [DE_WINNERS, DE_LOSERS, DE_GF]) {
      const ready = await getReadyDEMatches(stage);
      if (ready.length) {
        await simulateDESingleMatch(ready[0] as Parameters<typeof simulateDESingleMatch>[0], sizes);
        revalidatePath("/dashboard/season");
        return { ok: true };
      }
    }
  }

  return { error: "No matches ready to simulate." };
}

async function deleteChannelsForBatch(matchIds: string[]): Promise<void> {
  if (!matchIds.length) return;
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("match_category_id").single();
  const categoryId = settings?.match_category_id;
  if (!categoryId) return;

  const [{ data: matches }, channels] = await Promise.all([
    supabaseAdmin.from("matches").select("home_team_id, away_team_id").in("id", matchIds),
    getGuildChannels(),
  ]);
  if (!matches?.length) return;

  const teamIds = [...new Set(matches.flatMap(m => [m.home_team_id, m.away_team_id].filter(Boolean) as string[]))];
  const { data: teams } = await supabaseAdmin.from("teams").select("id, name").in("id", teamIds);
  const nameById: Record<string, string> = {};
  teams?.forEach(t => { nameById[t.id] = t.name; });

  for (const m of matches) {
    const home = nameById[m.home_team_id];
    const away = nameById[m.away_team_id];
    if (!home || !away) continue;
    const channelName = `${home}-vs-${away}`
      .toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 100);
    const ch = channels.find(c => c.name === channelName && c.parent_id === categoryId);
    if (ch) await deleteChannel(ch.id);
  }
}

export async function simulateRound(): Promise<{ error?: string; ok?: boolean }> {
  await verifyAdmin();

  // Group stage: simulate all matches in the current round across all groups
  const groupReady = await getReadyGroupMatches();
  if (groupReady.length) {
    const { stage: fStage, round: fRound } = groupReady[0];
    const batch = groupReady.filter((m) => m.stage === fStage && m.round === fRound);
    await Promise.all(batch.map((m) => simulateGroupSingleMatch(m as Parameters<typeof simulateGroupSingleMatch>[0])));
    await deleteChannelsForBatch(batch.map(m => m.id));
    revalidatePath("/dashboard/season");
    return { ok: true };
  }

  // SE Qualifier: simulate current round
  const seqReady2 = await getReadySEQualifierMatches();
  if (seqReady2.length) {
    const currentRound = seqReady2[0].round;
    const batch = seqReady2.filter(m => m.round === currentRound);
    await Promise.all(batch.map(m => simulateSingleMatch(m as Parameters<typeof simulateSingleMatch>[0])));
    await deleteChannelsForBatch(batch.map(m => m.id));
    revalidatePath("/dashboard/season");
    return { ok: true };
  }

  // DE Qualifier: simulate current round across WB and LB
  const deqSizes2 = await getDEQSizes();
  if (deqSizes2) {
    const simulatedIds: string[] = [];
    for (const stage of [DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS]) {
      const ready = await getReadyDEQualifierMatches(stage);
      if (ready.length) {
        const round = ready[0].round;
        for (const match of ready.filter(m => m.round === round)) {
          await simulateDEQualifierSingleMatch(match as Parameters<typeof simulateDEQualifierSingleMatch>[0], deqSizes2);
          simulatedIds.push(match.id);
        }
      }
    }
    if (simulatedIds.length > 0) {
      await deleteChannelsForBatch(simulatedIds);
      revalidatePath("/dashboard/season");
      return { ok: true };
    }
  }

  // Swiss: simulate the whole current round
  const swissReady2 = await getReadySwissMatches();
  if (swissReady2.length) {
    const currentRound = swissReady2[0].round;
    const batch = swissReady2.filter(m => m.round === currentRound);
    await Promise.all(batch.map(m => simulateSwissSingleMatch(m as Parameters<typeof simulateSwissSingleMatch>[0])));
    await deleteChannelsForBatch(batch.map(m => m.id));
    revalidatePath("/dashboard/season");
    return { ok: true };
  }

  // SE
  const seReady = await getReadyMatches();
  if (seReady.length) {
    const currentRound = seReady[0].round;
    const batch = seReady.filter((m) => m.round === currentRound);
    for (const match of batch) {
      await simulateSingleMatch(match as Parameters<typeof simulateSingleMatch>[0]);
    }
    await deleteChannelsForBatch(batch.map(m => m.id));
    revalidatePath("/dashboard/season");
    return { ok: true };
  }

  // DE: simulate one stage's current round per call — stop after the first stage
  // with ready matches so WB losers don't immediately trigger LB in the same call.
  const sizes = await getDESizes();
  if (sizes) {
    const simulatedIds: string[] = [];
    for (const stage of [DE_WINNERS, DE_LOSERS, DE_GF]) {
      const ready = await getReadyDEMatches(stage);
      if (ready.length) {
        const round = ready[0].round;
        for (const match of ready.filter((m) => m.round === round)) {
          await simulateDESingleMatch(match as Parameters<typeof simulateDESingleMatch>[0], sizes);
          simulatedIds.push(match.id);
        }
        break;
      }
    }
    if (simulatedIds.length > 0) {
      await deleteChannelsForBatch(simulatedIds);
      revalidatePath("/dashboard/season");
      return { ok: true };
    }
  }

  return { error: "No matches ready to simulate." };
}
