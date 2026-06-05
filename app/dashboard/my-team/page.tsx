import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isAdmin } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import {
  getRoundName, getMatchLabel,
  DE_WINNERS, DE_LOSERS, DE_GF,
  getDEWBRounds, getDELBRounds,
  nextPow2,
  GROUP_STAGE_PREFIX, parseGroupNum,
} from "@/app/lib/bracket";
import { MyTeamEditor } from "@/app/dashboard/teams/my-team-editor";
import {
  SubRequestPanel,
  type SubRosterPlayer,
  type AvailableSub,
  type MatchOption,
  type SubRequestRow,
} from "@/app/dashboard/my-team/sub-request-panel";
import {
  MatchSchedulePanel,
  type SchedulableMatch,
} from "@/app/dashboard/my-team/match-schedule-panel";

// ── Types ──────────────────────────────────────────────────────────────────────

type RosterPlayer = {
  id: string; username: string; discord_id: string; avatar: string | null;
  peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string;
  tracker_url: string; is_captain: boolean;
};

type BracketMatch = {
  id: string; round: number; match_number: number; stage: string;
  home_team_id: string | null; away_team_id: string | null;
  home_score: number | null; away_score: number | null; status: string;
  scheduled_at: string | null;
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
  return Math.max(Number(p.peak_2v2) || 0, Number(p.peak_3v3) || 0);
}

function lbRoundName(round: number, totalLBRounds: number): string {
  const fromEnd = totalLBRounds - round;
  if (fromEnd === 0) return "LB Finals";
  if (fromEnd === 1) return "LB Semis";
  if (fromEnd === 2) return "LB Quarters";
  return `LB Round ${round}`;
}

