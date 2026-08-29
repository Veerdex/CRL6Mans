import Link from "next/link";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getTeamSignupView } from "./team-signup-data";
import { TeamSignupPanel } from "./team-signup-panel";
import { TournamentJoinCard } from "./tournament-join-card";
import { LocalTime } from "./local-time";
import { CountdownLabel } from "./countdown-label";
import { RulesContent } from "./rules/rules-content";
import { tournamentRulesContext } from "./rules/rules-filter";
import { PresetEmblemRow } from "./preset-emblem-row";
import { getPublicSponsors, type PublicSponsor } from "@/app/lib/sponsors-public";
import { getPublicDesigns, type PublicDesign } from "@/app/lib/designs-public";
import { SponsorCard } from "@/app/lib/sponsor-display";
import { cropStyle, type MediaCrop } from "@/app/lib/media-crop";
import { buildTimeline, buildStageStarts } from "@/app/lib/tournament-timeline";
import { stageEmblem } from "@/app/lib/format-emblems";
import { playerRatingFromRow, initialTeamRating } from "@/app/lib/rating";
import { isDirectorVerified } from "@/app/lib/players";
import { TeamRatingList, type TeamRatingRow } from "./team-rating-list";
import { PlayerName } from "./player-name";
import {
  PRESETS,
  STAGE_SLOTS_BY_PRESET,
  TIER_LABELS,
  TIER_ORDER,
  stageDescription,
  type SeasonFormatConfig,
  type StageSlotKey,
} from "./season/format-constants";

