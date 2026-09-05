import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { decrypt } from "@/app/lib/session";
import { isModerator } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { ClipOfWeek } from "@/app/dashboard/media/clip-of-week";
import type { Clip } from "@/app/dashboard/media/media-feed";
import DraftCard from "./draft-card";
import { TeamSignupPanel } from "./team-signup-panel";
import { TournamentJoinCard } from "./tournament-join-card";
import { getTeamSignupView, type TeamSignupView } from "./team-signup-data";
import { earlySignupAccessByPlayerId, hasEarlySignupAccess, signupWindowOpen, type SignupWindowRow } from "@/app/lib/signup-window";
import { PastEvents, presetLabel, type PastEvent } from "./past-events";
import { PresetEmblemRow } from "./preset-emblem-row";
import { LocalTime } from "./local-time";
import { TrackerUpdateBanner } from "./tracker-update-banner";
import { AnnouncementBanner } from "./announcement-banner";
import { CountdownLabel } from "./countdown-label";
import { getPublicSponsors } from "@/app/lib/sponsors-public";
import { getPublicDesigns } from "@/app/lib/designs-public";
import { cropStyle } from "@/app/lib/media-crop";
import { buildTimeline, buildStageStarts } from "@/app/lib/tournament-timeline";
import { TournamentDetailView } from "./tournament-detail";
import { SponsoredByLine } from "./sponsored-by-line";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tournament?: string; tab?: string }>;
}) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { tournament: tournamentId, tab } = await searchParams;
  if (tournamentId) {
    return <TournamentDetailView tournamentId={tournamentId} tab={tab} discordId={session.userId} />;
  }

  const [playerRes, settingsRes, draftQueueRes, tournamentsRes, seasonsRes, matchStagesRes, publicSponsors, publicDesigns, moderator] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select("id, status, draft_entered, display_name, must_update_tracker")
      .eq("discord_id", session.userId)
      .single(),
    supabaseAdmin.from("league_settings").select("draft_open, draft_active, season_active, num_teams, season_format, announcement_text, announcement_destination, clip_of_week_id").single(),
    supabaseAdmin
      .from("players")
      .select("id")
      .eq("status", "approved")
      .eq("draft_entered", true)
      .order("draft_entered_at", { ascending: true, nullsFirst: false }),
    supabaseAdmin
      .from("tournaments")
      .select("id, name, status, signups_open, signups_closed, summary, season_format, ended_at, join_mode, team_assignment, draft_open_at, draft_close_at, draft_start_at, season_start_at, hidden_from_home, stage_starts, sponsor_id, design_id, prize_1st, prize_2nd, prize_3rd4th")
      .in("status", ["scheduled", "active", "completed"])
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("seasons")
      .select("id, name, season_format, team_count, summary, ended_at, created_at, hidden_from_home")
      .order("ended_at", { ascending: false }),
    supabaseAdmin
      .from("matches")
      .select("stage, round, status"),
    getPublicSponsors(),
    getPublicDesigns(),
    isModerator(session.userId),
  ]);

  const player = playerRes.data;
  const settings = settingsRes.data;
  type RawClipOfWeekRow = {
    id: string;
    title: string;
    url: string;
    embed_url: string;
    thumbnail_url: string | null;
    platform: Clip["platform"];
    likes_count: number;
    created_at: string;
    players: { discord_id: string; username: string; display_name: string | null } | null;
  };
  const { data: clipOfWeekRow } = settings?.clip_of_week_id
    ? await supabaseAdmin
        .from("clips")
        .select("id, title, url, embed_url, thumbnail_url, platform, likes_count, created_at, players!clips_player_id_fkey(discord_id, username, display_name)")
        .eq("id", settings.clip_of_week_id)
        .single()
    : { data: null as RawClipOfWeekRow | null };
  const rawClipOfWeek = clipOfWeekRow as unknown as RawClipOfWeekRow | null;
  // Read off accounts (Tier 1) rather than the joined players row: every login
  // refreshes the avatar there, while the players copy is frozen at approval.
  const { data: clipAuthor } = rawClipOfWeek?.players?.discord_id
    ? await supabaseAdmin.from("accounts").select("avatar").eq("discord_id", rawClipOfWeek.players.discord_id).single()
    : { data: null as { avatar: string | null } | null };
  const clipOfWeek: Clip | null = rawClipOfWeek
    ? {
        id: rawClipOfWeek.id,
        title: rawClipOfWeek.title,
        url: rawClipOfWeek.url,
        embed_url: rawClipOfWeek.embed_url,
        thumbnail_url: rawClipOfWeek.thumbnail_url,
        platform: rawClipOfWeek.platform,
        likes_count: rawClipOfWeek.likes_count,
        created_at: rawClipOfWeek.created_at,
        submitted_by_username: rawClipOfWeek.players?.username ?? null,
        submitted_by_display_name: rawClipOfWeek.players?.display_name ?? null,
        submitted_by_discord_id: rawClipOfWeek.players?.discord_id ?? null,
        submitted_by_avatar: (clipAuthor?.avatar as string | null) ?? null,
      }
    : null;
  const draftQueue = draftQueueRes.data ?? [];
  const tournaments = tournamentsRes.data ?? [];
  const sponsorById = new Map(publicSponsors.map((s) => [s.id, s]));
  const designById = new Map(publicDesigns.map((d) => [d.id, d]));
  const activeTournament = tournaments.find((t) => t.status === "active") ?? null;
  const pastTournaments = tournaments.filter((t) => t.status === "completed" && !t.hidden_from_home);
  const seasons = (seasonsRes.data ?? []).filter((s) => !s.hidden_from_home);

  type PlayerSnap = { username: string; displayName: string | null };
  type SummaryShape = {
    champion?: string | null;
    runnerUp?: string | null;
    finalStandings?: unknown[];
    championPlayers?: PlayerSnap[];
    runnerUpPlayers?: PlayerSnap[];
  } | null;

  const pastEvents: PastEvent[] = [
    ...pastTournaments.map((t): PastEvent => {
      const summary = t.summary as SummaryShape;
      return {
        id: t.id,
        kind: "tournament",
        name: t.name,
        formatLabel: presetLabel((t.season_format as { preset?: string } | null)?.preset),
        teamCount: summary?.finalStandings?.length ?? null,
        champion: summary?.champion ?? null,
        runnerUp: summary?.runnerUp ?? null,
        championPlayers: summary?.championPlayers ?? [],
        runnerUpPlayers: summary?.runnerUpPlayers ?? [],
        date: t.ended_at ?? null,
      };
    }),
    ...seasons.map((s): PastEvent => {
      const summary = s.summary as SummaryShape;
      return {
        id: s.id,
        kind: "season",
        name: s.name,
        formatLabel: presetLabel((s.season_format as { preset?: string } | null)?.preset),
        teamCount: (s.team_count as number | null) ?? summary?.finalStandings?.length ?? null,
        champion: summary?.champion ?? null,
        runnerUp: summary?.runnerUp ?? null,
        championPlayers: summary?.championPlayers ?? [],
        runnerUpPlayers: summary?.runnerUpPlayers ?? [],
        date: s.ended_at ?? s.created_at ?? null,
      };
    }),
  ]
    .sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0))
    .slice(0, 8);
  const now = Date.now();
  const earlyAccess = await hasEarlySignupAccess(session.userId);
  const openTournaments = tournaments.filter((t) => signupWindowOpen(t as SignupWindowRow, earlyAccess, now));

  // A supporter's Early Signup Access covers everyone they invited, so a
  // team-mode tournament in its early window also has to surface for invitees
  // who aren't supporters themselves — otherwise the invite exists on a card
  // they can't see. Listing is deliberately permissive here; every action
  // re-resolves the window against the specific team's creator.
  const earlyTeamCandidates = tournaments.filter(
    (t) => t.join_mode === "teams" && !openTournaments.includes(t) && signupWindowOpen(t as SignupWindowRow, true, now)
  );
  if (player?.id && earlyTeamCandidates.length) {
    const { data: signupRows } = await supabaseAdmin
      .from("team_signups")
      .select("tournament_id, creator_player_id, team_signup_members(player_id)")
      .in("tournament_id", earlyTeamCandidates.map((t) => t.id));
    const mine = ((signupRows ?? []) as { tournament_id: string; creator_player_id: string; team_signup_members: { player_id: string }[] }[])
      .filter((s) => s.team_signup_members.some((m) => m.player_id === player.id));
    const earlyCreators = await earlySignupAccessByPlayerId(mine.map((s) => s.creator_player_id));
    const unlocked = new Set(mine.filter((s) => earlyCreators.has(s.creator_player_id)).map((s) => s.tournament_id));
    for (const t of earlyTeamCandidates) if (unlocked.has(t.id)) openTournaments.push(t);
  }

  const upcomingTournaments = tournaments.filter((t) =>
    t.status === "scheduled" && !openTournaments.includes(t)
  );
  const isApproved = player?.status === "approved";

  // Player-pool joins: which open tournaments I'm in + pool sizes.
  const openPlayerTs = openTournaments.filter((t) => t.join_mode === "players");
  const openTeamTs = openTournaments.filter((t) => t.join_mode === "teams");

  const [{ data: entries }, teamViewEntries] = await Promise.all([
    openPlayerTs.length
      ? supabaseAdmin
          .from("tournament_entries")
          .select("tournament_id, player_id")
          .in("tournament_id", openPlayerTs.map((t) => t.id))
      : Promise.resolve({ data: [] as { tournament_id: string; player_id: string }[] }),
    isApproved && player?.id
      ? Promise.all(openTeamTs.map(async (t) => [t.id, await getTeamSignupView(player.id, t.id, t as SignupWindowRow, session.userId)] as const))
      : Promise.resolve([] as (readonly [string, TeamSignupView])[]),
  ]);

  const myEntryIds = new Set<string>();
  const poolCounts: Record<string, number> = {};
  for (const e of entries ?? []) {
    poolCounts[e.tournament_id] = (poolCounts[e.tournament_id] ?? 0) + 1;
    if (player?.id && e.player_id === player.id) myEntryIds.add(e.tournament_id);
  }

  // Team-signup views per open team tournament.
  const teamViews: Record<string, TeamSignupView> = Object.fromEntries(teamViewEntries);

  const draftCount = draftQueue.length;
  const signupsOpen = (settings?.draft_open ?? false) && !(settings?.draft_active ?? false) && !(settings?.season_active ?? false);
  const inDraft = player?.draft_entered ?? false;

  // Compute current season stage label from active matches.
  const allMatchStages = matchStagesRes.data ?? [];
  const seasonActive = settings?.season_active ?? false;
  const currentSeasonLabel = seasonActive ? computeSeasonStageLabel(allMatchStages) : null;

  // Active-event card view-model: covers both a tournament-driven active event and a
  // legacy manually-run season (mutually exclusive — a season is only "active" on its
  // own when no tournament is driving it). league_settings.season_format/num_teams are
  // kept in sync for both paths (activateTournamentRuntime mirrors tournament config in),
  // so they're a safe source for format/team-count regardless of which path is live.
  const activeEventName = activeTournament?.name ?? "Season";
  const activeEventPreset =
    (activeTournament?.season_format as { preset?: string } | null)?.preset ??
    (settings?.season_format as { preset?: string } | null)?.preset ??
    null;
  const activeEventTeamCount = settings?.num_teams ?? 0;
  const activeEventSponsorId = (activeTournament as { sponsor_id?: string | null } | null)?.sponsor_id ?? null;
  const activeEventSponsor = activeEventSponsorId ? sponsorById.get(activeEventSponsorId) ?? null : null;
  const activeEventDesignId = (activeTournament as { design_id?: string | null } | null)?.design_id ?? null;
  const activeEventDesign = !activeEventSponsor && activeEventDesignId ? designById.get(activeEventDesignId) ?? null : null;
  const activeEventPrize1st = (activeTournament as { prize_1st?: number | null } | null)?.prize_1st ?? null;
  const activeEventPrize2nd = (activeTournament as { prize_2nd?: number | null } | null)?.prize_2nd ?? null;
  const activeEventPrize3rd4th = (activeTournament as { prize_3rd4th?: number | null } | null)?.prize_3rd4th ?? null;
  const activeEventTotalPrize = (activeEventPrize1st ?? 0) + (activeEventPrize2nd ?? 0) + (activeEventPrize3rd4th ?? 0) * 2;
  const activeEventBackgroundUrl = activeEventSponsor?.background_image_url ?? activeEventDesign?.background_image_url ?? null;
  const activeEventBackgroundCrop = activeEventSponsor?.content_crop?.background ?? activeEventDesign?.content_crop?.background;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2 flex-wrap">
          Dashboard
          <SponsoredByLine tabKey="home" />
        </h1>
        <p className="text-sm text-zinc-400 mt-1">Welcome back, {player?.display_name ?? session.username}</p>
      </div>

      {settings?.announcement_text && settings.announcement_destination !== "discord" && (
        <AnnouncementBanner text={settings.announcement_text} />
      )}

      {player?.must_update_tracker && <TrackerUpdateBanner />}

      <a
        href="https://www.crlw6m.fyi/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-zinc-700 transition-colors"
      >
        <span className="text-sm font-semibold text-white">6 Mans Queue Leaderboard</span>
        <span className="text-zinc-500">↗</span>
      </a>

      <ClipOfWeek clip={clipOfWeek} isModerator={moderator} />

      {/* Active-event card — covers both a tournament-driven active event and a legacy
          manually-run active season (the two are mutually exclusive states of the same
          "what's live right now" concept, so they share one enriched 16:9 card). */}
      {(activeTournament || seasonActive) && (
        <div
          className={`relative aspect-video overflow-hidden border border-indigo-800/40 rounded-xl ${
            activeEventBackgroundUrl ? "" : "bg-gradient-to-tr from-[#744512] to-[#1c1b56]"
          }`}
        >
          {activeEventBackgroundUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeEventBackgroundUrl}
                alt=""
                className="absolute inset-0 w-full h-full"
                style={cropStyle(activeEventBackgroundCrop)}
              />
              <div className="absolute inset-0 bg-black/70" />
            </>
          )}
          <div className="relative h-full overflow-y-auto px-4 py-3 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-[16.5px] font-semibold text-emerald-400 uppercase tracking-wider">
                  {activeTournament ? "Active Tournament" : "Season Active"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {activeEventSponsor?.logo_url && (
                  <div className="relative w-10 h-10 rounded-xl border border-zinc-800 overflow-hidden shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeEventSponsor.logo_url}
                      alt={activeEventSponsor.name}
                      className="absolute inset-0 w-full h-full"
                      style={cropStyle(activeEventSponsor.content_crop?.logo)}
                    />
                  </div>
                )}
                <h2 className="text-3xl font-bold text-white truncate">{activeEventName}</h2>
              </div>
              {seasonActive && currentSeasonLabel ? (
                <p className="text-[21px] text-indigo-300">{currentSeasonLabel}</p>
              ) : (
                activeTournament && (
                  <div className="text-lg text-zinc-400 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                    {activeTournament.draft_start_at && <span>Draft: <LocalTime iso={activeTournament.draft_start_at} /></span>}
                    {activeTournament.season_start_at && <span>Tournament: <LocalTime iso={activeTournament.season_start_at} /></span>}
                  </div>
                )
              )}
              <div className="flex flex-wrap items-end gap-x-4 gap-y-1 text-lg text-zinc-400">
                {activeEventPreset && <PresetEmblemRow preset={activeEventPreset} />}
                {activeEventTeamCount > 0 && <span>{activeEventTeamCount} teams</span>}
              </div>
            </div>
            {activeEventTotalPrize > 0 && (
              <div className="shrink-0 flex flex-col items-center text-center bg-zinc-800/60 border border-amber-700/40 rounded-lg px-4 py-2 min-w-[110px]">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Prize Pool</p>
                <p className="text-xl font-bold text-amber-400 tabular-nums">${activeEventTotalPrize.toLocaleString()}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Season draft block — only when no season is active yet (the active-event card above covers it once it is). */}
      {isApproved && activeTournament?.join_mode !== "teams" && !seasonActive && (
        <div className="space-y-3">
          <h2 className="text-[21px] font-semibold text-zinc-300">Season</h2>
          <DraftCard
            inDraft={inDraft}
            draftCount={draftCount}
            signupsOpen={signupsOpen}
            draftActive={settings?.draft_active ?? false}
            seasonActive={false}
          />
          <Stat label="Draft pool" value={draftCount} />
        </div>
      )}

      {/* Open tournaments you can join */}
      {isApproved && openTournaments.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[21px] font-semibold text-zinc-300">Open Tournaments</h2>
          {openPlayerTs.map((t) => {
            const timeline = buildTimeline(t);
            const nextEvent = timeline.find((i) => new Date(i.iso).getTime() > now) ?? timeline[timeline.length - 1] ?? null;
            const sponsorId = (t as { sponsor_id?: string | null }).sponsor_id ?? null;
            const sponsor = sponsorId ? sponsorById.get(sponsorId) : null;
            const designId = (t as { design_id?: string | null }).design_id ?? null;
            const design = !sponsor && designId ? designById.get(designId) ?? null : null;
            return (
              <TournamentJoinCard
                key={t.id}
                id={t.id}
                name={t.name}
                poolCount={poolCounts[t.id] ?? 0}
                joined={myEntryIds.has(t.id)}
                teamAssignment={t.team_assignment as "snake_draft" | "auto_balance" | null}
                timeline={timeline}
                countdown={nextEvent}
                prize1st={(t as { prize_1st?: number | null }).prize_1st ?? null}
                prize2nd={(t as { prize_2nd?: number | null }).prize_2nd ?? null}
                prize3rd4th={(t as { prize_3rd4th?: number | null }).prize_3rd4th ?? null}
                minMmr2v2={(t as { min_mmr_2v2?: number | null }).min_mmr_2v2 ?? null}
                minMmr3v3={(t as { min_mmr_3v3?: number | null }).min_mmr_3v3 ?? null}
                linkHref={`/dashboard?tournament=${t.id}`}
                sponsor={sponsor}
                fallbackBackgroundUrl={design?.background_image_url ?? null}
                fallbackBackgroundCrop={design?.content_crop?.background}
              />
            );
          })}
          {openTeamTs.map((t) => {
            if (!teamViews[t.id]) return null;
            const timeline = buildTimeline(t);
            const nextEvent = timeline.find((i) => new Date(i.iso).getTime() > now) ?? timeline[timeline.length - 1] ?? null;
            const sponsorId = (t as { sponsor_id?: string | null }).sponsor_id ?? null;
            const sponsor = sponsorId ? sponsorById.get(sponsorId) : null;
            const designId = (t as { design_id?: string | null }).design_id ?? null;
            const design = !sponsor && designId ? designById.get(designId) ?? null : null;
            return (
              <TeamSignupPanel
                key={t.id}
                view={teamViews[t.id]}
                tournamentId={t.id}
                tournamentName={t.name}
                timeline={timeline}
                countdown={nextEvent}
                prize1st={(t as { prize_1st?: number | null }).prize_1st ?? null}
                prize2nd={(t as { prize_2nd?: number | null }).prize_2nd ?? null}
                prize3rd4th={(t as { prize_3rd4th?: number | null }).prize_3rd4th ?? null}
                linkHref={`/dashboard?tournament=${t.id}`}
                sponsor={sponsor}
                fallbackBackgroundUrl={design?.background_image_url ?? null}
                fallbackBackgroundCrop={design?.content_crop?.background}
              />
            );
          })}
        </div>
      )}

      {/* Upcoming tournaments (not yet open) */}
      {upcomingTournaments.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[21px] font-semibold text-zinc-300">Upcoming Tournaments</h2>
          {upcomingTournaments.map((t) => {
            const items = buildTimeline(t, true);
            const nextEvent = items.find((i) => new Date(i.iso).getTime() > now) ?? items[items.length - 1] ?? null;
            const preset = (t.season_format as { preset?: string } | null)?.preset ?? null;
            const stageStarts = buildStageStarts(
              (t as { stage_starts?: Record<string, string> | null }).stage_starts ?? null,
              preset
            );
            const sponsorId = (t as { sponsor_id?: string | null }).sponsor_id ?? null;
            const sponsor = sponsorId ? sponsorById.get(sponsorId) : null;
            const designId = (t as { design_id?: string | null }).design_id ?? null;
            const design = !sponsor && designId ? designById.get(designId) ?? null : null;
            const prize1st = (t as { prize_1st?: number | null }).prize_1st ?? null;
            const prize2nd = (t as { prize_2nd?: number | null }).prize_2nd ?? null;
            const prize3rd4th = (t as { prize_3rd4th?: number | null }).prize_3rd4th ?? null;
            const totalPrizePool = (prize1st ?? 0) + (prize2nd ?? 0) + (prize3rd4th ?? 0) * 2;
            const backgroundUrl = sponsor?.background_image_url ?? design?.background_image_url ?? null;
            const backgroundCrop = sponsor?.content_crop?.background ?? design?.content_crop?.background;
            return (
              <Link
                key={t.id}
                href={`/dashboard?tournament=${t.id}`}
                className={`relative aspect-video overflow-hidden border border-zinc-800 rounded-xl transition-all duration-200 hover:-translate-y-1 hover:border-amber-500/50 hover:shadow-[0_10px_28px_-8px_rgba(232,138,36,0.4)] cursor-pointer block ${backgroundUrl ? "" : "bg-zinc-900"}`}
              >
                {backgroundUrl && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={backgroundUrl}
                      alt=""
                      className="absolute inset-0 w-full h-full"
                      style={cropStyle(backgroundCrop)}
                    />
                    <div className="absolute inset-0 bg-black/70" />
                  </>
                )}
                <div className="relative h-full overflow-y-auto px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      {sponsor?.logo_url && (
                        <div className="relative w-12 h-12 rounded-xl border border-zinc-800 overflow-hidden shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={sponsor.logo_url}
                            alt={sponsor.name}
                            className="absolute inset-0 w-full h-full"
                            style={cropStyle(sponsor.content_crop?.logo)}
                          />
                        </div>
                      )}
                      <p className="text-4xl font-bold text-white truncate">{t.name}</p>
                    </div>
                    {nextEvent && <CountdownLabel label={nextEvent.label} iso={nextEvent.iso} />}
                    {items.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {items.map(({ label, iso }) => (
                          <span key={label} className="text-[13.5px] text-zinc-500">
                            {label}: <LocalTime iso={iso} className="text-zinc-400" />
                          </span>
                        ))}
                      </div>
                    )}
                    {preset && <PresetEmblemRow preset={preset} className="text-lg" />}
                    {stageStarts.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {stageStarts.map(({ label, iso }) => (
                          <span key={label} className="text-[13.5px] text-zinc-500">
                            {label} starts: <LocalTime iso={iso} className="text-zinc-400" />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-center text-center bg-zinc-800/60 border border-amber-700/40 rounded-lg px-4 py-2 min-w-[120px]">
                    <p className="text-[15px] uppercase tracking-wide text-zinc-500">Prize Pool</p>
                    <p className="text-[27px] font-bold text-amber-400 tabular-nums">${totalPrizePool.toLocaleString()}</p>
                    {totalPrizePool > 0 && (
                      <div className="mt-1 text-[16.5px] text-zinc-400 space-y-0.5">
                        <p>1st: <span className="text-zinc-200">${(prize1st ?? 0).toLocaleString()}</span></p>
                        <p>2nd: <span className="text-zinc-200">${(prize2nd ?? 0).toLocaleString()}</span></p>
                        <p>3rd-4th: <span className="text-zinc-200">${(prize3rd4th ?? 0).toLocaleString()}</span></p>
                      </div>
                    )}
                  </div>
                </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <PastEvents events={pastEvents} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
    </div>
  );
}

type MatchStageRow = { stage: string | null; round: number | null; status: string | null };

function computeSeasonStageLabel(matches: MatchStageRow[]): string | null {
  if (!matches.length) return null;

  // Prefer scheduled matches; fall back to completed to show the last active stage.
  const scheduled = matches.filter((m) => m.status === "scheduled" && m.stage && m.round != null);
  const pool = scheduled.length ? scheduled : matches.filter((m) => m.stage && m.round != null);
  if (!pool.length) return null;

  // Current stage = the one with the most matches in the pool.
  const stageCounts: Record<string, number> = {};
  for (const m of pool) if (m.stage) stageCounts[m.stage] = (stageCounts[m.stage] ?? 0) + 1;
  const currentStage = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!currentStage) return null;

  const stageMatches = pool.filter((m) => m.stage === currentStage);
  const currentRound = Math.max(...stageMatches.map((m) => m.round ?? 0));

  // Max round ever seen for this stage (for SE tier labeling).
  const allForStage = matches.filter((m) => m.stage === currentStage);
  const maxRound = Math.max(...allForStage.map((m) => m.round ?? 0));

  return stageLabel(currentStage, currentRound, maxRound);
}

function stageLabel(stage: string, round: number, maxRound: number): string {
  if (stage.startsWith("group_")) return `Group Stage, Round ${round}`;
  if (stage === "swiss") return `Swiss, Round ${round}`;
  if (stage === "single_elimination") return `Single Elimination — ${seTierLabel(round, maxRound)}`;
  if (stage === "de_winners") return `Winners Bracket, Round ${round}`;
  if (stage === "de_losers") return `Losers Bracket, Round ${round}`;
  if (stage === "de_grand_final") return "Grand Final";
  if (stage === "hybrid_ub" || stage === "hybrid8_ub") return `Upper Bracket, Round ${round}`;
  if (stage === "hybrid_lb" || stage === "hybrid8_lb") return `Lower Bracket, Round ${round}`;
  if (stage === "hybrid_sf" || stage === "hybrid8_sf") return "Semi Finals";
  if (stage === "hybrid_gf" || stage === "hybrid8_gf") return "Grand Final";
  return stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function seTierLabel(round: number, maxRound: number): string {
  const fromFinal = maxRound - round;
  if (fromFinal === 0) return "Finals";
  if (fromFinal === 1) return "Semi Finals";
  if (fromFinal === 2) return "Quarter Finals";
  return `Round ${round}`;
}
