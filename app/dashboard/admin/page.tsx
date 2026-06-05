import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { getAllPendingPlayers, getApprovedPlayers, isAdmin } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { LeagueControls } from "./league-controls";
import { FormatEditor, type SeasonFormatConfig } from "../season/format-editor";
import { CollapsibleSection } from "./collapsible-section";
import { RegistrationCard } from "./registration-card";
import { PlayerDataEditor } from "./player-data-editor";
import { TeamSlotsManager } from "./team-slots-manager";
import { MatchReporter } from "./match-reporter";
import { SubRequestCard, type SubRequestCardData } from "./sub-request-card";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);

  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");

  const [pending, approved, { data: settings }, { count: enteredCount }, { data: teamSlots }, { data: scheduledMatches }, { data: pendingSubRequests }] = await Promise.all([
    getAllPendingPlayers(),
    getApprovedPlayers(),
    supabaseAdmin.from("league_settings").select("season_format, season_participants, num_teams, draft_open, season_active, match_deadline_day, match_play_day, match_play_hour").single(),
    supabaseAdmin.from("players").select("*", { count: "exact", head: true }).eq("status", "approved").eq("draft_entered", true),
    supabaseAdmin.from("teams").select("id, name, discord_role_id, slot_number").order("slot_number", { nullsFirst: false }).order("name"),
    supabaseAdmin.from("matches").select("id, home_team_id, away_team_id, stage, round, match_number, scheduled_at, schedule_accepted").eq("status", "scheduled").not("home_team_id", "is", null).not("away_team_id", "is", null).order("stage").order("round").order("match_number"),
    supabaseAdmin.from("sub_requests").select("id, team_id, player_out_id, sub_player_id, reason, admin_note, requested_by_discord_id, created_at").eq("status", "pending").order("created_at", { ascending: true }),
  ]);

  // Build team name lookup for match reporter
  const matchTeamIds = [...new Set((scheduledMatches ?? []).flatMap(m => [m.home_team_id, m.away_team_id]))];
  const { data: matchTeams } = matchTeamIds.length
    ? await supabaseAdmin.from("teams").select("id, name").in("id", matchTeamIds)
    : { data: [] };
  const teamNameById = Object.fromEntries((matchTeams ?? []).map(t => [t.id, t.name]));
  const matchRows = (scheduledMatches ?? []).map(m => ({
    id: m.id,
    homeTeamId: m.home_team_id,
    awayTeamId: m.away_team_id,
    homeTeamName: teamNameById[m.home_team_id] ?? m.home_team_id,
    awayTeamName: teamNameById[m.away_team_id] ?? m.away_team_id,
    stage: m.stage,
    round: m.round,
    matchNumber: m.match_number,
    scheduledAt: (m.scheduled_at as string | null) ?? null,
    scheduleAccepted: (m.schedule_accepted as boolean) ?? false,
  }));

  // Build sub request cards
  type RawSubRequest = {
    id: string; team_id: string; player_out_id: string; sub_player_id: string | null;
    reason: string | null; admin_note: string | null; requested_by_discord_id: string; created_at: string;
  };
  const subReqs = (pendingSubRequests ?? []) as RawSubRequest[];

  const subTeamIds      = [...new Set(subReqs.map(r => r.team_id))];
  const subOutIds       = [...new Set(subReqs.map(r => r.player_out_id))];
  const subInIds        = [...new Set(subReqs.map(r => r.sub_player_id).filter((id): id is string => id !== null))];
  const subRequesterIds = [...new Set(subReqs.map(r => r.requested_by_discord_id))];

  const [
    { data: subTeams },
    { data: subPlayersOut },
    { data: subPlayersIn },
    { data: subRequesters },
  ] = await Promise.all([
    subTeamIds.length      ? supabaseAdmin.from("teams").select("id, name").in("id", subTeamIds) : { data: [] as { id: string; name: string }[] },
    subOutIds.length       ? supabaseAdmin.from("players").select("id, username, peak_2v2, peak_3v3").in("id", subOutIds) : { data: [] as { id: string; username: string; peak_2v2: string; peak_3v3: string }[] },
    subInIds.length        ? supabaseAdmin.from("players").select("id, username, peak_2v2, peak_3v3").in("id", subInIds) : { data: [] as { id: string; username: string; peak_2v2: string; peak_3v3: string }[] },
    subRequesterIds.length ? supabaseAdmin.from("players").select("discord_id, username").in("discord_id", subRequesterIds) : { data: [] as { discord_id: string; username: string }[] },
  ]);

  const subTeamMap      = Object.fromEntries((subTeams      ?? []).map(t => [t.id, t.name]));
  const subOutMap       = Object.fromEntries((subPlayersOut ?? []).map(p => [p.id, p]));
  const subInMap        = Object.fromEntries((subPlayersIn  ?? []).map(p => [p.id, p]));
  const subRequesterMap = Object.fromEntries((subRequesters ?? []).map(p => [p.discord_id, p.username]));

  function subPeakMmr(p: { peak_2v2: string; peak_3v3: string }) {
    return Math.max(Number(p.peak_2v2) || 0, Number(p.peak_3v3) || 0);
  }

  const subRequestCards: SubRequestCardData[] = subReqs.map(req => {
    const playerOut = subOutMap[req.player_out_id];
    const subPlayer = req.sub_player_id ? subInMap[req.sub_player_id] : null;
    return {
      id:                   req.id,
      teamName:             subTeamMap[req.team_id] ?? "Unknown",
      playerOutName:        playerOut?.username ?? "Unknown",
      playerOutMmr:         playerOut ? subPeakMmr(playerOut) : 0,
      subPlayerName:        subPlayer?.username ?? null,
      subPlayerMmr:         subPlayer ? subPeakMmr(subPlayer) : null,
      reason:               req.reason,
      adminNote:            req.admin_note,
      requestedByUsername:  subRequesterMap[req.requested_by_discord_id] ?? null,
      createdAt:            req.created_at,
    };
  });

  const seasonActive = settings?.season_active ?? false;
  const seasonFormat = (settings?.season_format as SeasonFormatConfig) ?? null;
  const seasonParticipants = (settings?.season_participants as number) ?? 16;
  const actualTeams: number = settings?.num_teams
    ? (settings.num_teams as number)
    : Math.floor((enteredCount ?? 0) / 3);

  return (
    <div className="p-8 space-y-12">

      {/* ── Pending Registrations ── */}
      <CollapsibleSection title="Pending Registrations" badge={pending.length} defaultOpen={pending.length > 0}>
        {pending.length === 0 ? (
          <p className="text-zinc-400 text-sm">No pending registrations.</p>
        ) : (
          <div className="space-y-4">
            {pending.map(player => (
              <RegistrationCard key={player.id} player={player} />
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* ── Player Data ── */}
      <CollapsibleSection title="Player Data" badge={approved.length} defaultOpen={false}>
        <PlayerDataEditor players={approved} />
      </CollapsibleSection>

      {/* ── Team Slots ── */}
      <CollapsibleSection title="Team Slots" badge={(teamSlots ?? []).length} defaultOpen={false}>
        <TeamSlotsManager teams={(teamSlots ?? []) as { id: string; name: string; discord_role_id: string | null; slot_number: number | null }[]} />
      </CollapsibleSection>

      {/* ── Season Settings ── */}
      <CollapsibleSection title="Season Settings">
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-sm font-medium text-zinc-400">Season Format</h3>
              {seasonActive && (
                <span className="text-xs text-amber-400 font-medium">
                  Locked — season in progress
                </span>
              )}
            </div>
            <FormatEditor
              initialFormat={seasonFormat}
              initialParticipants={seasonParticipants}
              actualTeams={actualTeams}
              isAdmin={!seasonActive}
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Match Reporting ── */}
      <CollapsibleSection title="Match Reporting" badge={matchRows.length} defaultOpen={matchRows.length > 0}>
        <MatchReporter matches={matchRows} />
      </CollapsibleSection>

      {/* ── Sub Requests ── */}
      <CollapsibleSection title="Sub Requests" badge={subRequestCards.length} defaultOpen={subRequestCards.length > 0}>
        {subRequestCards.length === 0 ? (
          <p className="text-zinc-400 text-sm">No pending sub requests.</p>
        ) : (
          <div className="space-y-4">
            {subRequestCards.map(req => (
              <SubRequestCard key={req.id} request={req} />
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* ── League Controls ── */}
      <CollapsibleSection title="League Controls">
        <LeagueControls
          draftOpen={settings?.draft_open ?? false}
          currentNumTeams={settings?.num_teams ?? 0}
          matchDeadlineDay={settings?.match_deadline_day ?? 2}
          matchPlayDay={settings?.match_play_day ?? 0}
          matchPlayHour={settings?.match_play_hour ?? 19}
        />
      </CollapsibleSection>

    </div>
  );
}


