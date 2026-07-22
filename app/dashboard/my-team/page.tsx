import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { PlayerName } from "@/app/dashboard/player-name";
import { supabaseAdmin } from "@/app/lib/supabase";
import {
  getRoundName, getMatchLabel,
  DE_WINNERS, DE_LOSERS, DE_GF,
  getDEWBRounds, getDELBRounds,
  nextPow2,
  GROUP_STAGE_PREFIX, parseGroupNum,
} from "@/app/lib/bracket";
import { getBestOfForMatch } from "@/app/lib/discord-bot";
import { canonicalStage } from "@/app/dashboard/admin/schedule-utils";
import { MyTeamEditor } from "@/app/dashboard/teams/my-team-editor";
import {
  SubRequestPanel,
  type SubRosterPlayer,
  type AvailableSub,
  type SubRequestRow,
} from "@/app/dashboard/my-team/sub-request-panel";
import {
  OpposingSubRequestPanel,
  type IncomingSubRequest,
} from "@/app/dashboard/my-team/opposing-sub-request-panel";
import {
  MatchSchedulePanel,
  type SchedulableMatch,
} from "@/app/dashboard/my-team/match-schedule-panel";
import {
  SeriesReplayPanel,
  type SeriesTeamInfo,
} from "@/app/dashboard/my-team/series-replay-panel";
import {
  RecentResultsCarousel,
  type ResultEntry,
} from "@/app/dashboard/my-team/recent-results-carousel";

// ── Types ──────────────────────────────────────────────────────────────────────

type RosterPlayer = {
  id: string; username: string; display_name: string | null; discord_id: string; avatar: string | null;
  peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string;
  tracker_url: string; is_captain: boolean;
};

type BracketMatch = {
  id: string; round: number; match_number: number; stage: string;
  home_team_id: string | null; away_team_id: string | null;
  home_score: number | null; away_score: number | null; status: string;
  scheduled_at: string | null;
  pending_home_score: number | null;
  pending_away_score: number | null;
  score_submitted_by_team_id: string | null;
  score_confirmed: boolean;
  score_submitted_at: string | null;
};

type TeamRow = {
  id: string; name: string; logo_url: string | null;
  logo_offset_x: number; logo_offset_y: number; is_locked: boolean;
};

