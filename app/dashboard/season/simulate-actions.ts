"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isDirector } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { cleanupStageCategoryIfComplete, openReadyMatchChannels } from "@/app/lib/discord-bot";
import { deleteChannel } from "@/app/lib/discord-api";
import {
  DE_WINNERS, DE_LOSERS, DE_GF,
  getDEWBRounds, getDELBRounds,
  wbLoserTarget, lbWinnerTarget,
  nextPow2,
  GROUP_STAGE_PREFIX,
  SWISS_STAGE,
  SE_QUALIFIER,
  DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS,
  HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF,
  HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF,
} from "@/app/lib/bracket";

async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirector(session.userId))) redirect("/dashboard");
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
  // Find all scheduled group matches ordered by round first so simulation proceeds
  // round-by-round across all groups, matching real production pacing (all groups
  // play round 1 before any group plays round 2).
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, home_team_id, away_team_id, stage")
    .like("stage", `${GROUP_STAGE_PREFIX}%`)
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null)
    .is("home_score", null)
    .order("round", { ascending: true })
    .order("stage", { ascending: true })
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

// ── Hybrid helpers ────────────────────────────────────────────────────────────

async function getReadyHybridMatches(stage: string) {
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

async function simulateHybridSingleMatch(match: {
  id: string; round: number; match_number: number; stage: string;
  home_team_id: string; away_team_id: string;
}) {
  const homeWins  = Math.random() > 0.5;
  const winScore  = 4; // simulated as BO7 regardless of configured bestOf, same simplification as every other stage here
  const loseScore = Math.floor(Math.random() * 4);

  await supabaseAdmin.from("matches")
    .update({
      home_score: homeWins ? winScore : loseScore,
      away_score: homeWins ? loseScore : winScore,
      status: "completed",
    })
    .eq("id", match.id);

  const winnerId = homeWins ? match.home_team_id : match.away_team_id;
  const loserId  = homeWins ? match.away_team_id : match.home_team_id;

  if (match.stage === HYBRID_UB) {
    // Winner → SF home; loser → LB R3 away
    await setMatchSlot(HYBRID_SF, 1, match.match_number, "home_team_id", winnerId);
    await setMatchSlot(HYBRID_LB, 3, match.match_number, "away_team_id", loserId);
  } else if (match.stage === HYBRID_LB) {
    if (match.round === 1) {
      const nm   = Math.ceil(match.match_number / 2);
      const slot = match.match_number % 2 === 1 ? "home_team_id" : "away_team_id";
      await setMatchSlot(HYBRID_LB, 2, nm, slot, winnerId);
    } else if (match.round === 2) {
      await setMatchSlot(HYBRID_LB, 3, match.match_number, "home_team_id", winnerId);
    } else if (match.round === 3) {
      await setMatchSlot(HYBRID_SF, 1, match.match_number, "away_team_id", winnerId);
    }
  } else if (match.stage === HYBRID_SF) {
    const slot = match.match_number === 1 ? "home_team_id" : "away_team_id";
    await setMatchSlot(HYBRID_GF, 1, 1, slot, winnerId);
  }
  // HYBRID_GF: winner is champion, no further routing
}

async function simulateHybrid8SingleMatch(match: {
  id: string; round: number; match_number: number; stage: string;
  home_team_id: string; away_team_id: string;
}) {
  const homeWins  = Math.random() > 0.5;
  const winScore  = 4; // simulated as BO7 regardless of configured bestOf, same simplification as every other stage here
  const loseScore = Math.floor(Math.random() * 4);

  await supabaseAdmin.from("matches")
    .update({
      home_score: homeWins ? winScore : loseScore,
      away_score: homeWins ? loseScore : winScore,
      status: "completed",
    })
    .eq("id", match.id);

  const winnerId = homeWins ? match.home_team_id : match.away_team_id;
  const loserId  = homeWins ? match.away_team_id : match.home_team_id;

  if (match.stage === HYBRID8_UB) {
    await setMatchSlot(HYBRID8_SF, 1, match.match_number, "home_team_id", winnerId);
    await setMatchSlot(HYBRID8_LB, 2, match.match_number, "away_team_id", loserId);
  } else if (match.stage === HYBRID8_LB) {
    if (match.round === 1) {
      await setMatchSlot(HYBRID8_LB, 2, match.match_number, "home_team_id", winnerId);
    } else if (match.round === 2) {
      await setMatchSlot(HYBRID8_SF, 1, match.match_number, "away_team_id", winnerId);
    }
  } else if (match.stage === HYBRID8_SF) {
    const slot = match.match_number === 1 ? "home_team_id" : "away_team_id";
    await setMatchSlot(HYBRID8_GF, 1, 1, slot, winnerId);
  }
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
  let simulatedId: string | null = null;

  // Group stage first
  if (!simulatedId) {
    const groupReady = await getReadyGroupMatches();
    if (groupReady.length) {
      await simulateGroupSingleMatch(groupReady[0] as Parameters<typeof simulateGroupSingleMatch>[0]);
      simulatedId = groupReady[0].id;
    }
  }

  // SE Qualifier (before Swiss)
  if (!simulatedId) {
    const seqReady = await getReadySEQualifierMatches();
    if (seqReady.length) {
      await simulateSingleMatch(seqReady[0] as Parameters<typeof simulateSingleMatch>[0]);
      simulatedId = seqReady[0].id;
    }
  }

  // DE Qualifier (before Swiss)
  if (!simulatedId) {
    const deqSizes = await getDEQSizes();
    if (deqSizes) {
      for (const stage of [DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS]) {
        const ready = await getReadyDEQualifierMatches(stage);
        if (ready.length) {
          await simulateDEQualifierSingleMatch(ready[0] as Parameters<typeof simulateDEQualifierSingleMatch>[0], deqSizes);
          simulatedId = ready[0].id;
          break;
        }
      }
    }
  }

  // Swiss
  if (!simulatedId) {
    const swissReady = await getReadySwissMatches();
    if (swissReady.length) {
      await simulateSwissSingleMatch(swissReady[0] as Parameters<typeof simulateSwissSingleMatch>[0]);
      simulatedId = swissReady[0].id;
    }
  }

  // Hybrid (UB → LB → SF → GF order)
  if (!simulatedId) {
    for (const stage of [HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF]) {
      const ready = await getReadyHybridMatches(stage);
      if (ready.length) {
        await simulateHybridSingleMatch(ready[0] as Parameters<typeof simulateHybridSingleMatch>[0]);
        simulatedId = ready[0].id;
        break;
      }
    }
  }

  // Hybrid8 (UB → LB → SF → GF order)
  if (!simulatedId) {
    for (const stage of [HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF]) {
      const ready = await getReadyHybridMatches(stage);
      if (ready.length) {
        await simulateHybrid8SingleMatch(ready[0] as Parameters<typeof simulateHybrid8SingleMatch>[0]);
        simulatedId = ready[0].id;
        break;
      }
    }
  }

  // SE
  if (!simulatedId) {
    const seReady = await getReadyMatches();
    if (seReady.length) {
      await simulateSingleMatch(seReady[0] as Parameters<typeof simulateSingleMatch>[0]);
      simulatedId = seReady[0].id;
    }
  }

  // DE (respect schedule order instead of hardcoded stage sequence)
  if (!simulatedId) {
    const sizes = await getDESizes();
    if (sizes) {
      // Fetch all ready DE matches across all stages
      const [wbReady, lbReady, gfReady] = await Promise.all([
        getReadyDEMatches(DE_WINNERS),
        getReadyDEMatches(DE_LOSERS),
        getReadyDEMatches(DE_GF),
      ]);
      const allDEReady = [...wbReady, ...lbReady, ...gfReady];
      if (allDEReady.length) {
        // Fetch schedules to sort by time
        const { data: schedules } = await supabaseAdmin
          .from("round_schedules")
          .select("stage, round, play_at")
          .in("stage", [DE_WINNERS, DE_LOSERS, DE_GF]);

        const scheduleMap = new Map<string, string>();
        for (const s of schedules ?? []) {
          scheduleMap.set(`${s.stage}:${s.round}`, s.play_at as string);
        }

        // Sort by schedule time; if no schedule, use Infinity to push to end
        const sorted = allDEReady.sort((a, b) => {
          const aKey = `${a.stage}:${a.round}`;
          const bKey = `${b.stage}:${b.round}`;
          const aTime = scheduleMap.has(aKey) ? new Date(scheduleMap.get(aKey)!).getTime() : Infinity;
          const bTime = scheduleMap.has(bKey) ? new Date(scheduleMap.get(bKey)!).getTime() : Infinity;
          return aTime - bTime;
        });

        // Simulate the earliest match
        await simulateDESingleMatch(sorted[0] as Parameters<typeof simulateDESingleMatch>[0], sizes);
        simulatedId = sorted[0].id;
      }
    }
  }

  if (!simulatedId) return { error: "No matches ready to simulate." };

  await deleteChannelsForBatch([simulatedId]);
  revalidatePath("/dashboard/season");
  return { ok: true };
}

// After simulating matches, reconcile Discord the same way a real report does: delete
// each simulated match's own channel immediately (like execReportMatchResult), delete
// the category for any round that's now fully complete, then open channels for the
// next ready matches. The schedule deadline gate is bypassed here — simulate is a
// testing tool and shouldn't require waiting out real-world round windows the way
// real player-reported matches do.
async function deleteChannelsForBatch(matchIds: string[]): Promise<void> {
  if (matchIds.length) {
    const { data: ms } = await supabaseAdmin
      .from("matches").select("id, stage, round, discord_channel_id").in("id", matchIds);
    for (const m of ms ?? []) {
      if (m.discord_channel_id) {
        await deleteChannel(m.discord_channel_id);
        await supabaseAdmin.from("matches").update({ discord_channel_id: null }).eq("id", m.id);
      }
    }
    const pairs = new Set((ms ?? []).map((m) => `${m.stage} ${m.round}`));
    for (const p of pairs) {
      const [stage, round] = p.split(" ");
      await cleanupStageCategoryIfComplete(stage, Number(round));
    }
  }
  await openReadyMatchChannels({ ignoreScheduleDeadline: true });
}

export async function simulateRound(): Promise<{ error?: string; ok?: boolean }> {
  await verifyAdmin();

  // Group stage: simulate the current round across ALL groups at once
  const groupReady = await getReadyGroupMatches();
  if (groupReady.length) {
    const minRound = Math.min(...groupReady.map(m => m.round));
    const batch = groupReady.filter((m) => m.round === minRound);
    for (const m of batch) await simulateGroupSingleMatch(m as Parameters<typeof simulateGroupSingleMatch>[0]);
    await deleteChannelsForBatch(batch.map(m => m.id));
    revalidatePath("/dashboard/season");
    return { ok: true };
  }

  // SE Qualifier: simulate current round
  const seqReady2 = await getReadySEQualifierMatches();
  if (seqReady2.length) {
    const currentRound = seqReady2[0].round;
    const batch = seqReady2.filter(m => m.round === currentRound);
    for (const m of batch) await simulateSingleMatch(m as Parameters<typeof simulateSingleMatch>[0]);
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
    for (const m of batch) await simulateSwissSingleMatch(m as Parameters<typeof simulateSwissSingleMatch>[0]);
    await deleteChannelsForBatch(batch.map(m => m.id));
    revalidatePath("/dashboard/season");
    return { ok: true };
  }

  // Hybrid: simulate one stage's current round per call
  for (const stage of [HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF]) {
    const ready = await getReadyHybridMatches(stage);
    if (ready.length) {
      const round = ready[0].round;
      const batch = ready.filter(m => m.round === round);
      for (const match of batch) {
        await simulateHybridSingleMatch(match as Parameters<typeof simulateHybridSingleMatch>[0]);
      }
      await deleteChannelsForBatch(batch.map(m => m.id));
      revalidatePath("/dashboard/season");
      return { ok: true };
    }
  }

  // Hybrid8: simulate one stage's current round per call
  for (const stage of [HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF]) {
    const ready = await getReadyHybridMatches(stage);
    if (ready.length) {
      const round = ready[0].round;
      const batch = ready.filter(m => m.round === round);
      for (const match of batch) {
        await simulateHybrid8SingleMatch(match as Parameters<typeof simulateHybrid8SingleMatch>[0]);
      }
      await deleteChannelsForBatch(batch.map(m => m.id));
      revalidatePath("/dashboard/season");
      return { ok: true };
    }
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