// tournament-manager.tsx's computeStageSchedule() writes stage_starts under
// these legacy keys instead of the canonical StageSlotKey values above —
// checked as a fallback so tournaments saved before this mapping existed
// still resolve a start time.
const LEGACY_STAGE_KEY: Partial<Record<StageSlotKey, string>> = {
  group: "groups",
  single_elimination: "bracket",
  double_elimination: "bracket",
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "rules", label: "Rules" },
  { id: "draft", label: "Draft" },
  { id: "format", label: "Format" },
  { id: "sponsor", label: "Sponsor" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type SummaryShape = {
  champion?: string | null;
  runnerUp?: string | null;
  finalStandings?: unknown[];
  championPlayers?: { username: string; displayName: string | null }[];
  runnerUpPlayers?: { username: string; displayName: string | null }[];
} | null;

export async function TournamentDetailView({
  tournamentId,
  tab: rawTab,
  discordId,
}: {
  tournamentId: string;
  tab: string | undefined;
  discordId: string;
}) {
  const tab: TabId = TABS.some((tb) => tb.id === rawTab) ? (rawTab as TabId) : "overview";

  const [{ data: t }, { data: settings }, { data: player }, publicSponsors, publicDesigns, canEditRules] = await Promise.all([
    supabaseAdmin
      .from("tournaments")
      .select(
        "id, name, status, join_mode, team_assignment, signups_open, draft_open_at, draft_close_at, draft_start_at, season_start_at, season_format, stage_starts, sponsor_id, design_id, prize_1st, prize_2nd, prize_3rd4th, min_mmr_2v2, min_mmr_3v3, summary"
      )
      .eq("id", tournamentId)
      .maybeSingle(),
    supabaseAdmin.from("league_settings").select("active_tournament_id, draft_active, season_active").single(),
    supabaseAdmin.from("players").select("id, status").eq("discord_id", discordId).maybeSingle(),
    getPublicSponsors(),
    getPublicDesigns(),
    isDirectorVerified(discordId),
  ]);

  if (!t) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-4">
        <p className="text-sm text-zinc-500">Tournament not found.</p>
        <Link href="/dashboard" className="text-indigo-400 hover:underline text-sm">← Back to Home</Link>
      </div>
    );
  }

  const playerId = player?.id ?? null;
  const isApproved = player?.status === "approved";
  const isCurrentActive = t.status === "active" && settings?.active_tournament_id === t.id;
  const format = t.season_format as SeasonFormatConfig | null;
  const preset = format?.preset ?? null;
  const presetDef = preset ? PRESETS.find((p) => p.id === preset) ?? null : null;
  const stageSlots = preset ? STAGE_SLOTS_BY_PRESET[preset] : [];
  const stageEntries = stageSlots.map((slot, i) => ({ slot, stageType: presetDef!.stageTypes[i] }));
  const hasPlayoffs =
    presetDef?.stageTypes.includes("single_elimination") ||
    presetDef?.stageTypes.includes("double_elimination") ||
    false;
  const rulesContext = tournamentRulesContext(
    { join_mode: t.join_mode, team_assignment: t.team_assignment, min_mmr_2v2: t.min_mmr_2v2, min_mmr_3v3: t.min_mmr_3v3 },
    hasPlayoffs
  );
  const stageStartsRaw = (t.stage_starts as Record<string, string> | null) ?? {};
  const sponsor = t.sponsor_id ? (publicSponsors.find((s) => s.id === t.sponsor_id) ?? null) : null;
  const design: PublicDesign | null = !sponsor && t.design_id ? (publicDesigns.find((d) => d.id === t.design_id) ?? null) : null;
  const backgroundUrl = sponsor?.background_image_url ?? design?.background_image_url ?? null;
  const backgroundCrop = sponsor?.content_crop?.background ?? design?.content_crop?.background;

  const now = Date.now();
  const withinDraftWindow =
    !!t.draft_open_at &&
    now >= new Date(t.draft_open_at).getTime() &&
    (!t.draft_close_at || now < new Date(t.draft_close_at).getTime());
  const registrationOpen = t.status === "scheduled" && (!!t.signups_open || withinDraftWindow);

  const timeline = buildTimeline(t, true);
  const nextEvent = timeline.find((i) => new Date(i.iso).getTime() > now) ?? timeline[timeline.length - 1] ?? null;
  const stageStarts = buildStageStarts(t.stage_starts as Record<string, string> | null, preset);
  const totalPrizePool = (t.prize_1st ?? 0) + (t.prize_2nd ?? 0) + (t.prize_3rd4th ?? 0) * 2;
  const summary = t.summary as SummaryShape;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-6">
      <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-300">← Back to Home</Link>

      <div className="relative overflow-hidden border border-zinc-800 rounded-xl px-4 py-3">
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
        <div className="relative flex items-center gap-3">
          {sponsor?.logo_url && (
            <div className="relative w-10 h-10 rounded-xl border border-zinc-800 overflow-hidden shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sponsor.logo_url}
                alt={sponsor.name}
                className="absolute inset-0 w-full h-full"
                style={cropStyle(sponsor.content_crop?.logo)}
              />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-white">{t.name}</h1>
            <span
              className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                t.status === "active"
                  ? "bg-emerald-900/40 border-emerald-700/50 text-emerald-300"
                  : t.status === "completed"
                  ? "bg-amber-900/40 border-amber-700/50 text-amber-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}
            >
              {t.status}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-800">
        {TABS.filter((tb) => tb.id !== "sponsor" || sponsor).map((tb) => (
          <Link
            key={tb.id}
            href={`/dashboard?tournament=${tournamentId}&tab=${tb.id}`}
            prefetch
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === tb.id ? "border-amber-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tb.label}
          </Link>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          {isCurrentActive && (
            <div className="bg-gradient-to-tr from-[#744512] to-[#1c1b56] border border-indigo-800/40 rounded-xl p-5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-[13.75px] font-semibold text-emerald-400 uppercase tracking-wider">
                  {settings?.season_active ? "Season Active" : settings?.draft_active ? "Draft Active" : "Getting Started"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {settings?.draft_active && (
                  <Link href="/dashboard/draft" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[17.5px] font-medium rounded-lg">
                    Go to Live Draft
                  </Link>
                )}
                {settings?.season_active && (
                  <Link href="/dashboard/season" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[17.5px] font-medium rounded-lg">
                    View Season
                  </Link>
                )}
              </div>
            </div>
          )}

          {t.status === "scheduled" &&
            (t.join_mode === "teams" ? (
              <TeamsRegistration
                tournamentId={tournamentId}
                tournamentName={t.name}
                playerId={playerId}
                registrationOpen={registrationOpen}
                timeline={timeline}
                nextEvent={nextEvent}
                prize1st={t.prize_1st}
                prize2nd={t.prize_2nd}
                prize3rd4th={t.prize_3rd4th}
                sponsor={sponsor}
                fallbackBackgroundUrl={design?.background_image_url ?? null}
                fallbackBackgroundCrop={design?.content_crop?.background}
              />
            ) : (
              <PlayersRegistration
                tournamentId={tournamentId}
                teamAssignment={t.team_assignment as "snake_draft" | "auto_balance" | null}
                playerId={playerId}
                isApproved={isApproved}
                registrationOpen={registrationOpen}
                timeline={timeline}
                nextEvent={nextEvent}
                prize1st={t.prize_1st}
                prize2nd={t.prize_2nd}
                prize3rd4th={t.prize_3rd4th}
                minMmr2v2={t.min_mmr_2v2}
                minMmr3v3={t.min_mmr_3v3}
                name={t.name}
                sponsor={sponsor}
                fallbackBackgroundUrl={design?.background_image_url ?? null}
                fallbackBackgroundCrop={design?.content_crop?.background}
              />
            ))}

          {t.status === "completed" ? (
            summary?.champion ? (
              <div className="bg-zinc-900 border border-amber-700/40 rounded-xl p-4">
                <p className="text-[17.5px] text-amber-300">🏆 {summary.champion}</p>
                {summary.runnerUp && <p className="text-[15px] text-zinc-500 mt-1">2nd: {summary.runnerUp}</p>}
              </div>
            ) : (
              <p className="text-[17.5px] text-zinc-500">No champion recorded.</p>
            )
          ) : (
            <>
              {nextEvent && (
                <CountdownLabel label={nextEvent.label} iso={nextEvent.iso} className="text-[17.5px] font-semibold text-amber-400" />
              )}
              {timeline.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  {timeline.map(({ label, iso }) => (
                    <span key={label} className="text-[15px] text-zinc-500">
                      {label}: <LocalTime iso={iso} className="text-zinc-400" />
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-3 text-[17.5px]">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
              <p className="text-[12.5px] uppercase tracking-wide text-zinc-500">Format</p>
              {preset ? <PresetEmblemRow preset={preset} className="mt-1" /> : <p className="text-white mt-0.5">—</p>}
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
              <p className="text-[12.5px] uppercase tracking-wide text-zinc-500">Team Assignment</p>
              <p className="text-white mt-0.5">
                {t.join_mode === "teams" ? "Pre-formed teams" : t.team_assignment === "auto_balance" ? "Auto-balanced" : "Snake draft"}
              </p>
            </div>
          </div>

          {(t.min_mmr_2v2 || t.min_mmr_3v3) && (
            <p className="text-[15px] text-zinc-500">
              Req:{" "}
              {[t.min_mmr_2v2 ? `${t.min_mmr_2v2} 2v2` : null, t.min_mmr_3v3 ? `${t.min_mmr_3v3} 3v3` : null]
                .filter(Boolean)
                .join(" or ")}{" "}
              peak MMR
            </p>
          )}

          {stageStarts.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {stageStarts.map(({ label, iso }) => (
                <span key={label} className="text-[15px] text-zinc-500">
                  {label} starts: <LocalTime iso={iso} className="text-zinc-400" />
                </span>
              ))}
            </div>
          )}

          {totalPrizePool > 0 && (
            <div className="bg-zinc-800/60 border border-amber-700/40 rounded-lg px-4 py-3 max-w-xs">
              <p className="text-[12.5px] uppercase tracking-wide text-zinc-500">Prize Pool</p>
              <p className="text-[22.5px] font-bold text-amber-400 tabular-nums">${totalPrizePool.toLocaleString()}</p>
              <div className="mt-1 text-[13.75px] text-zinc-400 space-y-0.5">
                <p>1st: <span className="text-zinc-200">${(t.prize_1st ?? 0).toLocaleString()}</span></p>
                <p>2nd: <span className="text-zinc-200">${(t.prize_2nd ?? 0).toLocaleString()}</span></p>
                <p>3rd-4th: <span className="text-zinc-200">${(t.prize_3rd4th ?? 0).toLocaleString()}</span></p>
              </div>
            </div>
          )}

          {sponsor && (
            <Link
              href={`/dashboard?tournament=${tournamentId}&tab=sponsor`}
              className="flex items-center gap-2 text-[15px] text-zinc-500 hover:text-zinc-300 transition-colors pt-1"
            >
              <span>Sponsored by</span>
              {sponsor.logo_url && (
                <span className="relative w-5 h-5 rounded overflow-hidden border border-zinc-800 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={sponsor.logo_url}
                    alt=""
                    className="absolute inset-0 w-full h-full"
                    style={cropStyle(sponsor.content_crop?.logo)}
                  />
                </span>
              )}
              <span className="text-white font-medium">{sponsor.name}</span>
            </Link>
          )}
        </div>
      )}

      {tab === "rules" && (
        <div className="space-y-10 text-zinc-300">
          <RulesContent canEdit={canEditRules} context={rulesContext} />
        </div>
      )}

      {tab === "draft" &&
        (t.join_mode === "teams" ? (
          <TeamsDraftPool tournamentId={tournamentId} />
        ) : (
          <PlayersDraftPool tournamentId={tournamentId} />
        ))}

      {tab === "format" && (
        <div className="space-y-4">
          {isCurrentActive && (
            <div className="bg-gradient-to-tr from-[#744512] to-[#1c1b56] border border-indigo-800/40 rounded-xl p-5 space-y-2">
              <p className="text-sm text-zinc-300">This tournament is live — follow the bracket and standings here.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {settings?.draft_active && (
                  <Link href="/dashboard/draft" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg">
                    Go to Live Draft
                  </Link>
                )}
                {settings?.season_active && (
                  <Link href="/dashboard/season" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg">
                    View Season
                  </Link>
                )}
              </div>
            </div>
          )}

          {t.season_start_at && (
            <p className="text-sm text-zinc-300">
              Tournament starts: <LocalTime iso={t.season_start_at} className="text-white font-medium" />
            </p>
          )}

          {presetDef ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <p className="text-sm font-semibold text-white">{presetDef.name}</p>
              <p className="text-xs text-zinc-500 mt-1">{presetDef.description}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Format not set yet.</p>
          )}

          {stageEntries.length > 0 && (
            <div className="space-y-3">
              {stageEntries.map(({ slot, stageType }, i) => {
                const legacyKey = LEGACY_STAGE_KEY[slot.key];
                const startIso =
                  stageStartsRaw[slot.key] ??
                  (legacyKey ? stageStartsRaw[legacyKey] : null) ??
                  (i === 0 ? t.season_start_at : null) ??
                  null;
                const boConfig = format?.roundBestOf?.[slot.key];
                const groupDetails =
                  stageType === "group"
                    ? [
                        format?.groupRounds ? `${format.groupRounds} rounds` : null,
                        format?.groupMaxAdvancing ? `top ${format.groupMaxAdvancing} advance` : null,
                        format?.groupSeedingMethod ? `${format.groupSeedingMethod} seeding` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "";
                return (
                  <div key={slot.key} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex flex-col items-center gap-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={stageEmblem(preset!, slot.key)} alt="" className="w-[60px] h-[60px] rounded-lg" />
                        <p className="text-[21px] font-semibold text-white">{slot.label}</p>
                      </div>
                      {startIso ? (
                        <LocalTime iso={startIso} className="text-xs text-zinc-400" />
                      ) : (
                        <span className="text-xs text-zinc-600">Start time TBD</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">{stageDescription(slot.key, stageType)}</p>
                    {groupDetails && <p className="text-xs text-zinc-500">{groupDetails}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t border-zinc-800">
                      {boConfig?.mode === "flat" ? (
                        <span className="text-xs text-zinc-400">
                          All matches: <span className="text-amber-400 font-medium">Best of {boConfig.value}</span>
                        </span>
                      ) : boConfig?.mode === "tiered" ? (
                        TIER_ORDER.map((tier) => (
                          <span key={tier} className="text-xs text-zinc-400">
                            {TIER_LABELS[tier]}: <span className="text-amber-400 font-medium">Bo{boConfig.tiers[tier]}</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-zinc-600">Best-of not set</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {t.status === "completed" && (summary?.champion || (summary?.finalStandings?.length ?? 0) > 0) && (
            <div className="bg-zinc-900 border border-amber-700/40 rounded-xl p-4 space-y-2">
              {summary!.champion && <p className="text-sm text-amber-300">🏆 Champion: {summary!.champion}</p>}
              {summary!.runnerUp && <p className="text-sm text-zinc-400">2nd: {summary!.runnerUp}</p>}
              {(summary!.finalStandings?.length ?? 0) > 0 && (
                <p className="text-xs text-zinc-500">{summary!.finalStandings!.length} teams competed</p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "sponsor" && sponsor && (
        <div className="space-y-4">
          <SponsorCard sponsor={sponsor} />
        </div>
      )}
    </div>
  );
}

async function PlayersRegistration({
  tournamentId,
  teamAssignment,
  playerId,
  isApproved,
  registrationOpen,
  timeline,
  nextEvent,
  prize1st,
  prize2nd,
  prize3rd4th,
  minMmr2v2,
  minMmr3v3,
  name,
  sponsor = null,
  fallbackBackgroundUrl = null,
  fallbackBackgroundCrop,
}: {
  tournamentId: string;
  teamAssignment: "snake_draft" | "auto_balance" | null;
  playerId: string | null;
  isApproved: boolean;
  registrationOpen: boolean;
  timeline: { label: string; iso: string }[];
  nextEvent: { label: string; iso: string } | null;
  prize1st: number | null;
  prize2nd: number | null;
  prize3rd4th: number | null;
  minMmr2v2: number | null;
  minMmr3v3: number | null;
  name: string;
  sponsor?: PublicSponsor | null;
  fallbackBackgroundUrl?: string | null;
  fallbackBackgroundCrop?: MediaCrop;
}) {
  const { data: entryRows } = await supabaseAdmin
    .from("tournament_entries")
    .select("player_id")
    .eq("tournament_id", tournamentId);
  const entryIds = (entryRows ?? []).map((e) => e.player_id as string);
  const joined = !!playerId && entryIds.includes(playerId);

  return isApproved && registrationOpen ? (
    <TournamentJoinCard
      id={tournamentId}
      name={name}
      poolCount={entryIds.length}
      joined={joined}
      teamAssignment={teamAssignment}
      timeline={timeline}
      countdown={nextEvent}
      prize1st={prize1st}
      prize2nd={prize2nd}
      prize3rd4th={prize3rd4th}
      minMmr2v2={minMmr2v2}
      minMmr3v3={minMmr3v3}
      sponsor={sponsor}
      fallbackBackgroundUrl={fallbackBackgroundUrl}
      fallbackBackgroundCrop={fallbackBackgroundCrop}
    />
  ) : (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <p className="text-[17.5px] text-white">{entryIds.length} in the pool</p>
      <p className="text-[15px] text-zinc-500 mt-1">
        {teamAssignment === "auto_balance" ? "Teams are auto-balanced from the pool." : "Teams are formed via a live snake draft."}
      </p>
    </div>
  );
}

type RawEntryRow = {
  player_id: string;
  players: { id: string; username: string; display_name: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string } | null;
};

async function PlayersDraftPool({ tournamentId }: { tournamentId: string }) {
  const { data: entryRows } = await supabaseAdmin
    .from("tournament_entries")
    .select("player_id, players(id, username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3)")
    .eq("tournament_id", tournamentId);
  const ratedPlayers = ((entryRows ?? []) as unknown as RawEntryRow[])
    .filter((e) => e.players)
    .map((e) => ({
      playerId: e.players!.id,
      username: e.players!.username,
      displayName: e.players!.display_name,
      rating: playerRatingFromRow(e.players!),
    }))
    .sort((a, b) => b.rating - a.rating);

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">In the Draft</h3>
      {ratedPlayers.length === 0 ? (
        <p className="text-sm text-zinc-500">No players have entered the draft yet.</p>
      ) : (
        <div className="space-y-1.5">
          {ratedPlayers.map((p, i) => (
            <div key={p.playerId} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
              <span className="text-xs text-zinc-600 w-5 shrink-0">{i + 1}</span>
              <PlayerName displayName={p.displayName} username={p.username} className="text-white flex-1" />
              <span className="text-amber-400 font-medium tabular-nums text-xs">{Math.round(p.rating)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function TeamsRegistration({
  tournamentId,
  tournamentName,
  playerId,
  registrationOpen,
  timeline,
  nextEvent,
  prize1st,
  prize2nd,
  prize3rd4th,
  sponsor = null,
  fallbackBackgroundUrl = null,
  fallbackBackgroundCrop,
}: {
  tournamentId: string;
  tournamentName: string;
  playerId: string | null;
  registrationOpen: boolean;
  timeline: { label: string; iso: string }[];
  nextEvent: { label: string; iso: string } | null;
  prize1st: number | null;
  prize2nd: number | null;
  prize3rd4th: number | null;
  sponsor?: PublicSponsor | null;
  fallbackBackgroundUrl?: string | null;
  fallbackBackgroundCrop?: MediaCrop;
}) {
  const view = playerId ? await getTeamSignupView(playerId, tournamentId, registrationOpen) : null;

  return view ? (
    <TeamSignupPanel
      view={view}
      tournamentId={tournamentId}
      tournamentName={tournamentName}
      timeline={timeline}
      countdown={nextEvent}
      prize1st={prize1st}
      prize2nd={prize2nd}
      prize3rd4th={prize3rd4th}
      sponsor={sponsor}
      fallbackBackgroundUrl={fallbackBackgroundUrl}
      fallbackBackgroundCrop={fallbackBackgroundCrop}
    />
  ) : (
    <p className="text-[17.5px] text-zinc-500">Sign in and get approved to register a team.</p>
  );
}

type RawSignupRowWithPlayers = {
  id: string;
  name: string;
  team_signup_members: {
    player_id: string;
    status: "invited" | "accepted";
    players: { username: string; display_name: string | null; peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string } | null;
  }[];
};

async function TeamsDraftPool({ tournamentId }: { tournamentId: string }) {
  const { data: signupsRaw } = await supabaseAdmin
    .from("team_signups")
    .select("id, name, team_signup_members(player_id, status, players(username, display_name, peak_2v2, current_2v2, peak_3v3, current_3v3))")
    .eq("tournament_id", tournamentId);
  const signups = (signupsRaw ?? []) as unknown as RawSignupRowWithPlayers[];

  const ratedTeams: TeamRatingRow[] = signups
    .map((s) => {
      const members = s.team_signup_members.map((m) => ({
        playerId: m.player_id,
        username: m.players?.username ?? "Unknown",
        displayName: m.players?.display_name ?? null,
        rating: m.players ? playerRatingFromRow(m.players) : 0,
        status: m.status,
      }));
      const acceptedRatings = members.filter((m) => m.status === "accepted").map((m) => m.rating);
      return { id: s.id, name: s.name, rating: initialTeamRating(acceptedRatings), members };
    })
    .sort((a, b) => b.rating - a.rating);

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">In the Draft</h3>
      {ratedTeams.length === 0 ? (
        <p className="text-sm text-zinc-500">No teams have registered yet.</p>
      ) : (
        <TeamRatingList teams={ratedTeams} />
      )}
    </div>
  );
}