function getMatchInfo(m: BracketMatch, numR1WB: number): MatchInfo {
  const size       = numR1WB * 2;
  const numWB      = getDEWBRounds(size);
  const numLB      = getDELBRounds(size);
  const numR1LB    = size / 4;

  if (m.stage === DE_WINNERS) {
    return {
      label:        `W-${getMatchLabel(m.round, m.match_number, numR1WB)}`,
      roundName:    getRoundName(numWB, m.round),
      sectionName:  "Winners",
      sectionColor: "text-indigo-400",
    };
  }
  if (m.stage === DE_LOSERS) {
    return {
      label:        `L-${getMatchLabel(m.round, m.match_number, numR1LB)}`,
      roundName:    lbRoundName(m.round, numLB),
      sectionName:  "Losers",
      sectionColor: "text-amber-400",
    };
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
  // SE fallback
  return {
    label:        "",
    roundName:    "",
    sectionName:  "Bracket",
    sectionColor: "text-indigo-400",
  };
}

// Stage sort weight: WB < LB < GF (ascending = natural play order)
const STAGE_WEIGHT: Record<string, number> = {
  single_elimination: 0,
  [DE_WINNERS]:       0,
  [DE_LOSERS]:        1,
  [DE_GF]:            2,
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

  const userIsAdmin = isAdmin(session.userId);

  const { data: player } = await supabaseAdmin
    .from("players").select("team_id").eq("discord_id", session.userId).single();
  if (!player?.team_id) redirect("/dashboard");
  const teamId: string = player.team_id;

  const [
    { data: teamRaw },
    { data: roster },
    { data: allTeamsRaw },
    { data: settings },
    { data: availableSubsRaw },
    { data: subRequestsRaw },
  ] = await Promise.all([
    supabaseAdmin.from("teams")
      .select("id, name, logo_url, logo_offset_x, logo_offset_y, is_locked").eq("id", teamId).single(),
    supabaseAdmin.from("players")
      .select("id, username, discord_id, avatar, peak_2v2, current_2v2, peak_3v3, current_3v3, tracker_url, is_captain")
      .eq("team_id", teamId).eq("status", "approved"),
    supabaseAdmin.from("teams").select("id, name, logo_url, logo_offset_x, logo_offset_y"),
    supabaseAdmin.from("league_settings")
      .select("season_active, season_format, num_teams").single(),
    supabaseAdmin.from("players")
      .select("id, username, peak_2v2, peak_3v3")
      .eq("status", "approved").is("team_id", null),
    supabaseAdmin.from("sub_requests")
      .select("id, match_id, player_out_id, sub_player_id, reason, status, admin_note, created_at")
      .eq("team_id", teamId).order("created_at", { ascending: false }),
  ]);

  const team = teamRaw as TeamRow | null;
  if (!team) redirect("/dashboard");

  const seasonActive = settings?.season_active ?? false;
  const preset       = (settings?.season_format as { preset?: string })?.preset ?? "single_elimination";
  const isDE         = preset === "double_elimination";
  const allTeams     = (allTeamsRaw ?? []) as TeamRow[];
  const teamMap      = Object.fromEntries(allTeams.map((t) => [t.id, t]));

  const hasGroupStage = preset === "group_single_elimination" || preset === "group_swiss_single_elimination";

  // ── Match data (season active only) ───────────────────────────────────────
  let myMatches: BracketMatch[] = [];
  let numR1WB = 0;

  if (seasonActive) {
    const bracketStages = isDE
      ? [DE_WINNERS, DE_LOSERS, DE_GF]
      : ["single_elimination"];

    const [
      { data: matchData },
      { count: r1Count },
      { data: groupMatchData },
    ] = await Promise.all([
      supabaseAdmin
        .from("matches")
        .select("id, round, match_number, stage, home_team_id, away_team_id, home_score, away_score, status, scheduled_at")
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .in("stage", bracketStages),
      supabaseAdmin
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("stage", isDE ? DE_WINNERS : "single_elimination")
        .eq("round", 1),
      hasGroupStage
        ? supabaseAdmin
            .from("matches")
            .select("id, round, match_number, stage, home_team_id, away_team_id, home_score, away_score, status, scheduled_at")
            .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
            .like("stage", `${GROUP_STAGE_PREFIX}%`)
            .order("stage").order("round").order("match_number")
        : Promise.resolve({ data: [] as BracketMatch[] }),
    ]);

    const bracketMatches = (matchData ?? []) as BracketMatch[];
    const groupMatches   = (groupMatchData ?? []) as BracketMatch[];
    myMatches = [...groupMatches, ...bracketMatches].sort(sortAscending);
    numR1WB   = r1Count ?? 0;
  }

  // Fetch schedule proposal state separately so a missing-column error never
  // breaks the main match display (Next Match, Recent Results).
  type ScheduleRow = { id: string; schedule_proposed_by_team_id: string | null; schedule_accepted: boolean };
  const scheduleMap: Record<string, ScheduleRow> = {};
  const upcomingIds = myMatches
    .filter(m => m.home_score === null && m.home_team_id && m.away_team_id)
    .map(m => m.id);
  if (upcomingIds.length > 0) {
    const { data: scheduleRows } = await supabaseAdmin
      .from("matches")
      .select("id, schedule_proposed_by_team_id, schedule_accepted")
      .in("id", upcomingIds);
    (scheduleRows ?? []).forEach((r: ScheduleRow) => { scheduleMap[r.id] = r; });
  }

  // SE-specific derived values
  const totalRoundsSE = numR1WB > 0 ? Math.round(Math.log2(numR1WB)) + 1 : 1;

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

  const userIsCaptain = (roster ?? []).some(
    (p) => p.discord_id === session.userId && p.is_captain
  ) || userIsAdmin;

  const rosterMap = Object.fromEntries(
    ((roster ?? []) as RosterPlayer[]).map((p) => [p.id, p])
  );

  const subPlayerIds = [
    ...new Set(
      ((subRequestsRaw ?? []) as { sub_player_id: string | null }[])
        .map((r) => r.sub_player_id)
        .filter((id): id is string => id !== null)
    ),
  ];

  const { data: subPlayersRaw } = subPlayerIds.length > 0
    ? await supabaseAdmin
        .from("players")
        .select("id, username, peak_2v2, peak_3v3")
        .in("id", subPlayerIds)
    : { data: [] as { id: string; username: string; peak_2v2: string; peak_3v3: string }[] };

  const subPlayerMap = Object.fromEntries(
    (subPlayersRaw ?? []).map((p) => [p.id, p])
  );

  function peakMmrSub(p: { peak_2v2: string; peak_3v3: string }) {
    return Math.max(Number(p.peak_2v2) || 0, Number(p.peak_3v3) || 0);
  }

  const upcomingMatchOptions: MatchOption[] = myMatches
    .filter((m) => m.home_score === null)
    .map((m) => {
      const opponentId = m.home_team_id === teamId ? m.away_team_id : m.home_team_id;
      const opponent   = opponentId ? teamMap[opponentId] : null;
      return { id: m.id, label: opponent ? `vs ${opponent.name}` : "TBD" };
    });

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
          return {
            id:              m.id,
            opponentName:    opponent?.name ?? "TBD",
            opponentId,
            roundLabel,
            scheduledAt:     m.scheduled_at,
            proposedByTeamId: sd?.schedule_proposed_by_team_id ?? null,
            scheduleAccepted: sd?.schedule_accepted ?? false,
          };
        })
    : [];

  const existingSubRequests: SubRequestRow[] = (
    (subRequestsRaw ?? []) as {
      id: string; match_id: string | null; player_out_id: string; sub_player_id: string | null;
      reason: string | null; status: string; admin_note: string | null; created_at: string;
    }[]
  ).map((req) => {
    const playerOut = rosterMap[req.player_out_id];
    const subPlayer = req.sub_player_id ? subPlayerMap[req.sub_player_id] : null;
    const match     = myMatches.find((m) => m.id === req.match_id);
    let matchLabel: string | null = null;
    if (match) {
      const opponentId = match.home_team_id === teamId ? match.away_team_id : match.home_team_id;
      const opponent   = opponentId ? teamMap[opponentId] : null;
      matchLabel = `vs ${opponent?.name ?? "TBD"}`;
    }
    return {
      id:             req.id,
      matchLabel,
      playerOutName:  playerOut?.username ?? "Unknown",
      playerOutMmr:   playerOut ? peakMmrSub(playerOut) : 0,
      subPlayerName:  subPlayer?.username ?? null,
      subPlayerMmr:   subPlayer ? peakMmrSub(subPlayer) : null,
      reason:         req.reason,
      status:         req.status as SubRequestRow["status"],
      adminNote:      req.admin_note,
      createdAt:      req.created_at,
    };
  });

  const availableSubs: AvailableSub[] = (
    (availableSubsRaw ?? []) as { id: string; username: string; peak_2v2: string; peak_3v3: string }[]
  );

  const subRoster: SubRosterPlayer[] = ((roster ?? []) as RosterPlayer[]).map((p) => ({
    id: p.id, username: p.username, peak_2v2: p.peak_2v2, peak_3v3: p.peak_3v3,
  }));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 space-y-8">

      {/* ── Team hero ── */}
      <div className="flex items-center gap-6">
        <TeamLogo team={team} size="lg" />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-white">{team.name}</h1>
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
            {avgMmr > 0 && <span className="text-zinc-400">avg {avgMmr.toLocaleString()} MMR</span>}
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

        {/* Roster */}
        <div className="lg:col-span-2">
          <Card title="Roster">
            <div className="divide-y divide-zinc-800">
              {sortedRoster.length === 0 ? (
                <p className="px-5 py-4 text-sm text-zinc-500">No players on this team yet.</p>
              ) : sortedRoster.map((p) => (
                <a key={p.id} href={p.tracker_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/40 transition-colors group">
                  {p.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`https://cdn.discordapp.com/avatars/${p.discord_id}/${p.avatar}.png`}
                      alt="" width={36} height={36} className="w-9 h-9 rounded-full shrink-0" />
                  ) : <div className="w-9 h-9 rounded-full bg-zinc-700 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors truncate">
                        {p.username}
                      </span>
                      {p.is_captain && (
                        <span className="text-[10px] font-bold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
                          CAPTAIN
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-6 text-right shrink-0">
                    <div>
                      <p className="text-[10px] text-zinc-600 mb-0.5">Peak 2v2</p>
                      <p className="text-sm font-mono text-zinc-300">{Number(p.peak_2v2).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-600 mb-0.5">Peak 3v3</p>
                      <p className="text-sm font-mono text-zinc-300">{Number(p.peak_3v3).toLocaleString()}</p>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </Card>
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

          {/* Next match */}
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

              if (isDE) {
                const info = getMatchInfo(nextMatch, numR1WB);
                return (
                  <div className="px-5 py-4 space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${info.sectionColor}`}>
                        {info.sectionName}
                      </span>
                      <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5">
                        {info.label}
                      </span>
                      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                        {info.roundName}
                      </span>
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
              }

              // SE
              const seLabel = numR1WB > 0 ? getMatchLabel(nextMatch.round, nextMatch.match_number, numR1WB) : null;
              return (
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center gap-2">
                    {seLabel && (
                      <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5">
                        {seLabel}
                      </span>
                    )}
                    <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">
                      {getRoundName(totalRoundsSE, nextMatch.round)}
                    </p>
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

          {/* Recent results */}
          <Card title="Recent Results">
            {!seasonActive ? (
              <p className="px-5 py-4 text-sm text-zinc-500">Season hasn&apos;t started yet.</p>
            ) : realCompleted.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">No results yet.</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {[...realCompleted].sort(sortDescending).map((m) => {
                  const isHome    = m.home_team_id === teamId;
                  const opponentId = isHome ? m.away_team_id : m.home_team_id;
                  const opponent  = opponentId ? teamMap[opponentId] : null;
                  const myScore   = isHome ? m.home_score : m.away_score;
                  const theirScore = isHome ? m.away_score : m.home_score;
                  const won       = (myScore ?? 0) > (theirScore ?? 0);

                  let label: string | null;
                  let subLabel: string;

                  if (m.stage.startsWith(GROUP_STAGE_PREFIX)) {
                    const groupNum = parseGroupNum(m.stage);
                    label    = null;
                    subLabel = `Group ${groupNum ?? "?"} · Round ${m.round}`;
                  } else if (isDE) {
                    const info = getMatchInfo(m, numR1WB);
                    label    = info.label;
                    subLabel = `${info.sectionName} · ${info.roundName}`;
                  } else {
                    label    = numR1WB > 0 ? getMatchLabel(m.round, m.match_number, numR1WB) : null;
                    subLabel = `${getRoundName(totalRoundsSE, m.round)}${label ? ` · Match ${label}` : ""}`;
                  }

                  return (
                    <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                      <span className={`text-xs font-bold w-6 h-6 rounded flex items-center justify-center shrink-0 ${
                        won ? "bg-emerald-700/50 text-emerald-300" : "bg-red-800/50 text-red-300"
                      }`}>
                        {won ? "W" : "L"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-zinc-300 truncate">vs {opponent?.name ?? "Unknown"}</p>
                        <p className="text-[10px] text-zinc-600 truncate">{subLabel}</p>
                      </div>
                      {myScore !== null && theirScore !== null && (
                        <span className="text-xs font-mono text-zinc-400 shrink-0">{myScore}–{theirScore}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

        </div>
      </div>

      {/* ── Match Schedule ── */}
      {schedulableMatches.length > 0 && (
        <MatchSchedulePanel
          matches={schedulableMatches}
          teamId={teamId}
          isCaptain={userIsCaptain}
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

        return (
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Group Stage Schedule</h2>
              {groupNum && (
                <span className="text-[10px] font-semibold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">
                  Group {groupNum}
                </span>
              )}
            </div>
            <div className="space-y-3">
              {rounds.map(([round, matches]) => (
                <div key={round} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <div className="px-5 py-2.5 border-b border-zinc-800">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Round {round}</p>
                  </div>
                  <div className="divide-y divide-zinc-800/50">
                    {matches.map((m) => {
                      const isHome     = m.home_team_id === teamId;
                      const opponentId = isHome ? m.away_team_id : m.home_team_id;
                      const opponent   = opponentId ? teamMap[opponentId] : null;
                      const done       = m.status === "completed";
                      const myScore    = isHome ? m.home_score : m.away_score;
                      const theirScore = isHome ? m.away_score : m.home_score;
                      const won        = done && (myScore ?? 0) > (theirScore ?? 0);
                      return (
                        <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                          {done ? (
                            <span className={`text-xs font-bold w-6 h-6 rounded flex items-center justify-center shrink-0 ${
                              won ? "bg-emerald-700/50 text-emerald-300" : "bg-red-800/50 text-red-300"
                            }`}>
                              {won ? "W" : "L"}
                            </span>
                          ) : (
                            <span className="w-6 h-6 rounded bg-zinc-800 flex items-center justify-center shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                            </span>
                          )}
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
              ))}
            </div>
          </section>
        );
      })()}

      {/* ── Sub Requests ── */}
      {userIsCaptain && (
        <SubRequestPanel
          teamId={teamId}
          roster={subRoster}
          availableSubs={availableSubs}
          upcomingMatches={upcomingMatchOptions}
          existingRequests={existingSubRequests}
          isCaptain={userIsCaptain}
        />
      )}

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