type MatchInfo = {
  label: string;
  roundName: string;
  sectionName: string;
  sectionColor: string;  // tailwind text color class
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function peakMmr(p: RosterPlayer) {
  return (Number(p.peak_2v2) + Number(p.current_2v2)) * 0.3 + (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.2;
}

// Swaps any subbed-out roster player for their approved substitute, so the "who's
// playing" list reflects the actual lineup instead of the static roster.
function mergeWithSubs(
  roster: { id: string; name: string; rv: number }[],
  approvedSubs: { player_out_id: string; sub_player_id: string | null }[],
  subDetails: Record<string, { name: string; rv: number }>,
): { id: string; name: string; rv: number }[] {
  const outIds = new Set(approvedSubs.map((r) => r.player_out_id));
  const subsIn = approvedSubs
    .filter((r) => r.sub_player_id && subDetails[r.sub_player_id])
    .map((r) => ({ id: r.sub_player_id as string, ...subDetails[r.sub_player_id as string] }));
  return [...roster.filter((p) => !outIds.has(p.id)), ...subsIn].sort((a, b) => b.rv - a.rv);
}

function lbRoundName(round: number, totalLBRounds: number): string {
  const fromEnd = totalLBRounds - round;
  if (fromEnd === 0) return "LB Finals";
  if (fromEnd === 1) return "LB Semis";
  if (fromEnd === 2) return "LB Quarters";
  return `LB Round ${round}`;
}

function getMatchInfo(m: BracketMatch, numR1WB: number, totalRoundsSE: number): MatchInfo {
  const size    = numR1WB * 2;
  const numWB   = size > 0 ? getDEWBRounds(size) : 0;
  const numLB   = size > 0 ? getDELBRounds(size) : 0;
  const numR1LB = size > 0 ? size / 4 : 0;

  if (m.stage === DE_WINNERS || m.stage === "deq_winners") {
    const label     = numR1WB > 0 ? `W-${getMatchLabel(m.round, m.match_number, numR1WB)}` : `WB R${m.round}`;
    const roundName = numWB > 0 ? getRoundName(numWB, m.round) : `Round ${m.round}`;
    return { label, roundName, sectionName: "Winners", sectionColor: "text-indigo-400" };
  }
  if (m.stage === DE_LOSERS || m.stage === "deq_losers") {
    const label     = numR1LB > 0 ? `L-${getMatchLabel(m.round, m.match_number, numR1LB)}` : `LB R${m.round}`;
    const roundName = numLB > 0 ? lbRoundName(m.round, numLB) : `Round ${m.round}`;
    return { label, roundName, sectionName: "Losers", sectionColor: "text-amber-400" };
  }
  if (m.stage === DE_GF) {
    const isReset = m.match_number === 2;
    return {
      label:        isReset ? "GF Reset" : "GF",
      roundName:    isReset ? "Grand Final Reset" : "Grand Final",
      sectionName:  "Grand Final",
      sectionColor: "text-yellow-400",
    };
  }
  if (m.stage === "swiss") {
    return {
      label:        `Swiss R${m.round}`,
      roundName:    `Round ${m.round}`,
      sectionName:  "Swiss",
      sectionColor: "text-cyan-400",
    };
  }
  if (m.stage === "se_qualifier") {
    return {
      label:        `Qual R${m.round}`,
      roundName:    `Round ${m.round}`,
      sectionName:  "Qualifier",
      sectionColor: "text-purple-400",
    };
  }
  // single_elimination — used directly or as the final stage in multi-stage formats
  const r1 = numR1WB > 0 ? numR1WB : 1;
  const seLabel = getMatchLabel(m.round, m.match_number, r1);
  return {
    label:        seLabel,
    roundName:    getRoundName(totalRoundsSE, m.round),
    sectionName:  "Bracket",
    sectionColor: "text-indigo-400",
  };
}

// Stage sort weight: earlier stages sort first (ascending = natural play order).
// Multi-stage formats (de_swiss_se, se_swiss_se) use sequential stages so their
// relative ordering here doesn't affect match finding, but explicit weights keep
// the display labels correct if matches from multiple stages ever coexist.
const STAGE_WEIGHT: Record<string, number> = {
  se_qualifier:       0,
  deq_winners:        0,
  deq_losers:         1,
  swiss:              2,
  single_elimination: 3,
  [DE_WINNERS]:       3,
  [DE_LOSERS]:        4,
  [DE_GF]:            5,
};

function sortAscending(a: BracketMatch, b: BracketMatch) {
  const aGroup = a.stage.startsWith(GROUP_STAGE_PREFIX);
  const bGroup = b.stage.startsWith(GROUP_STAGE_PREFIX);
  if (aGroup !== bGroup) return aGroup ? -1 : 1; // group before bracket
  if (aGroup && bGroup) {
    // sort by group number, then round, then match
    const gA = parseGroupNum(a.stage) ?? 0;
    const gB = parseGroupNum(b.stage) ?? 0;
    return gA !== gB ? gA - gB : a.round - b.round || a.match_number - b.match_number;
  }
  const sw = (STAGE_WEIGHT[a.stage] ?? 0) - (STAGE_WEIGHT[b.stage] ?? 0);
  return sw !== 0 ? sw : a.round - b.round || a.match_number - b.match_number;
}

function sortDescending(a: BracketMatch, b: BracketMatch) {
  return -sortAscending(a, b);
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function MyTeamPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const userIsAdmin = await isModerator(session.userId);

  const { data: player } = await supabaseAdmin
    .from("players").select("team_id").eq("discord_id", session.userId).single();
  if (!player?.team_id) redirect("/dashboard");
  const teamId: string = player.team_id;

  const [
    { data: teamRaw },
    { data: roster },
    { data: allTeamsRaw },
    { data: settings },
    { data: subRequestsRaw },
  ] = await Promise.all([
    supabaseAdmin.from("teams")
      .select("id, name, logo_url, logo_offset_x, logo_offset_y, is_locked").eq("id", teamId).single(),
    supabaseAdmin.from("players")
      .select("id, username, display_name, discord_id, avatar, peak_2v2, current_2v2, peak_3v3, current_3v3, tracker_url, is_captain")
      .eq("team_id", teamId).eq("status", "approved"),
    supabaseAdmin.from("teams").select("id, name, logo_url, logo_offset_x, logo_offset_y"),
    supabaseAdmin.from("league_settings")
      .select("season_active, season_format, num_teams, active_tournament_id").single(),
    supabaseAdmin.from("sub_requests")
      .select("id, match_id, player_out_id, sub_player_id, sub_player_ids, reason, status, admin_note, created_at")
      .eq("team_id", teamId).order("created_at", { ascending: false }),
  ]);

  const team = teamRaw as TeamRow | null;
  if (!team) redirect("/dashboard");

  const activeTournamentId = (settings?.active_tournament_id as string | null) ?? null;
  const seasonActive = settings?.season_active ?? false;
  const preset       = (settings?.season_format as { preset?: string })?.preset ?? "single_elimination";
  // isDE covers all formats that use a double-elimination bracket (full or qualifier)
  const isDE         = preset === "double_elimination" || preset === "de_swiss_single_elimination";
  const isDEQualifier = preset === "de_swiss_single_elimination";
  const allTeams     = (allTeamsRaw ?? []) as TeamRow[];
  const teamMap      = Object.fromEntries(allTeams.map((t) => [t.id, t]));

  const hasGroupStage = preset === "group_single_elimination" || preset === "group_swiss_single_elimination";

  // ── Match data (season active only) ───────────────────────────────────────
  let myMatches: BracketMatch[] = [];
  let numR1WB = 0; // R1 match count for the primary bracket (WB or SE)
  let numR1SE = 0; // R1 match count specifically for single_elimination stage

  if (seasonActive) {
    // All non-group bracket stages — covers every format (SE, DE, DE→Swiss→SE, etc.)
    // Note: combining .or() + .in() is broken in this Supabase version — the IN clause
    // silently returns zero rows when chained with OR. We fetch all matches and
    // deduplicate with the group-stage query in JS instead.
    const [
      { data: matchData },
      { count: r1Count },
      { data: groupMatchData },
      { count: seR1Count },
    ] = await Promise.all([
      supabaseAdmin
        .from("matches")
        .select("id, round, match_number, stage, home_team_id, away_team_id, home_score, away_score, status, scheduled_at, pending_home_score, pending_away_score, score_submitted_by_team_id, score_confirmed, score_submitted_at")
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`),
      // Primary bracket R1 count: deq_winners for DE qualifier formats, de_winners
      // for full DE, single_elimination for pure SE / group formats.
      supabaseAdmin
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("stage", isDEQualifier ? "deq_winners" : isDE ? DE_WINNERS : "single_elimination")
        .eq("round", 1),
      hasGroupStage
        ? supabaseAdmin
            .from("matches")
            .select("id, round, match_number, stage, home_team_id, away_team_id, home_score, away_score, status, scheduled_at")
            .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
            .like("stage", `${GROUP_STAGE_PREFIX}%`)
            .order("stage").order("round").order("match_number")
        : Promise.resolve({ data: [] as BracketMatch[] }),
      // SE R1 count separately so multi-stage formats show correct round names
      // once the SE phase is reached (e.g. de_swiss_se, se_swiss_se, group_se).
      supabaseAdmin
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("stage", "single_elimination")
        .eq("round", 1),
    ]);

    const allMatches   = (matchData ?? []) as BracketMatch[];
    const groupMatches = (groupMatchData ?? []) as BracketMatch[];
    // Deduplicate: group matches already included in allMatches for hasGroupStage formats
    const groupIds = new Set(groupMatches.map(m => m.id));
    const bracketMatches = allMatches.filter(m => !groupIds.has(m.id));
    myMatches = [...groupMatches, ...bracketMatches].sort(sortAscending);
    numR1WB   = r1Count ?? 0;
    numR1SE   = seR1Count ?? 0;
  }

  // Fetch schedule proposal state separately so a missing-column error never
  // breaks the main match display (Next Match, Recent Results).
  type ScheduleRow = { id: string; schedule_proposed_by_team_id: string | null; schedule_accepted: boolean; schedule_admin_required: boolean; admin_scheduled: boolean; home_checked_in: boolean; away_checked_in: boolean; checkin_deadline: string | null };
  const scheduleMap: Record<string, ScheduleRow> = {};
  const upcomingIds = myMatches
    .filter(m => m.home_score === null && m.home_team_id && m.away_team_id)
    .map(m => m.id);
  if (upcomingIds.length > 0) {
    const { data: scheduleRows } = await supabaseAdmin
      .from("matches")
      .select("id, schedule_proposed_by_team_id, schedule_accepted, schedule_admin_required, admin_scheduled, home_checked_in, away_checked_in, checkin_deadline")
      .in("id", upcomingIds);
    (scheduleRows ?? []).forEach((r: ScheduleRow) => { scheduleMap[r.id] = r; });
  }

  // SE round count — prefer the explicit SE count; fall back to the primary WB count
  // for pure-SE formats where both refer to the same stage.
  const r1ForSE       = numR1SE > 0 ? numR1SE : numR1WB;
  const totalRoundsSE = r1ForSE > 0 ? Math.round(Math.log2(r1ForSE)) + 1 : 1;

  const sortedRoster = [...((roster ?? []) as RosterPlayer[])].sort((a, b) => {
    if (a.is_captain !== b.is_captain) return a.is_captain ? -1 : 1;
    return peakMmr(b) - peakMmr(a);
  });

  const avgMmr = sortedRoster.length
    ? Math.round(sortedRoster.reduce((s, p) => s + peakMmr(p), 0) / sortedRoster.length)
    : 0;

  // Completed real matches (both teams + scores)
  const realCompleted = myMatches.filter(
    (m) => m.home_score !== null && m.away_score !== null
          && m.home_team_id !== null && m.away_team_id !== null
  );

  // Next unplayed match this team is in
  const nextMatch = myMatches.find(
    (m) => (m.home_team_id === teamId || m.away_team_id === teamId) && m.home_score === null
  ) ?? null;

  const bestOf = nextMatch ? await getBestOfForMatch(nextMatch.id) : 3;

  // Is the opponent ready to play us, or do they still have an earlier match to finish?
  // They're not ready if they have an unplayed match in an earlier round of this stage.
  let opponentNotReady = false;
  let opponentName: string | null = null;
  if (nextMatch) {
    const oppId = nextMatch.home_team_id === teamId ? nextMatch.away_team_id : nextMatch.home_team_id;
    opponentName = oppId ? (teamMap[oppId]?.name ?? null) : null;
    if (oppId) {
      const { count: oppEarlier } = await supabaseAdmin
        .from("matches")
        .select("*", { count: "exact", head: true })
        .eq("stage", nextMatch.stage)
        .lt("round", nextMatch.round)
        .is("home_score", null)
        .not("home_team_id", "is", null)
        .not("away_team_id", "is", null)
        .or(`home_team_id.eq.${oppId},away_team_id.eq.${oppId}`);
      opponentNotReady = (oppEarlier ?? 0) > 0;
    }
  }

  // ── Series replay panel data ───────────────────────────────────────────────
  let seriesHomeTeam: SeriesTeamInfo | null = null;
  let seriesAwayTeam: SeriesTeamInfo | null = null;

  if (seasonActive) {
    const myApprovedSubs = nextMatch
      ? ((subRequestsRaw ?? []) as { match_id: string | null; player_out_id: string; sub_player_id: string | null; status: string }[])
          .filter((r) => r.match_id === nextMatch.id && r.status === "approved")
      : [];
    const mySubIds = myApprovedSubs.map((r) => r.sub_player_id).filter((x): x is string => !!x);
    const { data: mySubPlayersRaw } = mySubIds.length
      ? await supabaseAdmin
          .from("players")
          .select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3")
          .in("id", mySubIds)
      : { data: [] as { id: string; username: string; display_name: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }[] };
    const mySubDetails = Object.fromEntries(
      (mySubPlayersRaw ?? []).map((p) => [p.id, { name: p.display_name ?? p.username, rv: peakMmrSub(p) }])
    );
    const myRosterForList = sortedRoster.map((p) => ({ id: p.id, name: p.display_name ?? p.username, rv: Math.round(peakMmr(p)) }));
    const myPlayingList = mergeWithSubs(myRosterForList, myApprovedSubs, mySubDetails);

    const mySeriesTeam: SeriesTeamInfo = {
      id: team.id, name: team.name, logo_url: team.logo_url,
      logo_offset_x: team.logo_offset_x, logo_offset_y: team.logo_offset_y, avgMmr,
      players: myPlayingList,
    };
    if (nextMatch) {
      const opponentId = nextMatch.home_team_id === teamId ? nextMatch.away_team_id : nextMatch.home_team_id;
      let opponentSeriesTeam: SeriesTeamInfo | null = null;
      if (opponentId) {
        const oppTeamData = teamMap[opponentId] ?? null;
        const { data: oppRoster } = await supabaseAdmin
          .from("players").select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3")
          .eq("team_id", opponentId).eq("status", "approved");
        const oppPlayers = (oppRoster ?? []) as { id: string; username: string; display_name: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }[];
        const oppAvgMmr = oppPlayers.length
          ? Math.round(oppPlayers.reduce((s, p) => s + (Number(p.peak_2v2) + Number(p.current_2v2)) * 0.3 + (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.2, 0) / oppPlayers.length)
          : 0;

        const { data: oppApprovedSubsRaw } = await supabaseAdmin
          .from("sub_requests")
          .select("player_out_id, sub_player_id")
          .eq("team_id", opponentId).eq("match_id", nextMatch.id).eq("status", "approved");
        const oppApprovedSubs = (oppApprovedSubsRaw ?? []) as { player_out_id: string; sub_player_id: string | null }[];
        const oppSubIds = oppApprovedSubs.map((r) => r.sub_player_id).filter((x): x is string => !!x);
        const { data: oppSubPlayersRaw } = oppSubIds.length
          ? await supabaseAdmin
              .from("players")
              .select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3")
              .in("id", oppSubIds)
          : { data: [] as typeof oppPlayers };
        const oppSubDetails = Object.fromEntries(
          (oppSubPlayersRaw ?? []).map((p) => [p.id, { name: p.display_name ?? p.username, rv: peakMmrSub(p) }])
        );
        const oppRosterForList = oppPlayers.map((p) => ({ id: p.id, name: p.display_name ?? p.username, rv: peakMmrSub(p) }));
        const oppPlayingList = mergeWithSubs(oppRosterForList, oppApprovedSubs, oppSubDetails);

        if (oppTeamData) {
          opponentSeriesTeam = {
            id: oppTeamData.id, name: oppTeamData.name, logo_url: oppTeamData.logo_url,
            logo_offset_x: oppTeamData.logo_offset_x, logo_offset_y: oppTeamData.logo_offset_y,
            avgMmr: oppAvgMmr, players: oppPlayingList,
          };
        }
      }
      seriesHomeTeam = nextMatch.home_team_id === teamId ? mySeriesTeam : opponentSeriesTeam;
      seriesAwayTeam = nextMatch.away_team_id === teamId ? mySeriesTeam : opponentSeriesTeam;
    }
  }

  const wins = realCompleted.filter((m) => {
    const mine   = m.home_team_id === teamId ? m.home_score : m.away_score;
    const theirs = m.home_team_id === teamId ? m.away_score : m.home_score;
    return (mine ?? 0) > (theirs ?? 0);
  }).length;

  const losses = realCompleted.filter((m) => {
    const mine   = m.home_team_id === teamId ? m.home_score : m.away_score;
    const theirs = m.home_team_id === teamId ? m.away_score : m.home_score;
    return (mine ?? 0) < (theirs ?? 0);
  }).length;

  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : null;

  // Check if this team won the tournament
  const wonTournament = realCompleted.some((m) => {
    const isFinal = m.stage === DE_GF || (m.stage === "single_elimination" && m.round === totalRoundsSE);
    if (!isFinal) return false;
    const mine = m.home_team_id === teamId ? m.home_score : m.away_score;
    const theirs = m.home_team_id === teamId ? m.away_score : m.home_score;
    return (mine ?? 0) > (theirs ?? 0);
  });

  const isEliminated = seasonActive && !wonTournament && nextMatch === null;

  const form = [...realCompleted]
    .sort(sortDescending)
    .slice(0, 5)
    .map((m) => {
      const mine   = m.home_team_id === teamId ? m.home_score : m.away_score;
      const theirs = m.home_team_id === teamId ? m.away_score : m.home_score;
      if (mine === null || theirs === null) return null;
      return mine > theirs ? "W" : "L";
    })
    .filter(Boolean) as ("W" | "L")[];

  // ── Sub request data ────────────────────────────────────────────────────────

  const rosterMap = Object.fromEntries(
    ((roster ?? []) as RosterPlayer[]).map((p) => [p.id, p])
  );

  type RawSubReq = {
    id: string; match_id: string | null; player_out_id: string;
    sub_player_id: string | null; sub_player_ids: string[] | null;
    reason: string | null; status: string; admin_note: string | null; created_at: string;
  };

  const allSubCandidateIds = [
    ...new Set(
      ((subRequestsRaw ?? []) as RawSubReq[]).flatMap((r) => {
        if (r.sub_player_ids && r.sub_player_ids.length > 0) return r.sub_player_ids;
        if (r.sub_player_id) return [r.sub_player_id];
        return [];
      })
    ),
  ];

  const { data: subPlayersRaw } = allSubCandidateIds.length > 0
    ? await supabaseAdmin
        .from("players")
        .select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3")
        .in("id", allSubCandidateIds)
    : { data: [] as { id: string; username: string; display_name: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }[] };

  const subPlayerMap = Object.fromEntries(
    (subPlayersRaw ?? []).map((p) => [p.id, p])
  );

  function peakMmrSub(p: { peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }) {
    return Math.round((Number(p.peak_2v2) + Number(p.current_2v2)) * 0.3 + (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.2);
  }

  // Admin-set round schedules define the allowed scheduling window per round.
  const { data: roundScheduleRows } = seasonActive
    ? await (activeTournamentId
        ? supabaseAdmin.from("round_schedules").select("stage, round, schedule_type, play_at, deadline_at, range_days").eq("tournament_id", activeTournamentId)
        : supabaseAdmin.from("round_schedules").select("stage, round, schedule_type, play_at, deadline_at, range_days").is("tournament_id", null))
    : { data: [] as { stage: string; round: number; schedule_type: string; play_at: string; deadline_at: string; range_days: number | null }[] };
  const adminScheduleByRound: Record<string, { type: string; playAt: string; deadlineAt: string; rangeDays: number | null }> = {};
  for (const s of roundScheduleRows ?? []) {
    adminScheduleByRound[`${s.stage}:${s.round}`] = {
      type: s.schedule_type as string,
      playAt: s.play_at as string,
      deadlineAt: s.deadline_at as string,
      rangeDays: s.range_days as number | null,
    };
  }

  const schedulableMatches: SchedulableMatch[] = seasonActive
    ? myMatches
        .filter((m) => m.home_score === null && m.home_team_id && m.away_team_id)
        .map((m) => {
          const opponentId = m.home_team_id === teamId ? m.away_team_id : m.home_team_id;
          const opponent   = opponentId ? teamMap[opponentId] : null;
          let roundLabel: string;
          if (m.stage.startsWith(GROUP_STAGE_PREFIX)) {
            const g = parseGroupNum(m.stage);
            roundLabel = `Group ${g ?? "?"} · Round ${m.round}`;
          } else if (m.stage === DE_WINNERS) {
            roundLabel = `Winners · Round ${m.round}`;
          } else if (m.stage === DE_LOSERS) {
            roundLabel = `Losers · Round ${m.round}`;
          } else if (m.stage === DE_GF) {
            roundLabel = m.match_number === 2 ? "Grand Final Reset" : "Grand Final";
          } else {
            roundLabel = getRoundName(totalRoundsSE, m.round) || `Round ${m.round}`;
          }
          const sd = scheduleMap[m.id];
          const adminSched = adminScheduleByRound[`${canonicalStage(m.stage)}:${m.round}`] ?? null;
          const isHome = m.home_team_id === teamId;
          return {
            id:              m.id,
            opponentName:    opponent?.name ?? "TBD",
            opponentId,
            opponentLogoUrl: opponent?.logo_url ?? null,
            roundLabel,
            scheduledAt:     m.scheduled_at,
            proposedByTeamId: sd?.schedule_proposed_by_team_id ?? null,
            scheduleAccepted: sd?.schedule_accepted ?? false,
            scheduleAdminRequired: sd?.schedule_admin_required ?? false,
            adminPinned:     sd?.admin_scheduled ?? false,
            adminScheduleType: (adminSched?.type as "range" | "specific" | undefined) ?? null,
            adminPlayAt:     adminSched?.playAt ?? null,
            adminDeadlineAt: adminSched?.deadlineAt ?? null,
            adminRangeDays:  adminSched?.rangeDays ?? null,
            isTournament:    !!activeTournamentId,
            checkinDeadline: sd?.checkin_deadline ?? null,
            iCheckedIn:      isHome ? !!sd?.home_checked_in : !!sd?.away_checked_in,
            oppCheckedIn:    isHome ? !!sd?.away_checked_in : !!sd?.home_checked_in,
            isHome,
          };
        })
    : [];

  const existingSubRequests: SubRequestRow[] = (
    (subRequestsRaw ?? []) as RawSubReq[]
  ).map((req) => {
    const playerOut    = rosterMap[req.player_out_id];
    const candidateIds = (req.sub_player_ids && req.sub_player_ids.length > 0)
      ? req.sub_player_ids
      : (req.sub_player_id ? [req.sub_player_id] : []);
    const subCandidates = candidateIds
      .map((id) => subPlayerMap[id])
      .filter(Boolean)
      .map((p) => ({ username: p.username, displayName: p.display_name ?? null, mmr: peakMmrSub(p) }));
    const match = myMatches.find((m) => m.id === req.match_id);
    let matchLabel: string | null = null;
    let opponentName: string | null = null;
    if (match) {
      const opponentId = match.home_team_id === teamId ? match.away_team_id : match.home_team_id;
      const opponent   = opponentId ? teamMap[opponentId] : null;
      opponentName = opponent?.name ?? null;
      matchLabel = `vs ${opponent?.name ?? "TBD"}`;
    }
    return {
      id:            req.id,
      matchLabel,
      opponentName,
      playerOutName: playerOut?.username ?? "Unknown",
      playerOutDisplay: playerOut?.display_name ?? null,
      playerOutMmr:  playerOut ? peakMmrSub(playerOut) : 0,
      subCandidates,
      reason:        req.reason,
      status:        req.status as SubRequestRow["status"],
      adminNote:     req.admin_note,
      createdAt:     req.created_at,
    };
  });

  // Incoming sub requests: pending requests from our upcoming opponent (we accept/reject).
  const myMatchIds = myMatches.map((m) => m.id);
  let incomingSubRequests: IncomingSubRequest[] = [];
  if (!activeTournamentId && myMatchIds.length > 0) {
    const { data: incomingRaw } = await supabaseAdmin
      .from("sub_requests")
      .select("id, team_id, match_id, player_out_id, sub_player_id, reason, created_at")
      .in("match_id", myMatchIds)
      .neq("team_id", teamId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    const ids = [
      ...new Set(
        ((incomingRaw ?? []) as { player_out_id: string; sub_player_id: string | null }[])
          .flatMap((r) => [r.player_out_id, r.sub_player_id].filter((x): x is string => !!x)),
      ),
    ];
    const { data: incPlayers } = ids.length
      ? await supabaseAdmin
          .from("players")
          .select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3")
          .in("id", ids)
      : { data: [] as { id: string; username: string; display_name: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }[] };
    const incPlayerMap = Object.fromEntries((incPlayers ?? []).map((p) => [p.id, p]));

    incomingSubRequests = ((incomingRaw ?? []) as {
      id: string; team_id: string; match_id: string | null; player_out_id: string; sub_player_id: string | null; reason: string | null; created_at: string;
    }[]).map((r) => {
      const out = incPlayerMap[r.player_out_id];
      const sub = r.sub_player_id ? incPlayerMap[r.sub_player_id] : null;
      return {
        id: r.id,
        requestingTeamName: teamMap[r.team_id]?.name ?? "A team",
        playerOutName: out?.username ?? "Unknown",
        playerOutDisplay: out?.display_name ?? null,
        playerOutMmr: out ? peakMmrSub(out) : 0,
        subName: sub?.username ?? null,
        subDisplay: sub?.display_name ?? null,
        subMmr: sub ? peakMmrSub(sub) : null,
        reason: r.reason,
        createdAt: r.created_at,
      };
    });
  }

  const nextMatchOpponentId  = nextMatch
    ? (nextMatch.home_team_id === teamId ? nextMatch.away_team_id : nextMatch.home_team_id)
    : null;

  let availableSubs: AvailableSub[] = [];
  if (!activeTournamentId) {
    const { data: subsRaw } = await supabaseAdmin
      .from("players")
      .select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3, team_id, draft_entered")
      .eq("status", "approved")
      .eq("sub_willing", true);

    // Must have entered the draft OR be on a team this season.
    availableSubs = (
      (subsRaw ?? []) as {
        id: string; username: string; display_name: string | null;
        peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string; team_id: string | null; draft_entered: boolean;
      }[]
    )
      .filter((p) => {
        if (p.team_id === teamId) return false;
        if (nextMatchOpponentId && p.team_id === nextMatchOpponentId) return false;
        return p.draft_entered || p.team_id !== null;
      })
      .map(({ id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3 }) => ({ id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3 }));
  }

  const subRoster: SubRosterPlayer[] = ((roster ?? []) as RosterPlayer[]).map((p) => ({
    id: p.id, username: p.username, display_name: p.display_name ?? null,
    peak_2v2: p.peak_2v2, current_2v2: p.current_2v2, peak_3v3: p.peak_3v3, current_3v3: p.current_3v3,
  }));

  // ── Recent results for carousel ──────────────────────────────────────────
  const recentResults: ResultEntry[] = [...realCompleted].sort(sortDescending).map((m) => {
    const isHome     = m.home_team_id === teamId;
    const opponentId = isHome ? m.away_team_id : m.home_team_id;
    const opponent   = opponentId ? teamMap[opponentId] : null;
    const myScore    = isHome ? m.home_score : m.away_score;
    const theirScore = isHome ? m.away_score : m.home_score;
    const won        = (myScore ?? 0) > (theirScore ?? 0);
    let stageLabel: string;
    if (m.stage.startsWith(GROUP_STAGE_PREFIX)) {
      const g = parseGroupNum(m.stage);
      stageLabel = `Group ${g ?? "?"} · Round ${m.round}`;
    } else {
      const info = getMatchInfo(m, numR1WB, totalRoundsSE);
      stageLabel = `${info.sectionName}${info.roundName ? ` · ${info.roundName}` : ""}`;
    }
    return {
      id: m.id, won,
      opponentName: opponent?.name ?? "Unknown",
      myScore: myScore ?? 0,
      theirScore: theirScore ?? 0,
      stageLabel,
    };
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">

      {/* ── Team hero ── */}
      <div className="flex items-center gap-4 sm:gap-6 min-w-0">
        <TeamLogo team={team} size="lg" />
        <div className="space-y-2 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-white truncate" title={team.name}>{team.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {seasonActive && (
              <>
                <RecordBadge wins={wins} losses={losses} />
                {winRate !== null && <span className="text-zinc-400">{winRate}% WR</span>}
                {wonTournament && (
                  <span className="text-xs font-bold text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">
                    CHAMPIONS
                  </span>
                )}
              </>
            )}
            {avgMmr > 0 && <span className="text-zinc-400">avg {avgMmr.toLocaleString()} RV</span>}
          </div>
          {seasonActive && form.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-600 mr-1">Form</span>
              {form.map((r, i) => (
                <span key={i} className={`text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center ${
                  r === "W" ? "bg-emerald-700/50 text-emerald-300" : "bg-red-800/50 text-red-300"
                }`}>{r}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Roster + Recent Results */}
        <div className="lg:col-span-2 space-y-6">
          <Card title="Roster">
            <div className="divide-y divide-zinc-800">
              {sortedRoster.length === 0 ? (
                <p className="px-5 py-4 text-sm text-zinc-500">No players on this team yet.</p>
              ) : sortedRoster.map((p) => (
                <a key={p.id} href={p.tracker_url || undefined} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/40 transition-colors group">
                  {p.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`https://cdn.discordapp.com/avatars/${p.discord_id}/${p.avatar}.png`}
                      alt="" width={36} height={36} className="w-9 h-9 rounded-full shrink-0" />
                  ) : <div className="w-9 h-9 rounded-full bg-zinc-700 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors min-w-0">
                        <PlayerName displayName={p.display_name ?? null} username={p.username} />
                      </span>
                      {p.is_captain && (
                        <span className="text-[10px] font-bold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
                          CAPTAIN
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-zinc-600 mb-0.5">RV</p>
                    <p className="text-sm font-mono text-zinc-300">{Math.round((Number(p.peak_2v2) + Number(p.current_2v2)) * 0.3 + (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.2).toLocaleString()}</p>
                  </div>
                </a>
              ))}
            </div>
          </Card>

          <Card title="Recent Results">
            {!seasonActive ? (
              <p className="px-5 py-4 text-sm text-zinc-500">Season hasn&apos;t started yet.</p>
            ) : (
              <RecentResultsCarousel results={recentResults} />
            )}
          </Card>

          {/* Match Schedule (with private-match lobby info) — hidden while waiting on the opponent */}
          {schedulableMatches.length > 0 && !opponentNotReady && (
            <MatchSchedulePanel
              matches={schedulableMatches.slice(0, 1)}
              teamId={teamId}
            />
          )}
        </div>

        {/* Schedule + Results */}
        <div className="space-y-6">

          {/* Team editor */}
          <MyTeamEditor
            team={team}
            isAdmin={userIsAdmin}
            seasonActive={seasonActive}
            label="Team Settings"
          />

          {/* Next Match */}
          <Card title="Next Match">
            {!seasonActive ? (
              <p className="px-5 py-4 text-sm text-zinc-500">Season hasn&apos;t started yet.</p>
            ) : wonTournament ? (
              <p className="px-5 py-4 text-sm text-yellow-400 font-medium">Your team won the tournament!</p>
            ) : !nextMatch ? (
              <p className="px-5 py-4 text-sm text-zinc-500">
                {losses > 0 ? "Eliminated from the bracket." : "No match scheduled yet."}
              </p>
            ) : (() => {
              const opponentId = nextMatch.home_team_id === teamId ? nextMatch.away_team_id : nextMatch.home_team_id;
              const opponent   = opponentId ? teamMap[opponentId] : null;

              // Group stage match
              if (nextMatch.stage.startsWith(GROUP_STAGE_PREFIX)) {
                const groupNum = parseGroupNum(nextMatch.stage);
                return (
                  <div className="px-5 py-4 space-y-3">
                    <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide">
                      Group {groupNum} · Round {nextMatch.round}
                    </p>
                    <div className="flex items-center gap-3">
                      <TeamLogo team={opponent ?? null} size="sm" />
                      <div>
                        <p className="text-sm font-semibold text-white">{opponent?.name ?? "TBD"}</p>
                        {!opponent && <p className="text-xs text-zinc-500">Waiting for opponent</p>}
                      </div>
                    </div>
                  </div>
                );
              }

              // All bracket stages — route through getMatchInfo which handles every stage name
              const info = getMatchInfo(nextMatch, numR1WB, totalRoundsSE);
              return (
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${info.sectionColor}`}>
                      {info.sectionName}
                    </span>
                    {info.label && (
                      <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5">
                        {info.label}
                      </span>
                    )}
                    {info.roundName && (
                      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                        {info.roundName}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <TeamLogo team={opponent ?? null} size="sm" />
                    <div>
                      <p className="text-sm font-semibold text-white">{opponent?.name ?? "TBD"}</p>
                      {!opponent && <p className="text-xs text-zinc-500">Waiting for opponent</p>}
                    </div>
                  </div>
                </div>
              );
            })()}
          </Card>

          {/* Sub panels are season-only — tournaments don't allow substitutions */}
          {!activeTournamentId && (
            <>
              <OpposingSubRequestPanel requests={incomingSubRequests} />
              {nextMatch && (
                <SubRequestPanel
                  teamId={teamId}
                  roster={subRoster}
                  availableSubs={availableSubs}
                  existingRequests={existingSubRequests}
                />
              )}
            </>
          )}

        </div>
      </div>

      {/* ── Score Confirmation ── */}
      {seasonActive && !isEliminated && (
        <SeriesReplayPanel
          matchId={nextMatch?.id ?? null}
          homeTeam={seriesHomeTeam}
          awayTeam={seriesAwayTeam}
          bestOf={bestOf}
          myTeamId={teamId}
          pendingHomeScore={nextMatch?.pending_home_score ?? null}
          pendingAwayScore={nextMatch?.pending_away_score ?? null}
          scoreSubmittedByTeamId={nextMatch?.score_submitted_by_team_id ?? null}
          scoreConfirmed={nextMatch?.score_confirmed ?? false}
          scoreSubmittedAt={nextMatch?.score_submitted_at ?? null}
          opponentNotReady={opponentNotReady}
          opponentName={opponentName}
        />
      )}

      {/* ── Group Stage Schedule ── */}
      {seasonActive && hasGroupStage && (() => {
        const groupMatches = myMatches.filter(m => m.stage.startsWith(GROUP_STAGE_PREFIX));
        if (!groupMatches.length) return null;

        const groupNum = parseGroupNum(groupMatches[0].stage);

        const byRound = new Map<number, BracketMatch[]>();
        for (const m of groupMatches) {
          if (!byRound.has(m.round)) byRound.set(m.round, []);
          byRound.get(m.round)!.push(m);
        }
        const rounds = [...byRound.entries()].sort(([a], [b]) => a - b);

        const allGroupMatches = rounds.flatMap(([round, matches]) =>
          matches.map(m => ({ round, m }))
        );

        return (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-300">Group Stage Schedule</h2>
              {groupNum && (
                <span className="text-[10px] font-semibold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">
                  Group {groupNum}
                </span>
              )}
            </div>
            <div className="divide-y divide-zinc-800/50">
              {allGroupMatches.map(({ round, m }) => {
                const isHome     = m.home_team_id === teamId;
                const opponentId = isHome ? m.away_team_id : m.home_team_id;
                const opponent   = opponentId ? teamMap[opponentId] : null;
                const done       = m.status === "completed";
                const myScore    = isHome ? m.home_score : m.away_score;
                const theirScore = isHome ? m.away_score : m.home_score;
                const won        = done && (myScore ?? 0) > (theirScore ?? 0);
                return (
                  <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="text-[10px] font-semibold text-zinc-500 w-14 shrink-0">
                      Round {round}
                    </span>
                    <span className="flex-1 text-sm text-zinc-300 truncate">
                      {opponent?.name ?? "TBD"}
                    </span>
                    {done && myScore !== null && theirScore !== null ? (
                      <span className={`text-xs font-mono font-semibold shrink-0 tabular-nums ${
                        won ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {myScore} – {theirScore}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-600 shrink-0">vs</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function RecordBadge({ wins, losses }: { wins: number; losses: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1 text-sm font-semibold">
      <span className="text-emerald-400">{wins}W</span>
      <span className="text-zinc-600">–</span>
      <span className="text-red-400">{losses}L</span>
    </span>
  );
}

function TeamLogo({
  team, size,
}: {
  team: { name: string; logo_url: string | null; logo_offset_x?: number; logo_offset_y?: number } | null;
  size: "sm" | "lg";
}) {
  const dim      = size === "lg" ? "w-16 h-16" : "w-10 h-10";
  const textSize = size === "lg" ? "text-2xl" : "text-sm";
  const gradients = [
    "from-indigo-600 to-indigo-800", "from-rose-600 to-rose-800",
    "from-emerald-600 to-emerald-800", "from-amber-600 to-amber-800",
    "from-cyan-600 to-cyan-800", "from-purple-600 to-purple-800",
    "from-orange-600 to-orange-800", "from-teal-600 to-teal-800",
  ];
  if (!team) return <div className={`${dim} rounded-xl bg-zinc-800 shrink-0`} />;
  if (team.logo_url) {
    const ox = team.logo_offset_x ?? 50;
    const oy = team.logo_offset_y ?? 50;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={team.logo_url} alt={team.name}
        className={`${dim} rounded-xl object-cover shrink-0`}
        style={{ objectPosition: `${ox}% ${oy}%` }} />
    );
  }
  const num = parseInt(team.name.replace(/\D+/g, "") || "1");
  const g   = gradients[(num - 1) % gradients.length];
  return (
    <div className={`${dim} rounded-xl bg-gradient-to-br ${g} flex items-center justify-center ${textSize} font-bold text-white shrink-0`}>
      {num}
    </div>
  );
}
