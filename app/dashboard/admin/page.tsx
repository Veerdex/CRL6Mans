import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { decrypt } from "@/app/lib/session";
import { getAllPendingPlayers, isModeratorVerified, isDirector, isCEO, isCurrentlyKicked, type StaffRole } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { playerRatingFromRow } from "@/app/lib/rating";
import { LeagueControls } from "./league-controls";
import { AdminNotificationToggles } from "./admin-notification-toggles";
import { InsightsChart, type InsightsPoint } from "./insights-chart";
import { FormatEditor, type SeasonFormatConfig } from "../season/format-editor";
import { AdminSubSection } from "./admin-sub-section";
import { ACCESS_RANK } from "./access-levels";
import { AdminTabsProvider, AdminSidebar, AdminSection, type SidebarSection } from "./admin-tabs";
import { RegistrationCard } from "./registration-card";
import { PlayerPanel, type CombinedPlayer, type PlatformAccountSummary } from "./player-panel";
import { GuestAccountPanel, type GuestAccount } from "./guest-account-panel";
import { DraftPoolPanel, type DraftPoolEntry, type DraftPoolTournamentGroup } from "./draft-pool-panel";
import { TeamSlotsManager } from "./team-slots-manager";
import { MatchReporter } from "./match-reporter";
import { resolveBestOf, type RoundBestOfConfig, type BestOf, PRESETS } from "../season/format-constants";
import { SubRequestCard, type SubRequestCardData } from "./sub-request-card";
import { PlayerEditRequestCard, type PlayerEditRequestCardData } from "./player-edit-request-card";
import { PlatformAccountClaimCard, type PlatformAccountClaimCardData } from "./platform-account-claim-card";
import { PlatformAccountVerifiedCard, type PlatformAccountVerifiedCardData } from "./platform-account-verified-card";
import { IdentityDiscrepancyCard, type IdentityDiscrepancyCardData } from "./identity-discrepancy-card";
import { IdentityEnforcementToggle } from "./identity-enforcement-toggle";
import { JoinGateToggle } from "./join-gate-toggle";
import { TournamentManager } from "./tournament-manager";
import type { Tournament, Season } from "./tournament-actions";
import { InitSettingsButton } from "./init-settings-button";
import { getStaffList } from "./staff-actions";
import { StaffManager } from "./staff-section";
import { getSponsorsWithMembers, getTabPlacement, getNavTabOverrides, getTabSponsors } from "./sponsor-actions";
import { SponsorsManager, TabManagerSection, SeasonSponsorPicker, NavTabVisibilityGrid, TabSponsorGrid } from "./sponsors-section";
import { getDesigns } from "./design-actions";
import { DesignsSection } from "./designs-section";
import { getThemes } from "./theme-actions";
import { ThemeDesignerSection } from "./theme-designer-section";
import { getPublicSponsors } from "@/app/lib/sponsors-public";
import { getPublicDesigns } from "@/app/lib/designs-public";
import {
  AnalyticsSummaryCards,
  EventOverviewSection,
  TabVisitsSection,
} from "./data-section";
import { PatreonAdminSection } from "./patreon-section";
import { getLiveTiers, getOverridableTiers, getOverrideCandidates, getTierBenefitMap, getTierOverrides } from "./patreon-tiers-actions";
import { PatreonOverrideSection } from "./patreon-override-section";
import { PatreonTiersSection } from "./patreon-tiers-section";
import { PATREON_BENEFITS } from "@/app/lib/patreon-benefits";
import { StorageUsageSection } from "./storage-section";
import { RoundScheduler, type ScheduleSection, type RoundMatchInfo } from "./round-scheduler";
import { ScheduleOverrideCard, type ScheduleOverrideCardData } from "./schedule-override-card";
import { canonicalStage, stageName, STAGE_ORDER, expectedStageRounds, type RoundScheduleRow } from "./schedule-utils";
import { WagersBalanceTable, type BalanceRow } from "./wagers-balance-table";
import { WagersBulkForm } from "./wagers-bulk-form";
import { WagersResetForm } from "./wagers-reset-form";
import { WagersModeToggle } from "./wagers-mode-toggle";
import type { BettingMode } from "@/app/dashboard/wagers/actions";
import { AnnouncementManager } from "./announcement-manager";
import { GameLeaderboardPanel } from "./game-leaderboard-panel";
import { getAllGameScores } from "../game/actions";

async function StaffSection({ userIsCEO, userIsDirector }: { userIsCEO: boolean; userIsDirector: boolean }) {
  const staff = await getStaffList();
  return (
    <AdminSubSection
      sectionId="players-staff"
      tabId="staff-management"
      title="Staff Management"
      defaultOpen={false}
      description="Grant or revoke moderator, director, and CEO roles for staff members. A staff member's role determines which players they can moderate — moderators can only act on non-staff, directors can act on moderators too, and CEOs can act on anyone."
    >
      <StaffManager staff={staff} userIsCEO={userIsCEO} userIsDirector={userIsDirector} />
    </AdminSubSection>
  );
}

async function SponsorsSection({ patreonUrl }: { patreonUrl: string | null }) {
  const [sponsors, themes] = await Promise.all([getSponsorsWithMembers(), getThemes()]);
  return (
    <AdminSubSection
      sectionId="sponsors"
      tabId="sponsors-list"
      title="Sponsors"
      isDefaultTab
      value={sponsors.length}
      description="Create a sponsor and share its invite link — any Discord account that uses it becomes a linked member of that sponsor, up to the max-uses cap. Raise the cap at any time to let more reps join."
    >
      <SponsorsManager sponsors={sponsors} themes={themes} patreonUrl={patreonUrl} />
    </AdminSubSection>
  );
}

async function PatreonTiersAdminSection() {
  const [tiers, tierBenefitMap] = await Promise.all([getLiveTiers(), getTierBenefitMap()]);
  return (
    <AdminSubSection
      sectionId="data"
      tabId="patreon-tiers"
      title="Tiers & Benefits"
      value={tiers.length}
      description="Tiers are pulled live from the Patreon campaign. Benefits are a hardcoded catalog — pick which ones each tier includes."
    >
      <PatreonTiersSection tiers={tiers} benefits={PATREON_BENEFITS} tierBenefitMap={tierBenefitMap} />
    </AdminSubSection>
  );
}

async function PatreonOverrideAdminSection() {
  const [tiers, candidates, overrides] = await Promise.all([
    getOverridableTiers(),
    getOverrideCandidates(),
    getTierOverrides(),
  ]);
  return (
    <AdminSubSection
      sectionId="data"
      tabId="patreon-overrides"
      title="Tier Overrides"
      value={overrides.length}
      description="Pin a player to a Patreon tier so their benefits can be tested without a real pledge. Entitlements only — patron counts, MRR and the public patron list are untouched."
    >
      <PatreonOverrideSection tiers={tiers} candidates={candidates} overrides={overrides} />
    </AdminSubSection>
  );
}

async function DesignsAdminSection() {
  const designs = await getDesigns();
  return (
    <AdminSubSection
      sectionId="sponsors"
      tabId="designs"
      title="Designs"
      value={designs.length}
      description="Reusable background/nav visuals with no sponsor branding — assign to a tournament, the season, or a Tab Manager nav slot."
    >
      <DesignsSection designs={designs} />
    </AdminSubSection>
  );
}

async function ThemeDesignerAdminSection() {
  const themes = await getThemes();
  return (
    <AdminSubSection
      sectionId="sponsors"
      tabId="theme-designer"
      title="Theme Designer"
      value={themes.length}
      description="Design and save reusable color themes, then assign one to a sponsor from the Sponsors tab."
    >
      <ThemeDesignerSection themes={themes} />
    </AdminSubSection>
  );
}

async function TabManagerAdminSection() {
  const [sponsors, designs, tabPlacement, navTabOverrides, tabSponsors] = await Promise.all([
    getSponsorsWithMembers(),
    getDesigns(),
    getTabPlacement(),
    getNavTabOverrides(),
    getTabSponsors(),
  ]);
  return (
    <AdminSubSection
      sectionId="sponsors"
      tabId="tab-manager"
      title="Tab Manager"
      description="Configure which sponsor's content shows up on each dashboard tab."
    >
      <div className="space-y-4">
        <NavTabVisibilityGrid overrides={navTabOverrides} />
        <TabManagerSection sponsors={sponsors} designs={designs} tabPlacement={tabPlacement} />
        <TabSponsorGrid sponsors={sponsors} tabSponsors={tabSponsors} />
      </div>
    </AdminSubSection>
  );
}

export default async function AdminPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);

  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");

  const [userIsDirector, userIsCEO] = await Promise.all([
    isDirector(session.userId),
    isCEO(session.userId),
  ]);
  const testingMode           = userIsDirector && cookieStore.get("testing_mode")?.value === "1";
  const notificationsEnabled  = cookieStore.get("notifications_disabled")?.value !== "1";

  const [pending, { data: settings }, { data: draftPoolRows }, { data: teamSlots }, { data: scheduledMatches }, { data: pendingSubRequests }, { data: pendingEditRequests }, { data: tournaments }, { data: seasons }, { data: allAccounts }, { data: allMatchStages }, { data: playerRows }, publicSponsors, publicDesigns] = await Promise.all([
    getAllPendingPlayers(),
    supabaseAdmin.from("league_settings").select("season_format, season_participants, num_teams, draft_open, draft_active, draft_phase, pick_deadline, season_active, is_test_season, subs_enabled, match_deadline_day, match_play_day, match_play_hour, min_mmr_2v2, min_mmr_3v3, season_prize_1st, season_prize_2nd, season_prize_3rd4th, patreon_url, admin_notification_prefs, active_tournament_id, announcement_channel_id, announcement_text, announcement_destination, announcement_posted_at, round1_manual_start_pending, betting_mode, season_sponsor_id, season_design_id, identity_enforcement_enabled, join_gate_enabled").maybeSingle(),
    supabaseAdmin.from("players").select("id, discord_id, username, display_name, avatar, peak_2v2, current_2v2, peak_3v3, current_3v3, draft_entered_at").eq("status", "approved").eq("draft_entered", true).order("draft_entered_at", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name, discord_role_id, slot_number").order("slot_number", { nullsFirst: false }).order("name"),
    supabaseAdmin.from("matches").select("id, home_team_id, away_team_id, stage, round, match_number, scheduled_at, schedule_accepted, schedule_admin_required, schedule_proposed_by_team_id, pending_home_score, pending_away_score, score_confirmed").eq("status", "scheduled").not("home_team_id", "is", null).not("away_team_id", "is", null).order("stage").order("round").order("match_number"),
    supabaseAdmin.from("sub_requests").select("id, team_id, player_out_id, sub_player_id, sub_player_ids, reason, admin_note, requested_by_discord_id, created_at").eq("status", "escalated").order("created_at", { ascending: true }),
    supabaseAdmin.from("player_edit_requests").select("id, player_id, username, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2, created_at").eq("status", "pending").order("created_at", { ascending: true }),
    supabaseAdmin.from("tournaments").select("*").order("created_at", { ascending: false }),
    supabaseAdmin.from("seasons").select("*").order("ended_at", { ascending: false }),
    supabaseAdmin.from("accounts").select("id, discord_id, username, display_name, avatar, status, ban_reason, kick_reason, kicked_until, created_at, is_guest").order("username"),
    supabaseAdmin.from("matches").select("stage, round, discord_channel_id"),
    supabaseAdmin.from("players").select("account_id, team_id, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2"),
    getPublicSponsors(),
    getPublicDesigns(),
  ]);
  const sponsorOptions = publicSponsors.map((s) => ({ id: s.id, name: s.name }));
  const designOptions = publicDesigns.map((d) => ({ id: d.id, name: d.name }));

  // ── Insights: visits / registrations / draft joins over the last 52 weeks ──
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (todayStart.getDay() + 6) % 7;
  const currentWeekStart = new Date(todayStart);
  currentWeekStart.setDate(todayStart.getDate() - daysSinceMonday);
  const firstWeekStart = new Date(currentWeekStart);
  firstWeekStart.setDate(currentWeekStart.getDate() - 7 * 51);

  type RawPlayerRow = { account_id: string; team_id: string | null; tracker_url: string | null; peak_3v3: string | null; current_3v3: string | null; peak_2v2: string | null; current_2v2: string | null };
  const playersByAccountId = new Map(((playerRows ?? []) as RawPlayerRow[]).map(p => [p.account_id, p]));

  const scheduledTournamentIds = (tournaments ?? [])
    .filter((t) => t.status === "scheduled")
    .map((t) => t.id as string);

  type RawTeamSignupRow = { id: string; tournament_id: string; name: string; team_signup_members: { id: string; player_id: string; status: string }[] };

  const [
    { data: pendingPlatformClaimRows },
    { data: verifiedPlatformAccountRows },
    { data: allPlatformAccountRows },
    { data: entryRows },
    { data: teamSignupRows },
    { data: analyticsRows },
  ] = await Promise.all([
    supabaseAdmin
      .from("player_platform_accounts")
      .select("id, player_id, platform, platform_account_id, claimed_display_name, claimed_tracker_url, claimed_verification_replay_path, admin_note, created_at")
      .in("verification_status", ["claimed", "pending_verification"])
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("player_platform_accounts")
      .select("id, player_id, platform, platform_account_id, verified_display_name, verification_method, verified_at, valid_from")
      .eq("verification_status", "verified")
      .order("verified_at", { ascending: false }),
    supabaseAdmin
      .from("player_platform_accounts")
      .select("id, player_id, platform, platform_account_id, verification_status")
      .order("platform"),
    scheduledTournamentIds.length
      ? supabaseAdmin.from("tournament_entries").select("tournament_id, player_id").in("tournament_id", scheduledTournamentIds)
      : Promise.resolve({ data: [] as { tournament_id: string; player_id: string }[] }),
    scheduledTournamentIds.length
      ? supabaseAdmin.from("team_signups").select("id, tournament_id, name, team_signup_members(id, player_id, status)").in("tournament_id", scheduledTournamentIds)
      : Promise.resolve({ data: [] as RawTeamSignupRow[] }),
    supabaseAdmin
      .from("analytics_events")
      .select("type, created_at")
      .gte("created_at", firstWeekStart.toISOString()),
  ]);

  const platformAccountsByPlayerId = new Map<string, PlatformAccountSummary[]>();
  for (const row of allPlatformAccountRows ?? []) {
    const arr = platformAccountsByPlayerId.get(row.player_id) ?? [];
    arr.push({
      id: row.id,
      platform: row.platform as PlatformAccountSummary["platform"],
      platformAccountId: row.platform_account_id,
      verificationStatus: row.verification_status,
    });
    platformAccountsByPlayerId.set(row.player_id, arr);
  }

  const platformClaimPlayerIds = [...new Set([
    ...(pendingPlatformClaimRows ?? []).map(r => r.player_id),
    ...(verifiedPlatformAccountRows ?? []).map(r => r.player_id),
  ])];
  const signupPlayerIds = [...new Set([
    ...(entryRows ?? []).map((r) => r.player_id),
    ...((teamSignupRows ?? []) as RawTeamSignupRow[]).flatMap((s) => s.team_signup_members.map((m) => m.player_id)),
  ])];

  const [{ data: platformClaimPlayers }, { data: signupPlayerRows }] = await Promise.all([
    platformClaimPlayerIds.length
      ? supabaseAdmin.from("players").select("id, username, display_name").in("id", platformClaimPlayerIds)
      : Promise.resolve({ data: [] as { id: string; username: string; display_name: string | null }[] }),
    signupPlayerIds.length
      ? supabaseAdmin.from("players").select("id, discord_id, username, display_name, avatar").in("id", signupPlayerIds)
      : Promise.resolve({ data: [] as { id: string; discord_id: string; username: string; display_name: string | null; avatar: string | null }[] }),
  ]);
  const platformClaimPlayerMap = Object.fromEntries((platformClaimPlayers ?? []).map(p => [p.id, p]));
  const signupPlayerMap = new Map((signupPlayerRows ?? []).map((p) => [p.id, p]));

  const scheduledTournamentById = new Map((tournaments ?? []).map((t) => [t.id as string, t]));

  const draftPoolTournamentGroups: DraftPoolTournamentGroup[] = scheduledTournamentIds.map((tid) => {
    const t = scheduledTournamentById.get(tid);
    return {
      tournamentId: tid,
      tournamentName: t?.name ?? "Tournament",
      joinMode: (t?.join_mode ?? "players") as "players" | "teams",
      playerEntries: (entryRows ?? [])
        .filter((r) => r.tournament_id === tid)
        .map((r) => {
          const p = signupPlayerMap.get(r.player_id);
          return {
            playerId: r.player_id,
            discordId: p?.discord_id ?? "",
            username: p?.username ?? "Unknown",
            displayName: p?.display_name ?? null,
            avatar: p?.avatar ?? null,
          };
        }),
      teamSignups: ((teamSignupRows ?? []) as RawTeamSignupRow[])
        .filter((s) => s.tournament_id === tid)
        .map((s) => ({
          id: s.id,
          name: s.name,
          members: s.team_signup_members.map((m) => {
            const p = signupPlayerMap.get(m.player_id);
            return {
              playerId: m.player_id,
              status: m.status,
              username: p?.username ?? "Unknown",
              displayName: p?.display_name ?? null,
            };
          }),
        })),
    };
  }).filter((g) => g.playerEntries.length > 0 || g.teamSignups.length > 0);

  const platformClaimCards: PlatformAccountClaimCardData[] = await Promise.all(
    (pendingPlatformClaimRows ?? []).map(async (row) => {
      const player = platformClaimPlayerMap[row.player_id];
      let replayDownloadUrl: string | null = null;
      if (row.claimed_verification_replay_path) {
        const { data: signed } = await supabaseAdmin.storage
          .from("platform-verification-replays")
          .createSignedUrl(row.claimed_verification_replay_path, 60 * 30);
        replayDownloadUrl = signed?.signedUrl ?? null;
      }
      return {
        id: row.id,
        platform: row.platform as PlatformAccountClaimCardData["platform"],
        username: player?.username ?? "Unknown",
        displayName: player?.display_name ?? null,
        claimedDisplayName: row.claimed_display_name,
        claimedTrackerUrl: row.claimed_tracker_url,
        platformAccountId: row.platform_account_id,
        replayDownloadUrl,
        flagNote: row.admin_note,
        createdAt: row.created_at,
      };
    }),
  );

  const platformVerifiedCards: PlatformAccountVerifiedCardData[] = (verifiedPlatformAccountRows ?? []).map(row => {
    const player = platformClaimPlayerMap[row.player_id];
    return {
      id: row.id,
      platform: row.platform as PlatformAccountVerifiedCardData["platform"],
      username: player?.username ?? "Unknown",
      displayName: player?.display_name ?? null,
      verifiedDisplayName: row.verified_display_name,
      platformAccountId: row.platform_account_id,
      verificationMethod: row.verification_method,
      verifiedAt: row.verified_at,
      validFrom: row.valid_from,
    };
  });

  const identityEnforcementEnabled = settings?.identity_enforcement_enabled ?? false;
  const joinGateEnabled = settings?.join_gate_enabled ?? false;

  const { data: openDiscrepancyRows } = await supabaseAdmin
    .from("replay_identity_discrepancies")
    .select("id, match_id, replay_id, game_number, replay_player_name, replay_team, replay_platform, replay_platform_account_id, identity_source, expected_player_id, conflicting_player_id, reason, evidence_json, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true });

  const discrepancyReplayIds = [...new Set((openDiscrepancyRows ?? []).map(r => r.replay_id).filter((id): id is string => !!id))];
  const { data: discrepancyCertRows } = discrepancyReplayIds.length
    ? await supabaseAdmin.from("replay_identity_certifications").select("replay_id, replay_file_path").in("replay_id", discrepancyReplayIds)
    : { data: [] as { replay_id: string; replay_file_path: string | null }[] };
  const replayFilePathByReplayId = Object.fromEntries((discrepancyCertRows ?? []).map(r => [r.replay_id, r.replay_file_path]));

  const replayDownloadUrlByReplayId: Record<string, string> = {};
  await Promise.all(
    Object.entries(replayFilePathByReplayId)
      .filter((entry): entry is [string, string] => !!entry[1])
      .map(async ([replayId, path]) => {
        const { data } = await supabaseAdmin.storage.from("match-replays").createSignedUrl(path, 3600);
        if (data?.signedUrl) replayDownloadUrlByReplayId[replayId] = data.signedUrl;
      }),
  );

  const discrepancyMatchIds = [...new Set((openDiscrepancyRows ?? []).map(r => r.match_id))];
  const matchesUnderReviewCount = discrepancyMatchIds.length;
  const discrepancyPlayerIds = [...new Set((openDiscrepancyRows ?? []).flatMap(r => [r.expected_player_id, r.conflicting_player_id]).filter((id): id is string => !!id))];

  const [{ data: discrepancyMatchRows }, { data: discrepancyPlayerRows }] = await Promise.all([
    discrepancyMatchIds.length
      ? supabaseAdmin.from("matches").select("id, home_team_id, away_team_id, stage, round").in("id", discrepancyMatchIds)
      : Promise.resolve({ data: [] as { id: string; home_team_id: string | null; away_team_id: string | null; stage: string | null; round: number | null }[] }),
    discrepancyPlayerIds.length
      ? supabaseAdmin.from("players").select("id, username, display_name").in("id", discrepancyPlayerIds)
      : Promise.resolve({ data: [] as { id: string; username: string; display_name: string | null }[] }),
  ]);
  const discrepancyMatchById = Object.fromEntries((discrepancyMatchRows ?? []).map(m => [m.id, m]));
  const discrepancyPlayerById = Object.fromEntries((discrepancyPlayerRows ?? []).map(p => [p.id, p]));

  const discrepancyTeamIds = [...new Set((discrepancyMatchRows ?? []).flatMap(m => [m.home_team_id, m.away_team_id]).filter((id): id is string => !!id))];
  const { data: discrepancyTeamRows } = discrepancyTeamIds.length
    ? await supabaseAdmin.from("teams").select("id, name").in("id", discrepancyTeamIds)
    : { data: [] as { id: string; name: string }[] };
  const discrepancyTeamNameById = Object.fromEntries((discrepancyTeamRows ?? []).map(t => [t.id, t.name]));

  const discrepancyPlayerLabel = (id: string | null): string | null => {
    if (!id) return null;
    const p = discrepancyPlayerById[id];
    if (!p) return null;
    return p.display_name ? `${p.display_name} (${p.username})` : p.username;
  };

  const identityDiscrepancyCards: IdentityDiscrepancyCardData[] = (openDiscrepancyRows ?? []).map(row => {
    const match = discrepancyMatchById[row.match_id];
    const homeName = match?.home_team_id ? (discrepancyTeamNameById[match.home_team_id] ?? "TBD") : "TBD";
    const awayName = match?.away_team_id ? (discrepancyTeamNameById[match.away_team_id] ?? "TBD") : "TBD";
    const stageLabel = match?.stage ? match.stage.replace(/_/g, " ") : "match";
    const roundLabel = match?.round != null ? ` r${match.round}` : "";
    return {
      id: row.id,
      matchId: row.match_id,
      matchLabel: `${homeName} vs ${awayName} (${stageLabel}${roundLabel})`,
      gameNumber: row.game_number,
      createdAt: row.created_at,
      replayPlayerName: row.replay_player_name ?? "Unknown",
      replayTeam: row.replay_team,
      replayPlatform: row.replay_platform,
      replayPlatformAccountId: row.replay_platform_account_id,
      identitySource: row.identity_source,
      resolutionType: (row.evidence_json as { type?: string } | null)?.type ?? null,
      expectedPlayerLabel: discrepancyPlayerLabel(row.expected_player_id),
      conflictingPlayerLabel: discrepancyPlayerLabel(row.conflicting_player_id),
      reason: row.reason,
      replayDownloadUrl: row.replay_id ? (replayDownloadUrlByReplayId[row.replay_id] ?? null) : null,
    };
  });

  // crl_coins/username/display_name live on accounts (Tier 1) now. Scoped to
  // approved accounts only — id is still players.id-compatible since
  // players.id = accounts.id for every approved player (see adjustPlayerBalance).
  const [{ data: wagerBalanceAccounts }, gameScores, { data: rawAdjustmentRows }] = await Promise.all([
    supabaseAdmin
      .from("accounts")
      .select("id, username, display_name, crl_coins")
      .eq("status", "approved")
      .order("crl_coins", { ascending: false }),
    getAllGameScores(),
    supabaseAdmin
      .from("wager_balance_adjustments")
      .select("batch_id, scope, player_id, amount, reason, actor, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const wagerBalanceRows: BalanceRow[] = (wagerBalanceAccounts ?? []).map(a => ({
    id: a.id,
    username: a.username,
    displayName: a.display_name,
    balance: a.crl_coins ?? 0,
  }));

  const globalBettingMode: BettingMode = settings?.betting_mode === "pool" ? "pool" : "fixed";

  const adjustmentPlayerIds = [...new Set((rawAdjustmentRows ?? []).map(r => r.player_id))];
  const adjustmentActorIds = [...new Set((rawAdjustmentRows ?? []).map(r => r.actor))];

  const [{ data: adjustmentPlayerRows }, { data: adjustmentActorRows }] = await Promise.all([
    adjustmentPlayerIds.length
      ? supabaseAdmin.from("players").select("id, username, display_name").in("id", adjustmentPlayerIds)
      : Promise.resolve({ data: [] as { id: string; username: string; display_name: string | null }[] }),
    adjustmentActorIds.length
      ? supabaseAdmin.from("players").select("discord_id, username, display_name").in("discord_id", adjustmentActorIds)
      : Promise.resolve({ data: [] as { discord_id: string; username: string; display_name: string | null }[] }),
  ]);
  const adjustmentPlayerById = Object.fromEntries((adjustmentPlayerRows ?? []).map(p => [p.id, p]));
  const adjustmentActorByDiscordId = Object.fromEntries((adjustmentActorRows ?? []).map(p => [p.discord_id, p]));

  type BalanceAdjustmentBatch = {
    batchId: string;
    scope: string;
    reason: string;
    actor: string;
    createdAt: string;
    totalAmount: number;
    playerCount: number;
    singlePlayerId: string | null;
  };
  const adjustmentBatchById = new Map<string, BalanceAdjustmentBatch>();
  for (const row of rawAdjustmentRows ?? []) {
    const existing = adjustmentBatchById.get(row.batch_id);
    if (existing) {
      existing.totalAmount += row.amount;
      existing.playerCount += 1;
    } else {
      adjustmentBatchById.set(row.batch_id, {
        batchId: row.batch_id,
        scope: row.scope,
        reason: row.reason,
        actor: row.actor,
        createdAt: row.created_at,
        totalAmount: row.amount,
        playerCount: 1,
        singlePlayerId: row.scope === "single" ? row.player_id : null,
      });
    }
  }
  const balanceAdjustmentLog = [...adjustmentBatchById.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);

  const playerLabel = (id: string | null): string => {
    if (!id) return "player";
    const p = adjustmentPlayerById[id];
    if (!p) return "player";
    return p.display_name ? `${p.display_name} (${p.username})` : p.username;
  };
  const actorLabel = (discordId: string): string => {
    const a = adjustmentActorByDiscordId[discordId];
    if (!a) return "an admin";
    return a.display_name ? `${a.display_name} (${a.username})` : a.username;
  };

  // Fetch staff roles for all accounts to support hierarchy-aware kick/ban buttons
  const accountDiscordIds = (allAccounts ?? []).map((a: { discord_id: string }) => a.discord_id).filter(Boolean);
  // Build team name lookup for match reporter
  const matchTeamIds = [...new Set((scheduledMatches ?? []).flatMap(m => [m.home_team_id, m.away_team_id]))];
  // Eligible players per match: both team rosters + any approved subs for that match.
  // Used to scope the replay aka-name dropdown to who could actually be playing.
  type EligibleOption = { id: string; label: string };
  const matchIds = (scheduledMatches ?? []).map(m => m.id);

  const [{ data: staffRows }, { data: matchTeams }, { data: approvedSubsForMatches }] = await Promise.all([
    accountDiscordIds.length
      ? supabaseAdmin.from("staff_roles").select("discord_id, role").in("discord_id", accountDiscordIds)
      : Promise.resolve({ data: [] as { discord_id: string; role: string }[] }),
    matchTeamIds.length
      ? supabaseAdmin.from("teams").select("id, name").in("id", matchTeamIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    matchIds.length
      ? supabaseAdmin
          .from("sub_requests")
          .select("match_id, sub_player_id, sub_player_ids")
          .eq("status", "approved")
          .in("match_id", matchIds)
      : Promise.resolve({ data: [] as { match_id: string; sub_player_id: string | null; sub_player_ids: string[] | null }[] }),
  ]);
  const staffRoleByDiscordId = Object.fromEntries((staffRows ?? []).map((r: { discord_id: string; role: string }) => [r.discord_id, r.role]));
  const actorRole = userIsCEO ? "ceo" : userIsDirector ? "director" : "moderator";
  const teamNameById = Object.fromEntries((matchTeams ?? []).map(t => [t.id, t.name]));

  const approvedRoster = (allAccounts ?? []).filter((a: { status: string }) => a.status === "approved");
  const optionById = new Map<string, EligibleOption>(
    approvedRoster.map((p: { id: string; username: string; display_name: string | null }) => [
      p.id,
      { id: p.id, label: p.display_name ? `${p.display_name} (${p.username})` : p.username },
    ]),
  );
  const optionsByTeam = new Map<string, EligibleOption[]>();
  for (const p of approvedRoster as { id: string }[]) {
    const teamId = playersByAccountId.get(p.id)?.team_id;
    if (!teamId) continue;
    const opt = optionById.get(p.id);
    if (!opt) continue;
    const arr = optionsByTeam.get(teamId) ?? [];
    arr.push(opt);
    optionsByTeam.set(teamId, arr);
  }
  const subsByMatch = new Map<string, string[]>();
  for (const s of approvedSubsForMatches ?? []) {
    const ids = (s.sub_player_ids as string[] | null) ?? (s.sub_player_id ? [s.sub_player_id] : []);
    if (!ids.length) continue;
    subsByMatch.set(s.match_id, [...(subsByMatch.get(s.match_id) ?? []), ...ids]);
  }
  function eligiblePlayersForMatch(m: { id: string; home_team_id: string; away_team_id: string }): EligibleOption[] {
    const set = new Map<string, EligibleOption>();
    for (const opt of optionsByTeam.get(m.home_team_id) ?? []) set.set(opt.id, opt);
    for (const opt of optionsByTeam.get(m.away_team_id) ?? []) set.set(opt.id, opt);
    for (const id of subsByMatch.get(m.id) ?? []) { const opt = optionById.get(id); if (opt) set.set(id, opt); }
    return [...set.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  // Compute best-of per match from season_format
  const sfFormat = settings?.season_format as { roundBestOf?: RoundBestOfConfig; best_of?: number } | null;
  const fallbackBestOf = (sfFormat?.best_of ?? 3) as BestOf;
  const maxRoundByStage: Record<string, number> = {};
  for (const m of allMatchStages ?? []) {
    maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
  }
  function matchBestOf(stage: string, round: number): number {
    return resolveBestOf(stage, round, maxRoundByStage, sfFormat?.roundBestOf, fallbackBestOf);
  }

  const matchRows = (scheduledMatches ?? []).map(m => ({
    id: m.id,
    homeTeamId: m.home_team_id,
    awayTeamId: m.away_team_id,
    homeTeamName: teamNameById[m.home_team_id] ?? m.home_team_id,
    awayTeamName: teamNameById[m.away_team_id] ?? m.away_team_id,
    stage: m.stage,
    round: m.round,
    matchNumber: m.match_number,
    bestOf: matchBestOf(m.stage, m.round),
    scheduledAt: (m.scheduled_at as string | null) ?? null,
    scheduleAccepted: (m.schedule_accepted as boolean) ?? false,
    pendingHomeScore: (m.pending_home_score as number | null) ?? null,
    pendingAwayScore: (m.pending_away_score as number | null) ?? null,
    scoreConfirmed: (m.score_confirmed as boolean) ?? false,
    players: eligiblePlayersForMatch(m),
  }));

  // Build sub request cards
  type RawSubRequest = {
    id: string; team_id: string; player_out_id: string; sub_player_id: string | null;
    sub_player_ids: string[] | null;
    reason: string | null; admin_note: string | null; requested_by_discord_id: string; created_at: string;
  };
  const subReqs = (pendingSubRequests ?? []) as RawSubRequest[];

  const subTeamIds      = [...new Set(subReqs.map(r => r.team_id))];
  const subOutIds       = [...new Set(subReqs.map(r => r.player_out_id))];
  const subInIds        = [...new Set(subReqs.flatMap(r => {
    if (r.sub_player_ids && r.sub_player_ids.length > 0) return r.sub_player_ids;
    if (r.sub_player_id) return [r.sub_player_id];
    return [];
  }))];
  const subRequesterIds = [...new Set(subReqs.map(r => r.requested_by_discord_id))];

  type RawEditRequest = {
    id: string; player_id: string; username: string;
    tracker_url: string; peak_3v3: string; current_3v3: string; peak_2v2: string; current_2v2: string;
   
    created_at: string;
  };
  const editReqs = (pendingEditRequests ?? []) as RawEditRequest[];
  const editPlayerIds = [...new Set(editReqs.map(r => r.player_id))];

  const [
    { data: subTeams },
    { data: subPlayersOut },
    { data: subPlayersIn },
    { data: subRequesters },
    { data: editPlayers },
  ] = await Promise.all([
    subTeamIds.length      ? supabaseAdmin.from("teams").select("id, name").in("id", subTeamIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    subOutIds.length       ? supabaseAdmin.from("players").select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3").in("id", subOutIds) : Promise.resolve({ data: [] as { id: string; username: string; display_name: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }[] }),
    subInIds.length        ? supabaseAdmin.from("players").select("id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3").in("id", subInIds) : Promise.resolve({ data: [] as { id: string; username: string; display_name: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }[] }),
    subRequesterIds.length ? supabaseAdmin.from("players").select("discord_id, username, display_name").in("discord_id", subRequesterIds) : Promise.resolve({ data: [] as { discord_id: string; username: string; display_name: string | null }[] }),
    editPlayerIds.length   ? supabaseAdmin.from("players").select("id, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2").in("id", editPlayerIds) : Promise.resolve({ data: [] as { id: string; tracker_url: string | null; peak_3v3: string | null; current_3v3: string | null; peak_2v2: string | null; current_2v2: string | null }[] }),
  ]);

  const subTeamMap      = Object.fromEntries((subTeams      ?? []).map(t => [t.id, t.name]));
  const subOutMap       = Object.fromEntries((subPlayersOut ?? []).map(p => [p.id, p]));
  const subInMap        = Object.fromEntries((subPlayersIn  ?? []).map(p => [p.id, p]));
  const subRequesterMap = Object.fromEntries((subRequesters ?? []).map(p => [p.discord_id, p]));

  function subPeakMmr(p: Parameters<typeof playerRatingFromRow>[0]) {
    return Math.round(playerRatingFromRow(p));
  }

  const subRequestCards: SubRequestCardData[] = subReqs.map(req => {
    const playerOut    = subOutMap[req.player_out_id];
    const candidateIds = (req.sub_player_ids && req.sub_player_ids.length > 0)
      ? req.sub_player_ids
      : (req.sub_player_id ? [req.sub_player_id] : []);
    const subCandidates = candidateIds
      .map(id => subInMap[id])
      .filter(Boolean)
      .map(p => ({ username: p.username, displayName: p.display_name ?? null, mmr: subPeakMmr(p) }));
    const requester = subRequesterMap[req.requested_by_discord_id];
    return {
      id:                   req.id,
      teamName:             subTeamMap[req.team_id] ?? "Unknown",
      playerOutName:        playerOut?.username ?? "Unknown",
      playerOutDisplay:     playerOut?.display_name ?? null,
      playerOutMmr:         playerOut ? subPeakMmr(playerOut) : 0,
      subCandidates,
      reason:               req.reason,
      adminNote:            req.admin_note,
      requestedByUsername:  requester?.username ?? null,
      requestedByDisplay:   requester?.display_name ?? null,
      createdAt:            req.created_at,
    };
  });

  // Build player edit request cards (join with live player data)
  const editPlayerMap = Object.fromEntries((editPlayers ?? []).map(p => [p.id, p]));

  const playerEditRequestCards: PlayerEditRequestCardData[] = editReqs.map(req => {
    const live = editPlayerMap[req.player_id];
    return {
      id:              req.id,
      username:        req.username,
      trackerUrl:      req.tracker_url,
      peak3v3:         req.peak_3v3,
      current3v3:      req.current_3v3,
      peak2v2:         req.peak_2v2,
      current2v2:      req.current_2v2,
      liveTrackerUrl:  live?.tracker_url  ?? "",
      livePeak3v3:     live?.peak_3v3     ?? "",
      liveCurrent3v3:  live?.current_3v3  ?? "",
      livePeak2v2:     live?.peak_2v2     ?? "",
      liveCurrent2v2:  live?.current_2v2  ?? "",
      createdAt:       req.created_at,
    };
  });

  // ── Scheduling section data ────────────────────────────────────────────────
  const activeTournamentId = (settings?.active_tournament_id as string | null) ?? null;
  const [{ data: roundScheduleRows }, { data: schedulerMatchRows }] = await Promise.all([
    settings?.season_active
      ? (activeTournamentId
          ? supabaseAdmin.from("round_schedules").select("stage, round, schedule_type, play_at, deadline_at, range_days").eq("tournament_id", activeTournamentId)
          : supabaseAdmin.from("round_schedules").select("stage, round, schedule_type, play_at, deadline_at, range_days").is("tournament_id", null))
      : Promise.resolve({ data: [] as { stage: string; round: number; schedule_type: string; play_at: string; deadline_at: string; range_days: number | null }[] }),
    settings?.season_active
      ? supabaseAdmin
          .from("matches")
          .select("id, stage, round, match_number, home_team_id, away_team_id, scheduled_at, admin_scheduled, schedule_proposed_by_team_id, discord_channel_id")
          .neq("status", "completed")
          .order("stage").order("round").order("match_number")
      : Promise.resolve({ data: [] as { id: string; stage: string; round: number; match_number: number; home_team_id: string | null; away_team_id: string | null; scheduled_at: string | null; admin_scheduled: boolean; schedule_proposed_by_team_id: string | null; discord_channel_id: string | null }[] }),
  ]);

  const enteredCount = (draftPoolRows ?? []).length;

  type MatchStageRow = { stage: string; round: number; discord_channel_id: string | null };
  const matchStageRows = (allMatchStages ?? []) as MatchStageRow[];

  // Build canonical (stage, round) sections from all matches
  const canonRoundSets = new Map<string, Set<number>>();
  const lockedRoundKeys = new Set<string>();
  for (const m of matchStageRows) {
    const cs = canonicalStage(m.stage);
    if (!canonRoundSets.has(cs)) canonRoundSets.set(cs, new Set());
    canonRoundSets.get(cs)!.add(m.round);
    if (m.discord_channel_id) lockedRoundKeys.add(`${cs}:${m.round}`);
  }

  // Predict all format stages + their round counts so the scheduler shows every
  // stage up front, before its bracket is generated. Real matches take precedence.
  const sf = settings?.season_format as { preset?: string; groupMaxAdvancing?: number | null } | null;
  const schedulingTeams = settings?.num_teams
    ? (settings.num_teams as number)
    : Math.floor((enteredCount ?? 0) / 3);
  if (sf?.preset) {
    for (const { stage, rounds } of expectedStageRounds(sf.preset, schedulingTeams, sf.groupMaxAdvancing ?? null)) {
      if (rounds <= 0) continue;
      // Always merge predicted rounds — stages that generate matches on-demand (Swiss,
      // Hybrid) need future unplayed rounds visible even after the stage has started.
      if (!canonRoundSets.has(stage)) canonRoundSets.set(stage, new Set());
      const set = canonRoundSets.get(stage)!;
      for (let r = 1; r <= rounds; r++) set.add(r);
    }
  }

  const schedulingSections: ScheduleSection[] = [...canonRoundSets.entries()]
    .sort(([a], [b]) => {
      const ai = STAGE_ORDER.indexOf(a);
      const bi = STAGE_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })
    .map(([stage, roundSet]) => {
      const rounds = [...roundSet].sort((a, b) => a - b);
      return { stage, rounds, maxRound: Math.max(...rounds) };
    });

  const scheduledRoundKeys = new Set(
    (roundScheduleRows ?? []).map((s) => `${s.stage}:${s.round}`),
  );
  const schedulingUnscheduledCount = schedulingSections.reduce(
    (sum, sec) => sum + sec.rounds.filter((r) => !scheduledRoundKeys.has(`${sec.stage}:${r}`)).length,
    0,
  );

  const schedulingSchedules: RoundScheduleRow[] = (roundScheduleRows ?? []).map((s) => ({
    stage: s.stage,
    round: s.round,
    scheduleType: s.schedule_type as RoundScheduleRow["scheduleType"],
    playAt: s.play_at,
    deadlineAt: s.deadline_at,
    rangeDays: s.range_days,
  }));

  // Per-round match rows (incl. TBD-team future rounds) for the expand/per-match
  // scheduling UI. Keyed by canonical "stage:round".
  const matchesByRound: Record<string, RoundMatchInfo[]> = {};
  for (const m of schedulerMatchRows ?? []) {
    const cs = canonicalStage(m.stage);
    const key = `${cs}:${m.round}`;
    const gm = m.stage.match(/^group_(\d+)$/);
    (matchesByRound[key] ??= []).push({
      id: m.id,
      matchNumber: m.match_number,
      groupNum: gm ? Number(gm[1]) : null,
      homeName: m.home_team_id ? (teamNameById[m.home_team_id] ?? "TBD") : "TBD",
      awayName: m.away_team_id ? (teamNameById[m.away_team_id] ?? "TBD") : "TBD",
      scheduledAt: m.scheduled_at,
      adminScheduled: !!m.admin_scheduled,
      hasProposal: !!m.schedule_proposed_by_team_id,
      hasChannel: !!m.discord_channel_id,
    });
  }
  for (const key of Object.keys(matchesByRound)) {
    matchesByRound[key].sort((a, b) => (a.groupNum ?? 0) - (b.groupNum ?? 0) || a.matchNumber - b.matchNumber);
  }

  // Out-of-window times both teams agreed on, awaiting admin approval.
  const scheduleOverrideCards: ScheduleOverrideCardData[] = (scheduledMatches ?? [])
    .filter((m) => m.schedule_admin_required && m.schedule_accepted && m.scheduled_at)
    .map((m) => {
      const cs = canonicalStage(m.stage);
      const sched = (roundScheduleRows ?? []).find((s) => s.stage === cs && s.round === m.round);
      const windowNote = sched
        ? sched.schedule_type !== "specific" ? "must be within the scheduled window"
          : "a specific time was set"
        : null;
      return {
        matchId: m.id,
        homeTeam: teamNameById[m.home_team_id] ?? m.home_team_id,
        awayTeam: teamNameById[m.away_team_id] ?? m.away_team_id,
        roundLabel: `${stageName(cs)} · R${m.round}`,
        requestedAt: m.scheduled_at as string,
        windowNote,
      };
    });

  const seasonActive = settings?.season_active ?? false;
  const seasonFormat = (settings?.season_format as SeasonFormatConfig) ?? null;
  const seasonParticipants = (settings?.season_participants as number) ?? 16;
  const actualTeams: number = settings?.num_teams
    ? (settings.num_teams as number)
    : Math.floor((enteredCount ?? 0) / 3);

  // Number of pre-created team slots — caps how many teams the draft can actually
  // build regardless of player pool size.
  const teamSlotCount = (teamSlots ?? []).filter((t) => t.slot_number != null).length;
  // Actual feasible max teams from the player pool alone (slot count is a separate concern).
  // Shown in the top-right of the Start Draft / Auto Draft cards.
  const draftCurrentMax = Math.floor((enteredCount ?? 0) / 3);

  // The selected format's team ceiling (e.g. 32 for hybrid, 64 for group, null for SE/DE).
  // Shown as the blank-input default in the max-teams field.
  const FORMAT_MAX_TEAMS: Record<string, number> = {
    group_single_elimination: 64,
    group_swiss_single_elimination: 64,
    group_swiss_hybrid: 32,
    group_swiss_hybrid_8: 32,
  };
  const currentPreset = (seasonFormat as { preset?: string } | null)?.preset;
  const draftFormatMax = currentPreset ? (FORMAT_MAX_TEAMS[currentPreset] ?? null) : null;
  const seasonFormatLabel = currentPreset
    ? (PRESETS.find((p) => p.id === currentPreset)?.name ?? currentPreset)
    : "No format configured";

  type RawAccount = { id: string; discord_id: string; username: string; display_name: string | null; avatar: string | null; status: string; ban_reason: string | null; kick_reason: string | null; kicked_until: string | null; created_at: string; is_guest: boolean | null };

  // Tier 3 (players) rows only exist for accounts that have been approved at
  // some point, so "has a players row" is what distinguishes the main roster
  // from guest accounts below — not accounts.status alone (a banned account
  // that was never approved has no players row and no MMR/tracker data).
  const combinedPlayers: CombinedPlayer[] = ((allAccounts ?? []) as RawAccount[])
    .filter(a => (a.status === "approved" || a.status === "banned") && playersByAccountId.has(a.id))
    .map(a => {
      const pr = playersByAccountId.get(a.id)!;
      return {
        id: a.id,
        discord_id: a.discord_id,
        username: a.username,
        display_name: a.display_name ?? null,
        avatar: a.avatar,
        status: a.status as "approved" | "banned",
        tracker_url: pr.tracker_url ?? "",
        peak_3v3: pr.peak_3v3 ?? "0",
        current_3v3: pr.current_3v3 ?? "0",
        peak_2v2: pr.peak_2v2 ?? "0",
        current_2v2: pr.current_2v2 ?? "0",
        banReason: a.ban_reason ?? null,
        kickReason: a.kick_reason ?? null,
        kickedUntil: a.kicked_until ?? null,
        isKicked: isCurrentlyKicked(a.kick_reason ?? null, a.kicked_until ?? null),
        staffRole: (staffRoleByDiscordId[a.discord_id] ?? null) as StaffRole | null,
        platformAccounts: platformAccountsByPlayerId.get(a.id) ?? [],
      };
    });
  const bannedCount = combinedPlayers.filter(p => p.status === "banned").length;

  // Exact complement of combinedPlayers, so every non-sponsor account renders
  // in exactly one panel — covers unregistered/pending, rejected (even with a
  // leftover players row from a prior approval), and banned-without-ever-approved
  // (no players row, e.g. an admin banning a guest straight from this panel).
  // Sponsor guest accounts (is_guest) are excluded — they're not prospective
  // players and are already visible/removable from the Sponsors section.
  const guestAccounts: GuestAccount[] = ((allAccounts ?? []) as RawAccount[])
    .filter(a => !a.is_guest)
    .filter(a => !((a.status === "approved" || a.status === "banned") && playersByAccountId.has(a.id)))
    .map(a => ({
      id: a.id,
      discord_id: a.discord_id,
      username: a.username,
      display_name: a.display_name ?? null,
      avatar: a.avatar,
      status: a.status as GuestAccount["status"],
      banReason: a.ban_reason ?? null,
      kickReason: a.kick_reason ?? null,
      kickedUntil: a.kicked_until ?? null,
      isKicked: isCurrentlyKicked(a.kick_reason ?? null, a.kicked_until ?? null),
      staffRole: (staffRoleByDiscordId[a.discord_id] ?? null) as StaffRole | null,
      createdAt: a.created_at,
    }));

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const firstWeekMs = firstWeekStart.getTime();
  const insightsData: InsightsPoint[] = Array.from({ length: 52 }, (_, i) => {
    const d = new Date(firstWeekMs + i * WEEK_MS);
    return {
      label: d.toLocaleString("en-US", { month: "short", day: "numeric" }),
      visits: 0,
      registrations: 0,
      draftJoins: 0,
    };
  });
  for (const e of (analyticsRows ?? []) as { type: string; created_at: string }[]) {
    const idx = Math.floor((new Date(e.created_at).getTime() - firstWeekMs) / WEEK_MS);
    if (idx < 0 || idx > 51) continue;
    const b = insightsData[idx];
    if (e.type === "visit") b.visits++;
    else if (e.type === "registration") b.registrations++;
    else if (e.type === "draft_join") b.draftJoins++;
  }

  const ALL_SECTIONS: SidebarSection[] = [
    {
      id: "overview",
      label: "Overview",
      subTabs: [
        { id: "notifications", label: "Notifications", level: "director" },
        { id: "team-slots", label: "Team Slots", level: "director", value: (teamSlots ?? []).length },
      ],
    },
    {
      id: "players-staff",
      label: "Players & Staff",
      subTabs: [
        { id: "players", label: "Players", level: "moderator", value: combinedPlayers.length },
        { id: "pending-accounts", label: "Unregistered / Pending Accounts", level: "moderator", value: guestAccounts.length },
        { id: "identity-discrepancies", label: "Identity Discrepancies", level: "director", notification: identityDiscrepancyCards.length },
        { id: "staff-management", label: "Staff Management", level: "director" },
      ],
    },
    {
      id: "match-ops",
      label: "Match Ops",
      subTabs: [
        { id: "match-reporting", label: "Match Reporting", level: "moderator", value: matchRows.length, notification: matchesUnderReviewCount || undefined },
        { id: "sub-requests", label: "Sub Requests", level: "moderator", notification: subRequestCards.length || undefined },
        { id: "schedule-approvals", label: "Schedule Approvals", level: "moderator", notification: scheduleOverrideCards.length || undefined },
      ],
    },
    {
      id: "approvals",
      label: "Approvals",
      subTabs: [
        { id: "registrations-platform", label: "Registrations & Platform Claims", level: "moderator", notification: (pending.length + platformClaimCards.length) || undefined },
        { id: "profile-changes", label: "Profile Change Requests", level: "moderator", notification: playerEditRequestCards.length || undefined },
        { id: "verified-platform", label: "Verified Platform Accounts", level: "moderator", value: platformVerifiedCards.length },
      ],
    },
    {
      id: "season-league",
      label: "Season & League",
      subTabs: [
        { id: "announcements", label: "Announcements", level: "director", value: settings?.announcement_text ? 1 : undefined },
        ...(seasonActive ? [{ id: "scheduling", label: "Scheduling", level: "director" as const, notification: schedulingUnscheduledCount || undefined }] : []),
        { id: "tournaments", label: "Tournaments", level: "director", value: (tournaments ?? []).filter((t) => t.status === "scheduled" || t.status === "active").length },
        { id: "season-settings", label: "Season Settings", level: "director" },
        { id: "draft-pool", label: "Draft Pool", level: "director", value: enteredCount + draftPoolTournamentGroups.reduce((n, g) => n + g.playerEntries.length + g.teamSignups.length, 0) },
        { id: "league-controls", label: "League Controls", level: "director" },
      ],
    },
    {
      id: "wagers",
      label: "Wagers",
      subTabs: [
        { id: "wagers", label: "Wagers", level: "director" },
        { id: "game-leaderboard", label: "Game Leaderboard", level: "director", value: gameScores.length },
      ],
    },
    {
      id: "data",
      label: "Data",
      subTabs: [
        { id: "insights", label: "Insights", level: "moderator" },
        { id: "event-overview", label: "Event Overview", level: "moderator" },
        { id: "tab-visits", label: "Tab Visits", level: "moderator" },
        { id: "patrons", label: "Patrons", level: "moderator" },
        { id: "patreon-tiers", label: "Tiers & Benefits", level: "director" },
        { id: "patreon-overrides", label: "Tier Overrides", level: "director" },
        { id: "storage", label: "Storage & Limits", level: "director" },
      ],
    },
    {
      id: "sponsors",
      label: "Sponsors",
      subTabs: [
        { id: "sponsors-list", label: "Sponsors", level: "director" },
        { id: "designs", label: "Designs", level: "director" },
        { id: "tab-manager", label: "Tab Manager", level: "director" },
        { id: "theme-designer", label: "Theme Designer", level: "director" },
      ],
    },
  ];

  // Tabs above this admin's rank are dropped, and a section left with nothing
  // visible disappears with them rather than rendering an empty dropdown.
  const viewerRank = ACCESS_RANK[userIsCEO ? "ceo" : userIsDirector ? "director" : "moderator"];
  const SECTIONS: SidebarSection[] = ALL_SECTIONS
    .map((s) => ({ ...s, subTabs: s.subTabs.filter((t) => ACCESS_RANK[t.level] <= viewerRank) }))
    .filter((s) => s.subTabs.length > 0);

  return (
    <AdminTabsProvider sections={SECTIONS}>
    <div className="p-4 sm:p-6 lg:p-8">

      {/* ── Missing settings row warning ── */}
      {!settings && (
        <div className="mb-8 bg-amber-950/40 border border-amber-700/60 rounded-xl px-5 py-4 flex items-start gap-4">
          <div className="flex-1 space-y-1">
            <p className="text-sm font-semibold text-amber-300">League settings row is missing</p>
            <p className="text-xs text-amber-500">
              The <code className="font-mono">league_settings</code> table has no row. All draft and season controls will silently do nothing until this is fixed.
            </p>
          </div>
          <InitSettingsButton />
        </div>
      )}

      <div className="md:flex md:gap-8 md:items-start">
      <AdminSidebar sections={SECTIONS} />
      <div className="flex-1 min-w-0 space-y-12">

      <AdminSection id="overview">
      {/* ── Notifications ── */}
      {userIsDirector && (
      <AdminSubSection
        sectionId="overview"
        tabId="notifications"
        title="Notifications"
        isDefaultTab
        defaultOpen={false}
        description="Controls which admin push notifications you personally receive (new sub requests, escalations, pending registrations, etc). This only affects your own device — it doesn't change what players or other staff receive."
      >
        <AdminNotificationToggles
          initial={(settings?.admin_notification_prefs as Record<string, boolean> | null) ?? {}}
        />
      </AdminSubSection>
      )}
      </AdminSection>

      <AdminSection id="players-staff">
      {/* ── Players ── */}
      <AdminSubSection
        sectionId="players-staff"
        tabId="players"
        title="Players"
        value={combinedPlayers.length}
        isDefaultTab
        defaultOpen={false}
        description="Every approved and banned player, with MMR, tracker links, staff role, and platform accounts. From here you can edit a player's data, kick or ban them, or reverse a ban — subject to the staff hierarchy."
      >
        <PlayerPanel players={combinedPlayers} actorRole={actorRole} />
        {bannedCount > 0 && (
          <p className="mt-3 text-xs text-red-400/60">{bannedCount} banned player{bannedCount !== 1 ? "s" : ""} shown below active players.</p>
        )}
      </AdminSubSection>

      {/* ── Unregistered / Pending Accounts ── */}
      <AdminSubSection
        sectionId="players-staff"
        tabId="pending-accounts"
        title="Unregistered / Pending Accounts"
        value={guestAccounts.length}
        defaultOpen={false}
        description="Discord accounts that have logged in but never made the roster — unregistered, pending review, rejected, or banned before ever being approved. No MMR or tracker data yet; from here you can kick or ban them, or reverse a ban, subject to the staff hierarchy."
      >
        <GuestAccountPanel accounts={guestAccounts} actorRole={actorRole} />
      </AdminSubSection>
      </AdminSection>

      <AdminSection id="overview">
      {/* ── Team Slots (Director+) ── */}
      {userIsDirector && <AdminSubSection
        sectionId="overview"
        tabId="team-slots"
        title="Team Slots"
        value={(teamSlots ?? []).length}
        defaultOpen={false}
        description="Reserve and order the named team slots that a draft or auto-balance assigns players into, and download every uploaded team logo as one ZIP. Slots exist independently of whether a season is currently active."
      >
        <div className="mb-5">
          <a
            href="/api/admin/download-logos"
            download="team-logos.zip"
            className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-sm font-medium text-zinc-200 rounded-lg transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download All Team Logos
          </a>
          <p className="mt-1.5 text-xs text-zinc-600">Downloads a ZIP of every team logo currently uploaded.</p>
        </div>
        <TeamSlotsManager teams={(teamSlots ?? []) as { id: string; name: string; discord_role_id: string | null; slot_number: number | null }[]} />
      </AdminSubSection>}
      </AdminSection>

      <AdminSection id="match-ops">
      {/* ── Match Reporting ── */}
      <AdminSubSection
        sectionId="match-ops"
        tabId="match-reporting"
        title="Match Reporting"
        value={matchRows.length}
        notification={matchesUnderReviewCount || undefined}
        isDefaultTab
        defaultOpen={false}
        description="Report scores for scheduled matches, including per-game replay uploads that get parsed for scoreboard stats. Only matches with both teams already assigned show up here. The grey count is matches waiting to be reported; the blue count is matches with a submitted replay awaiting identity review."
      >
        <MatchReporter matches={matchRows} />
      </AdminSubSection>

      {/* ── Sub Requests ── */}
      <AdminSubSection
        sectionId="match-ops"
        tabId="sub-requests"
        title="Sub Requests"
        notification={subRequestCards.length}
        defaultOpen={subRequestCards.length > 0}
        description="Substitution requests that a team escalated to admin review, typically because the opposing team didn't accept or reject in time. Review the out/sub player details and approve or deny each one."
      >
        {subRequestCards.length === 0 ? (
          <p className="text-zinc-400 text-sm">No pending sub requests.</p>
        ) : (
          <div className="space-y-4">
            {subRequestCards.map(req => (
              <SubRequestCard key={req.id} request={req} />
            ))}
          </div>
        )}
      </AdminSubSection>
      </AdminSection>

      <AdminSection id="approvals">
      {/* ── Registrations & Platform Claims ── */}
      <AdminSubSection
        sectionId="approvals"
        tabId="registrations-platform"
        title="Registrations & Platform Claims"
        notification={pending.length + platformClaimCards.length}
        isDefaultTab
        defaultOpen={pending.length > 0 || platformClaimCards.length > 0}
        description="New player sign-ups awaiting approval or rejection, plus platform account claims (Steam, Epic, console) awaiting verification. A player needs both an approved registration and, once enforcement is on, a verified account to fully participate."
      >
        {pending.length === 0 && platformClaimCards.length === 0 ? (
          <p className="text-zinc-400 text-sm">No pending registrations or platform account claims.</p>
        ) : (
          <div className="space-y-6">
            {pending.length > 0 && (
              <div className="space-y-4">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pending Registrations</p>
                {pending.map(player => (
                  <RegistrationCard key={player.id} player={player} />
                ))}
              </div>
            )}
            {platformClaimCards.length > 0 && (
              <div className="space-y-4">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Platform Account Claims</p>
                {platformClaimCards.map(claim => (
                  <PlatformAccountClaimCard key={claim.id} claim={claim} />
                ))}
              </div>
            )}
          </div>
        )}
      </AdminSubSection>

      {/* ── Profile Change Requests ── */}
      <AdminSubSection
        sectionId="approvals"
        tabId="profile-changes"
        title="Profile Change Requests"
        notification={playerEditRequestCards.length}
        defaultOpen={playerEditRequestCards.length > 0}
        description="Player-submitted edits to their tracker URL or MMR values, shown alongside their current live values so you can compare before approving or rejecting. Nothing changes on the player's profile until you approve it."
      >
        {playerEditRequestCards.length === 0 ? (
          <p className="text-zinc-400 text-sm">No pending profile change requests.</p>
        ) : (
          <div className="space-y-4">
            {playerEditRequestCards.map(req => (
              <PlayerEditRequestCard key={req.id} request={req} />
            ))}
          </div>
        )}
      </AdminSubSection>

      {/* ── Verified Platform Accounts ── */}
      <AdminSubSection
        sectionId="approvals"
        tabId="verified-platform"
        title="Verified Platform Accounts"
        value={platformVerifiedCards.length}
        defaultOpen={false}
        description="A read-only record of platform accounts that have already passed verification, along with who verified them, when, and by what method (OAuth, replay evidence, or manual admin review)."
      >
        {platformVerifiedCards.length === 0 ? (
          <p className="text-zinc-400 text-sm">No verified platform accounts yet.</p>
        ) : (
          <div className="space-y-2">
            {platformVerifiedCards.map(account => (
              <PlatformAccountVerifiedCard key={account.id} account={account} />
            ))}
          </div>
        )}
      </AdminSubSection>
      </AdminSection>

      <AdminSection id="players-staff">
      {/* ── Identity Discrepancies (Director+) ── */}
      {userIsDirector && (
        <AdminSubSection
          sectionId="players-staff"
          tabId="identity-discrepancies"
          title="Identity Discrepancies"
          notification={identityDiscrepancyCards.length}
          defaultOpen={identityDiscrepancyCards.length > 0}
          description="Flags cases where a submitted replay's platform account doesn't match the expected roster — wrong account, wrong team, or an unverifiable ID. Also houses the identity enforcement and join-gate toggles."
        >
          <div className="mb-4 space-y-2">
            <IdentityEnforcementToggle initialEnabled={identityEnforcementEnabled} />
            <JoinGateToggle initialEnabled={joinGateEnabled} />
          </div>
          {identityDiscrepancyCards.length === 0 ? (
            <p className="text-zinc-400 text-sm">No open identity discrepancies.</p>
          ) : (
            <div className="space-y-4">
              {identityDiscrepancyCards.map(discrepancy => (
                <IdentityDiscrepancyCard key={discrepancy.id} discrepancy={discrepancy} />
              ))}
            </div>
          )}
        </AdminSubSection>
      )}

      {/* ── Staff Management ── */}
      {userIsDirector && <StaffSection userIsCEO={userIsCEO} userIsDirector={userIsDirector} />}
      </AdminSection>

      <AdminSection id="match-ops">
      {/* ── Schedule Approvals ── */}
      <AdminSubSection
        sectionId="match-ops"
        tabId="schedule-approvals"
        title="Schedule Approvals"
        notification={scheduleOverrideCards.length}
        defaultOpen={scheduleOverrideCards.length > 0}
        description="Match times that both teams agreed on outside their normal scheduled window (day, week, or hour). Approve to lock the time in, or reject to send the teams back to propose another."
      >
        {scheduleOverrideCards.length === 0 ? (
          <p className="text-zinc-400 text-sm">No match times awaiting approval.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">
              Both teams agreed on a time outside the scheduled window. Approve to lock it in, or reject to send them back.
            </p>
            {scheduleOverrideCards.map((c) => (
              <ScheduleOverrideCard key={c.matchId} data={c} />
            ))}
          </div>
        )}
      </AdminSubSection>
      </AdminSection>

      <AdminSection id="season-league">
      {/* ── Announcements (Director+) ── */}
      {userIsDirector && (
        <AdminSubSection
          sectionId="season-league"
          tabId="announcements"
          title="Announcements"
          value={settings?.announcement_text ? 1 : undefined}
          isDefaultTab
          defaultOpen={false}
          description="Post a league-wide announcement to the website banner, the configured Discord channel (set via /setannouncement), or both. There's no history; posting replaces whatever is currently live."
        >
          <AnnouncementManager
            initialText={(settings?.announcement_text as string | null) ?? ""}
            initialDestination={(settings?.announcement_destination as "website" | "discord" | "both" | null) ?? "both"}
            channelConfigured={!!settings?.announcement_channel_id}
            postedAt={(settings?.announcement_posted_at as string | null) ?? null}
          />
        </AdminSubSection>
      )}

      {/* ── Scheduling (Director+, visible whenever a season is active) ── */}
      {userIsDirector && seasonActive && (
        <AdminSubSection
          sectionId="season-league"
          tabId="scheduling"
          title="Scheduling"
          notification={schedulingUnscheduledCount || undefined}
          defaultOpen={schedulingUnscheduledCount > 0}
          description="Set the play window and deadline for each round of the active season, per stage. The badge counts rounds that don't have a schedule set yet."
        >
          {schedulingSections.length === 0 ? (
            <p className="text-sm text-zinc-500">No rounds found. Start the season to generate the bracket.</p>
          ) : (
            <RoundScheduler
              tournamentId={activeTournamentId}
              sections={schedulingSections}
              schedules={schedulingSchedules}
              lockedRounds={[...lockedRoundKeys]}
              matchesByRound={matchesByRound}
              playHour={(settings?.match_play_hour as number | null) ?? 19}
              matchDeadlineDay={(settings?.match_deadline_day as number | null) ?? 2}
              round1ManualStartPending={!!settings?.round1_manual_start_pending}
            />
          )}
        </AdminSubSection>
      )}

      {/* ── Tournaments (Director+) ── */}
      {userIsDirector && (
        <AdminSubSection
          sectionId="season-league"
          tabId="tournaments"
          title="Tournaments"
          value={(tournaments ?? []).filter((t: Tournament) => t.status === "scheduled" || t.status === "active").length}
          description="Create and launch standalone tournaments (separate from the main season), track their signup/draft/active phases, and browse the archive of completed seasons and tournaments."
        >
          <Link
            href="/dashboard/admin/view-archive"
            className="inline-block text-sm font-medium text-indigo-400 hover:text-indigo-300 underline underline-offset-2 mb-3"
          >
            View a downloaded archive file →
          </Link>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <a
              href="/api/admin/export-snapshot?format=json"
              download
              className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-300 hover:text-zinc-100 underline underline-offset-2"
            >
              Download live backup (.json) →
            </a>
            <a
              href="/api/admin/export-snapshot?format=csv"
              download
              className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-300 hover:text-zinc-100 underline underline-offset-2"
            >
              Download live backup (.zip of .csv) →
            </a>
            <span className="text-xs text-zinc-600">Full snapshot of every live table, anytime — doesn&apos;t touch or finalize anything.</span>
          </div>
          <TournamentManager
            tournaments={(tournaments ?? []) as Tournament[]}
            seasons={(seasons ?? []) as Season[]}
            hasActive={!!settings?.active_tournament_id}
            testingMode={testingMode}
            sponsors={sponsorOptions}
            designs={designOptions}
          />
        </AdminSubSection>
      )}

      {/* ── Season Settings (Director+) ── */}
      {userIsDirector && <AdminSubSection
        sectionId="season-league"
        tabId="season-settings"
        title="Season Settings"
        description="Configure the season's format, bracket preset, and participant count. These lock automatically once the season goes active, so changes need to happen before it starts."
      >
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
          <div>
            <h3 className="text-sm font-medium text-zinc-400 mb-3">Sponsor</h3>
            <SeasonSponsorPicker
              sponsors={sponsorOptions}
              designs={designOptions}
              initialSponsorId={(settings?.season_sponsor_id as string | null) ?? null}
              initialDesignId={(settings?.season_design_id as string | null) ?? null}
            />
          </div>
        </div>
      </AdminSubSection>}

      {/* ── Draft Pool (Director+) ── */}
      {userIsDirector && (
        <AdminSubSection
          sectionId="season-league"
          tabId="draft-pool"
          title="Draft Pool"
          value={enteredCount + draftPoolTournamentGroups.reduce((n, g) => n + g.playerEntries.length + g.teamSignups.length, 0)}
          defaultOpen={false}
          description="Everyone currently signed up to play — the season's 'Enter Draft' pool plus sign-ups for any scheduled standalone tournaments (player or team mode). Remove an entrant before its draft/tournament starts if they need to be pulled from signups."
        >
          <DraftPoolPanel entries={(draftPoolRows ?? []) as DraftPoolEntry[]} tournamentGroups={draftPoolTournamentGroups} />
        </AdminSubSection>
      )}

      {/* ── League Controls (Director+) ── */}
      {userIsDirector && (
        <AdminSubSection
          sectionId="season-league"
          tabId="league-controls"
          title="League Controls"
          description="Core league-wide toggles: open/close the draft, set match scheduling defaults, MMR floors, and testing mode. These affect every player in the league, not just one section."
        >
          <LeagueControls
            draftOpen={settings?.draft_open ?? false}
            matchDeadlineDay={settings?.match_deadline_day ?? 2}
            matchPlayDay={settings?.match_play_day ?? 0}
            matchPlayHour={settings?.match_play_hour ?? 19}
            minMmr2v2={(settings?.min_mmr_2v2 as number | null) ?? null}
            minMmr3v3={(settings?.min_mmr_3v3 as number | null) ?? null}
            seasonPrize1st={(settings?.season_prize_1st as number | null) ?? null}
            seasonPrize2nd={(settings?.season_prize_2nd as number | null) ?? null}
            seasonPrize3rd4th={(settings?.season_prize_3rd4th as number | null) ?? null}
            draftActive={settings?.draft_active ?? false}
            draftPhase={(settings?.draft_phase as string | null) ?? null}
            hasPickDeadline={!!settings?.pick_deadline}
            seasonActive={seasonActive}
            eventActive={seasonActive || !!settings?.active_tournament_id}
            testingMode={testingMode}
            notificationsEnabled={notificationsEnabled}
            draftCurrentMax={draftCurrentMax}
            teamSlotCount={teamSlotCount}
            draftFormatMax={draftFormatMax}
            seasonFormatLabel={seasonFormatLabel}
            isTestSeason={(settings?.is_test_season as boolean | null) ?? false}
            subsEnabled={(settings?.subs_enabled as boolean | null) ?? true}
            isCEO={userIsCEO}
          />
        </AdminSubSection>
      )}
      </AdminSection>

      {userIsDirector && (
      <AdminSection id="wagers">
      {/* ── Wagers ── */}
      <AdminSubSection
        sectionId="wagers"
        tabId="wagers"
        title="Wagers"
        isDefaultTab
        description="Manage Westside Wages balances: view every approved player's balance, grant or deduct from one player, or adjust everyone at once. Every adjustment is logged below with who made it and why."
      >
        <div className="space-y-6">
          <WagersBalanceTable rows={wagerBalanceRows} />
          <WagersModeToggle currentMode={globalBettingMode} />
          <WagersBulkForm approvedCount={wagerBalanceRows.length} />
          <WagersResetForm approvedCount={wagerBalanceRows.length} />
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Recent Adjustments</p>
            {balanceAdjustmentLog.length === 0 ? (
              <p className="text-sm text-zinc-500">No manual adjustments yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {balanceAdjustmentLog.map(entry => (
                  <div key={entry.batchId} className="text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                    <span className={entry.totalAmount >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {entry.totalAmount >= 0 ? "+" : ""}{entry.totalAmount.toLocaleString()}
                    </span>
                    {" "}
                    {entry.scope === "bulk"
                      ? `to ${entry.playerCount} players`
                      : `to ${playerLabel(entry.singlePlayerId)}`}
                    {" — "}{entry.reason}{" — "}{actorLabel(entry.actor)}{" — "}
                    {new Date(entry.createdAt).toLocaleString()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AdminSubSection>

      {/* ── Flappy Bird Leaderboard ── */}
      <AdminSubSection
        sectionId="wagers"
        tabId="game-leaderboard"
        title="Game Leaderboard"
        defaultOpen={false}
        value={gameScores.length}
        description="Every submitted Flappy Bird score. Remove a score if it looks bogus or exploited."
      >
        <GameLeaderboardPanel scores={gameScores} />
      </AdminSubSection>
      </AdminSection>
      )}

      <AdminSection id="data">
        {/* ── Insights ── */}
        <AdminSubSection
          sectionId="data"
          tabId="insights"
          title="Insights"
          isDefaultTab
          defaultOpen={false}
          description="Weekly trends for site visits, registrations, and draft joins over the last year. Use it to see whether traffic actually converts into sign-ups, and whether sign-ups convert into drafted players."
        >
          <InsightsChart data={insightsData} />
          <div className="mt-6">
            <AnalyticsSummaryCards analyticsRows={analyticsRows ?? []} />
          </div>
        </AdminSubSection>
        <EventOverviewSection
          tournaments={(tournaments ?? []) as Tournament[]}
          seasons={(seasons ?? []) as Season[]}
          sponsorNameById={new Map(sponsorOptions.map((s) => [s.id, s.name]))}
        />
        <TabVisitsSection />
        <PatreonAdminSection userIsDirector={userIsDirector} />
        {userIsDirector && <PatreonTiersAdminSection />}
        {userIsDirector && <PatreonOverrideAdminSection />}
        {userIsDirector && <StorageUsageSection />}
      </AdminSection>

      {userIsDirector && (
        <AdminSection id="sponsors">
          <SponsorsSection patreonUrl={(settings?.patreon_url as string | null) ?? null} />
          <DesignsAdminSection />
          <TabManagerAdminSection />
          <ThemeDesignerAdminSection />
        </AdminSection>
      )}

      </div>
      </div>
    </div>
    </AdminTabsProvider>
  );
}


