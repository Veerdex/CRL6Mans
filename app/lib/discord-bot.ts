import { supabaseAdmin } from "./supabase";
import { isModerator, isDirector, isCEO, isCurrentlyKicked } from "./players";
import { pushToAllApproved, pushToTeam } from "./push";
import { ptDate, ptWallToUtc } from "./pt-time";
import { addRole, removeRole, addRoleById, removeRoleById, ensureRoles, editRole, sendChannelMessage, getGuildRoles, stripRolesFromUsers, stripRoleIdsFromMembers, getGuildChannels, createTextChannel, deleteChannel, createCategory, positionCategoryAfter, banMember, timeoutMember } from "./discord-api";
import {
  nextMatchNumber, nextSlot,
  DE_WINNERS, DE_LOSERS, DE_GF,
  DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS,
  HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF,
  HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF,
  wbLoserTarget, lbWinnerTarget,
  getRoundName, GROUP_STAGE_PREFIX, parseGroupNum,
} from "./bracket";
import { buildAndSaveBracket } from "./bracket-server";
import { teamRatingFromRVs, applyRatingUpdate } from "./rating";
import { hasBlockingIdentityDiscrepancy } from "./replay-identity-certification";
import { STAGE_ORDER, canonicalStage } from "@/app/dashboard/admin/schedule-utils";

async function roleMentionByName(
  teamName: string,
  roles: Array<{ id: string; name: string }>,
): Promise<string> {
  const role = roles.find((r) => r.name === teamName);
  return role ? `<@&${role.id}>` : `**${teamName}**`;
}

type Option = { name: string; value: string | number | boolean; focused?: boolean };
// Discord nests a subcommand's own options one level deeper, under the subcommand entry
// itself — e.g. for `/admin disconnect confirm:...`, data.options[0] is `{ name: "disconnect",
// options: [{ name: "confirm", value: "..." }] }`.
type SubOption = Option & { options?: Option[] };
type Interaction = {
  channel_id?: string;
  channel?: { id: string; name?: string };
  data: {
    name?: string;
    options?: SubOption[];
    custom_id?: string;
    components?: Array<{ type: number; components: Array<{ custom_id: string; value: string }> }>;
  };
  member?: { user: { id: string } };
  user?: { id: string };
};

const reply = (content: string) => ({ type: 4, data: { content } });
// Visible only to the invoking user — used for every /admin subcommand so staff-only
// output (role IDs, checklist gaps, disconnect/wipe results) never leaks into the channel.
const ephemeralReply = (content: string) => ({ type: 4, data: { content, flags: 64 } });

// Pace Discord channel/category create & delete operations so bulk work (season
// start, /openround, and especially match simulation) stays under Discord's
// per-guild rate limits instead of firing them all at once.
const DISCORD_PACE_MS = 350;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));


function getUserId(i: Interaction) {
  return i.member?.user.id ?? i.user?.id ?? "";
}

function optFrom(options: SubOption[] | undefined, name: string): string | number | boolean {
  return options?.find((o) => o.name === name)?.value ?? "";
}

function opt(i: Interaction, name: string): string | number | boolean {
  return optFrom(i.data.options, name);
}

// For a top-level `/admin <subcommand>` invocation, resolves which subcommand was
// picked and that subcommand's own options (Discord nests them one level deeper).
function adminSubcommand(i: Interaction): { name: string; opts: SubOption[] } {
  const sub = i.data.options?.[0];
  return { name: sub?.name ?? "", opts: sub?.options ?? [] };
}

async function adminGuard(userId: string) {
  if (!(await isModerator(userId))) return ephemeralReply("❌ You don't have permission to use this command.");
  return null;
}

async function directorGuard(userId: string) {
  if (!(await isDirector(userId))) return ephemeralReply("❌ This command requires Director permissions or higher.");
  return null;
}

async function ceoGuard(userId: string) {
  if (!(await isCEO(userId))) return ephemeralReply("❌ This command requires CEO permissions.");
  return null;
}

// Stores the Discord role ID for a staff tier so the bot can @mention/ping that
// role — e.g. notifying moderators when a sub request is escalated.
const STAFF_ROLE_ID_COLUMN = {
  moderator: "moderator_role_id",
  director: "director_role_id",
  ceo: "ceo_role_id",
} as const;

async function setStaffRoleId(userId: string, roleId: string, tier: "moderator" | "director" | "ceo") {
  const denied = await adminGuard(userId);
  if (denied) return denied;
  if (!roleId) return ephemeralReply("❌ You must specify a role.");
  const { error } = await supabaseAdmin.from("league_settings")
    .update({ [STAFF_ROLE_ID_COLUMN[tier]]: roleId, updated_at: new Date().toISOString() })
    .not("id", "is", null);
  if (error) return ephemeralReply(`❌ Failed to save: ${error.message}`);
  const title = tier === "ceo" ? "CEO" : tier === "director" ? "Director" : "Moderator";
  return ephemeralReply(`✅ ${title} role set to <@&${roleId}>. The bot will use it for staff pings.`);
}

// Stores the role granted on registration approval (and stripped on ban). Until
// this is set the bot resolves a role named "Registered" by name instead.
async function setRegisteredRoleId(userId: string, roleId: string) {
  const denied = await adminGuard(userId);
  if (denied) return denied;
  if (!roleId) return ephemeralReply("❌ You must specify a role.");
  const { error } = await supabaseAdmin.from("league_settings")
    .update({ registered_role_id: roleId, updated_at: new Date().toISOString() })
    .not("id", "is", null);
  if (error) return ephemeralReply(`❌ Failed to save: ${error.message}`);
  return ephemeralReply(
    `✅ Registered role set to <@&${roleId}>. Players will get it when their registration is approved.\n` +
    `Make sure the bot's own role is **above** it in the server's role list, or Discord will reject the assignment.`
  );
}

// Returns a Unix timestamp (seconds) for the next occurrence of targetDay at hour:minute PT.
// Approximates PT as UTC-7 (PDT). Off by 1h during PST but acceptable for scheduling.
function nextWeekdayTimestamp(targetDay: number, hourPT: number, minutePT: number): number {
  return weekdayTimestampFrom(Date.now(), targetDay, hourPT, minutePT);
}

// Same as nextWeekdayTimestamp but anchored from a caller-supplied base time (ms).
// Used when a match has a known scheduled_at so the play/deadline times are always
// computed relative to the intended schedule rather than the current wall clock.
function weekdayTimestampFrom(baseMs: number, targetDay: number, hourPT: number, minutePT: number): number {
  const basePT = ptDate(baseMs);
  const currentDay = basePT.getUTCDay();
  let daysAhead = (targetDay - currentDay + 7) % 7;
  if (daysAhead === 0) {
    const past = basePT.getUTCHours() > hourPT ||
      (basePT.getUTCHours() === hourPT && basePT.getUTCMinutes() >= minutePT);
    if (past) daysAhead = 7;
  }
  const utcMs = ptWallToUtc(basePT.getUTCFullYear(), basePT.getUTCMonth(), basePT.getUTCDate() + daysAhead, hourPT, minutePT);
  return Math.floor(utcMs / 1000);
}

type ChannelResult = { created: true } | { created: false; skipped?: true; error?: string };

const BEST_OF_DEFAULTS: Record<string, number> = { standard: 3, quarterfinals: 3, semifinals: 3, finals: 3 };

export function getTier(round: number, totalRounds: number): string {
  const fromFinal = totalRounds - round;
  if (fromFinal === 0) return "finals";
  if (fromFinal === 1) return "semifinals";
  if (fromFinal === 2) return "quarterfinals";
  return "standard";
}

export function validateSeriesScore(home: number, away: number, bestOf: number): string | null {
  const winsNeeded = Math.ceil(bestOf / 2);
  if (Math.max(home, away) !== winsNeeded)
    return `Invalid BO${bestOf} score — the winning team must have exactly ${winsNeeded} wins.`;
  return null;
}

export async function getBestOfForMatch(matchId: string): Promise<number> {
  const [{ data: match }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("matches").select("stage, round").eq("id", matchId).single(),
    supabaseAdmin.from("league_settings").select("season_format").single(),
  ]);
  const format = settings?.season_format as { roundBestOf?: Record<string, number>; best_of?: number } | null;
  const roundBestOf = format?.roundBestOf ?? {};
  if (!match?.stage) return format?.best_of ?? 3;
  if (match.stage.startsWith("hybrid")) return 7; // hybrid bracket is always BO7
  const { data: stageRows } = await supabaseAdmin
    .from("matches").select("round").eq("stage", match.stage);
  const maxRound = Math.max(...(stageRows ?? []).map((m: { round: number }) => m.round), match.round);
  const tier = getTier(match.round, maxRound);
  return roundBestOf[tier] ?? BEST_OF_DEFAULTS[tier] ?? format?.best_of ?? 3;
}

type MatchChannelContext = {
  categoryCache: Map<string, string>; // label → discord_category_id
  deadlineDay: number;
  playDay: number;
  playHour: number;
  rulesChannelId: string | null;
  categoryAnchorId: string | null; // category new match-stage categories get placed right after; null = default to bottom
  existingChannels: Array<{ id: string; name: string; parent_id?: string | null; type?: number; position?: number }>;
  guildRoles: Array<{ id: string; name: string }>;
  roundBestOf: Record<string, number>;
  maxRoundByStage: Record<string, number>;
  staffRoleIds: string[]; // moderator/director/ceo Discord role IDs — can view all match channels
  isTournament: boolean;
};

// Same deterministic 5-char code as match-schedule-panel.tsx — both sides see the same lobby credentials.
function lobbyCode(seed: string): string {
  const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 5; i++) {
    h = Math.imul(h, 16777619) >>> 0;
    out += CHARS[h % CHARS.length];
  }
  return out;
}

async function getStaffRoleIds(): Promise<string[]> {
  const map = await getStaffRoleIdMap();
  return [map.moderator, map.director, map.ceo].filter((id): id is string => !!id);
}

// Per-tier lookup (as opposed to getStaffRoleIds' flat list) so callers can add/remove
// the Discord role matching a specific staff_roles change.
export async function getStaffRoleIdMap(): Promise<Record<"moderator" | "director" | "ceo", string | null>> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("moderator_role_id, director_role_id, ceo_role_id")
    .single();
  return {
    moderator: (data?.moderator_role_id as string | null) ?? null,
    director: (data?.director_role_id as string | null) ?? null,
    ceo: (data?.ceo_role_id as string | null) ?? null,
  };
}

// ─── Dynamic category management ──────────────────────────────────────────────

// Compute the Discord category label and Swiss bucket string for a match.
function computeCategoryInfo(
  stage: string,
  round: number,
  maxRoundByStage: Record<string, number>,
  swissWins = 0,
  swissLosses = 0,
): { label: string; bucket: string | null; categoryRound: number | null } {
  // Group stage — one category per group per round (created week by week)
  if (stage.startsWith(GROUP_STAGE_PREFIX)) {
    const g = parseGroupNum(stage) ?? stage.replace(GROUP_STAGE_PREFIX, "");
    return { label: `Group ${g} - Round ${round}`, bucket: null, categoryRound: round };
  }

  // Swiss — one category per win-loss bucket per round
  if (stage === "swiss") {
    const bucket = `${swissWins}-${swissLosses}`;
    return { label: `Swiss ${bucket}`, bucket, categoryRound: round };
  }

  // Single elimination
  if (stage === "single_elimination") {
    const totalRounds = maxRoundByStage[stage] ?? round;
    const name = getRoundName(totalRounds, round);
    return { label: name, bucket: null, categoryRound: round };
  }

  // DE Winners
  if (stage === DE_WINNERS) {
    const totalRounds = maxRoundByStage[stage] ?? round;
    const name = getRoundName(totalRounds, round);
    return { label: `Winners ${name}`, bucket: null, categoryRound: round };
  }

  // DE Losers
  if (stage === DE_LOSERS) {
    const totalRounds = maxRoundByStage[stage] ?? round;
    const fromEnd = totalRounds - round;
    let name: string;
    if (fromEnd === 0)      name = "Losers Finals";
    else if (fromEnd === 1) name = "Losers Semifinals";
    else if (fromEnd === 2) name = "Losers Quarterfinals";
    else                    name = `Losers Round ${round}`;
    return { label: name, bucket: null, categoryRound: round };
  }

  // DE Grand Final
  if (stage === DE_GF) {
    return { label: "Grand Final", bucket: null, categoryRound: null };
  }

  // DE Qualifier Winners
  if (stage === DE_QUALIFIER_WINNERS) {
    const totalRounds = maxRoundByStage[stage] ?? round;
    const name = getRoundName(totalRounds, round);
    return { label: `Qualifier Winners ${name}`, bucket: null, categoryRound: round };
  }

  // DE Qualifier Losers
  if (stage === DE_QUALIFIER_LOSERS) {
    const totalRounds = maxRoundByStage[stage] ?? round;
    const fromEnd = totalRounds - round;
    let name: string;
    if (fromEnd === 0)      name = "Qualifier Losers Finals";
    else if (fromEnd === 1) name = "Qualifier Losers Semifinals";
    else                    name = `Qualifier Losers Round ${round}`;
    return { label: name, bucket: null, categoryRound: round };
  }

  // Hybrid upper bracket — always one round
  if (stage === HYBRID_UB || stage === HYBRID8_UB) {
    return { label: "Upper Bracket", bucket: null, categoryRound: round };
  }

  // Hybrid lower bracket — round number determines the label
  if (stage === HYBRID_LB || stage === HYBRID8_LB) {
    return { label: `Lower Bracket R${round}`, bucket: null, categoryRound: round };
  }

  // Hybrid semifinals
  if (stage === HYBRID_SF || stage === HYBRID8_SF) {
    return { label: "Semifinals", bucket: null, categoryRound: null };
  }

  // Hybrid grand final
  if (stage === HYBRID_GF || stage === HYBRID8_GF) {
    return { label: "Grand Final", bucket: null, categoryRound: null };
  }

  // SE Qualifier
  return { label: `SE Qualifier Round ${round}`, bucket: null, categoryRound: round };
}

// Get the Swiss record (wins, losses) for a team in completed Swiss matches before a given round.
async function getSwissRecord(teamId: string, beforeRound: number): Promise<{ wins: number; losses: number }> {
  const { data } = await supabaseAdmin
    .from("matches")
    .select("home_team_id, home_score, away_score")
    .eq("stage", "swiss")
    .eq("status", "completed")
    .lt("round", beforeRound)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
  let wins = 0, losses = 0;
  for (const m of data ?? []) {
    const isHome = m.home_team_id === teamId;
    const myScore = isHome ? m.home_score : m.away_score;
    const theirScore = isHome ? m.away_score : m.home_score;
    if ((myScore ?? 0) > (theirScore ?? 0)) wins++; else losses++;
  }
  return { wins, losses };
}

// Look up or create a Discord category, storing it in the DB for lifecycle tracking.
// Uses categoryCache (in MatchChannelContext) to avoid redundant API calls during bulk creation.
async function getOrCreateStageCategory(
  label: string,
  stage: string,
  categoryRound: number | null,
  bucket: string | null,
  categoryCache: Map<string, string>,
  categoryAnchorId: string | null,
  existingChannels: Array<{ id: string; type?: number; position?: number }>,
): Promise<string | null> {
  // Check in-memory cache first
  const cached = categoryCache.get(label);
  if (cached) return cached;

  // Check DB
  let q = supabaseAdmin
    .from("match_discord_categories")
    .select("discord_category_id")
    .eq("stage", stage);
  if (categoryRound !== null) q = q.eq("round", categoryRound); else q = q.is("round", null);
  if (bucket !== null) q = q.eq("bucket", bucket); else q = q.is("bucket", null);
  const { data: existing } = await q.maybeSingle();
  if (existing?.discord_category_id) {
    categoryCache.set(label, existing.discord_category_id);
    return existing.discord_category_id;
  }

  // Create via Discord API
  const result = await createCategory(label);
  if (!result.id) {
    console.error("[getOrCreateStageCategory]", result.error);
    return null;
  }

  // Save to DB
  await supabaseAdmin.from("match_discord_categories").insert({
    discord_category_id: result.id,
    label,
    stage,
    round: categoryRound,
    bucket,
  });

  // If an anchor is configured, place the new category right after it. No anchor → leave
  // Discord's default append-to-bottom placement untouched.
  if (categoryAnchorId) {
    const anchor = existingChannels.find(c => c.id === categoryAnchorId);
    if (anchor?.position !== undefined) {
      await positionCategoryAfter(result.id, anchor.position);
    }
  }

  categoryCache.set(label, result.id);
  return result.id;
}

// After a match completes, check if ALL matches in its stage+round are done.
// If so, delete all channels in every Discord category for that round, then delete the categories.
export async function cleanupStageCategoryIfComplete(stage: string, round: number): Promise<void> {
  const { count } = await supabaseAdmin
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("stage", stage)
    .eq("round", round)
    .neq("status", "completed");
  if (count !== 0) return;

  const { data: cats } = await supabaseAdmin
    .from("match_discord_categories")
    .select("id, discord_category_id")
    .eq("stage", stage)
    .eq("round", round);
  if (!cats?.length) return;

  const catDiscordIds = new Set(cats.map(c => c.discord_category_id));
  const allChannels = await getGuildChannels();
  const toDelete = allChannels.filter(c => c.parent_id && catDiscordIds.has(c.parent_id));

  // Delete all channels inside these categories, then the categories themselves —
  // sequentially and paced to avoid Discord rate limits during bulk simulation.
  let channelFailures = 0;
  for (const c of toDelete) {
    const ok = await deleteChannel(c.id);
    if (!ok) channelFailures++;
    await sleep(DISCORD_PACE_MS);
  }
  if (channelFailures > 0)
    console.error(`[cleanupStageCategoryIfComplete] stage=${stage} round=${round}: ${channelFailures}/${toDelete.length} channel deletions failed`);
  for (const id of catDiscordIds) {
    await deleteChannel(id);
    await sleep(DISCORD_PACE_MS);
  }

  // Remove from DB
  await supabaseAdmin.from("match_discord_categories").delete().in("id", cats.map(c => c.id));
}

// Deletes ALL dynamically-created match categories and their channels. Used on season reset.
export async function deleteAllMatchCategories(): Promise<number> {
  const { data: cats } = await supabaseAdmin
    .from("match_discord_categories")
    .select("id, discord_category_id");
  if (!cats?.length) return 0;

  const catDiscordIds = new Set(cats.map(c => c.discord_category_id));
  const allChannels = await getGuildChannels();
  const toDelete = allChannels.filter(c => c.parent_id && catDiscordIds.has(c.parent_id));

  await Promise.all(toDelete.map(c => deleteChannel(c.id)));
  await Promise.all([...catDiscordIds].map(id => deleteChannel(id)));
  await supabaseAdmin.from("match_discord_categories").delete().not("id", "is", null);

  return cats.length;
}

// Creates a private Discord channel for a match and posts the welcome message.
// Pass a pre-fetched ctx to avoid redundant API calls when creating multiple channels.
export async function createMatchChannel(
  homeTeamName: string,
  awayTeamName: string,
  weekNum: number,
  ctx?: MatchChannelContext,
  matchInfo?: { round: number; stage: string; homeTeamId?: string; awayTeamId?: string; matchId?: string; scheduledAt?: string | null; adminScheduled?: boolean },
): Promise<ChannelResult> {
  let resolvedCtx: MatchChannelContext;

  if (ctx) {
    resolvedCtx = ctx;
  } else {
    const { data: settings } = await supabaseAdmin
      .from("league_settings")
      .select("match_deadline_day, match_play_day, match_play_hour, rules_channel_id, match_category_anchor_id, season_format, active_tournament_id")
      .single();
    const format = settings?.season_format as { roundBestOf?: Record<string, number> } | null;
    const [existingChannels, guildRoles, allMatches, staffRoleIds] = await Promise.all([
      getGuildChannels(),
      getGuildRoles(),
      supabaseAdmin.from("matches").select("stage, round").then(r => r.data ?? []),
      getStaffRoleIds(),
    ]);
    const maxRoundByStage: Record<string, number> = {};
    allMatches.forEach(m => {
      maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
    });
    resolvedCtx = {
      categoryCache: new Map(),
      deadlineDay: settings?.match_deadline_day ?? 2,
      playDay:     settings?.match_play_day   ?? 0,
      playHour:    settings?.match_play_hour  ?? 19,
      rulesChannelId: settings?.rules_channel_id ?? null,
      categoryAnchorId: settings?.match_category_anchor_id ?? null,
      existingChannels,
      guildRoles,
      roundBestOf: format?.roundBestOf ?? {},
      maxRoundByStage,
      staffRoleIds,
      isTournament: !!(settings?.active_tournament_id as string | null | undefined),
    };
  }

  const { categoryCache, deadlineDay, playDay, playHour, rulesChannelId, categoryAnchorId, existingChannels, guildRoles, roundBestOf, maxRoundByStage, staffRoleIds, isTournament } = resolvedCtx;

  // Determine which Discord category this match belongs to
  let categoryId: string | null = null;
  if (matchInfo) {
    let swissWins = 0, swissLosses = 0;
    if (matchInfo.stage === "swiss" && matchInfo.homeTeamId) {
      const rec = await getSwissRecord(matchInfo.homeTeamId, matchInfo.round);
      swissWins = rec.wins;
      swissLosses = rec.losses;
    }
    const { label, bucket, categoryRound } = computeCategoryInfo(
      matchInfo.stage, matchInfo.round, maxRoundByStage, swissWins, swissLosses
    );
    categoryId = await getOrCreateStageCategory(label, matchInfo.stage, categoryRound, bucket, categoryCache, categoryAnchorId, existingChannels);
  }

  const channelName = `${homeTeamName}-vs-${awayTeamName}`
    .toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 100);

  if (existingChannels.some(c => c.name === channelName && (categoryId ? c.parent_id === categoryId : true))) {
    return { created: false, skipped: true };
  }

  // Ensure team roles exist (creates them if missing, e.g. when using test teams)
  let homeRole = guildRoles.find(r => r.name === homeTeamName);
  let awayRole = guildRoles.find(r => r.name === awayTeamName);
  if (!homeRole || !awayRole) {
    const needed = [homeTeamName, awayTeamName].filter(n => !guildRoles.find(r => r.name === n));
    await ensureRoles(needed);
    const refreshed = await getGuildRoles();
    homeRole = refreshed.find(r => r.name === homeTeamName);
    awayRole = refreshed.find(r => r.name === awayTeamName);
  }
  const allowedRoleIds = [homeRole?.id, awayRole?.id, ...staffRoleIds].filter(Boolean) as string[];

  const result = await createTextChannel(channelName, categoryId, allowedRoleIds);
  if (!result.id) return { created: false, error: result.error };

  // Record channel ID on the match for targeted cleanup
  if (matchInfo?.matchId) {
    await supabaseAdmin.from("matches")
      .update({ discord_channel_id: result.id })
      .eq("id", matchInfo.matchId);
  }

  // Use the match's scheduled_at when it's set and in the future so that early
  // completions in prior rounds don't pull next-round timestamps into the same week.
  const scheduledMs = matchInfo?.scheduledAt ? new Date(matchInfo.scheduledAt).getTime() : 0;
  const useScheduled = scheduledMs > Date.now();
  const playTs = useScheduled
    ? Math.floor(scheduledMs / 1000)
    : nextWeekdayTimestamp(playDay, playHour, 0);
  const baseMs = useScheduled ? scheduledMs : Date.now();
  let deadlineTs = weekdayTimestampFrom(baseMs, deadlineDay, 23, 59);
  // If the deadline landed before the play time (weekday wrap-around), push it one week forward.
  if (deadlineTs < playTs) deadlineTs += 7 * 24 * 3600;

  // Home/Away match the match record (home_team_id = the seeded/scheduled home team).
  const homePing = homeRole ? `<@&${homeRole.id}>` : `**${homeTeamName}**`;
  const awayPing = awayRole ? `<@&${awayRole.id}>` : `**${awayTeamName}**`;
  const rulesRef = rulesChannelId ? `<#${rulesChannelId}>` : "the rulebook";

  let bestOf = 3;
  if (matchInfo) {
    if (matchInfo.stage.startsWith("hybrid")) {
      bestOf = 7; // hybrid bracket is always BO7
    } else {
      const totalRounds = maxRoundByStage[matchInfo.stage] ?? matchInfo.round;
      const tier = getTier(matchInfo.round, totalRounds);
      bestOf = roundBestOf[tier] ?? BEST_OF_DEFAULTS[tier] ?? 3;
    }
  }

  // For standalone seasons, look up this round's admin schedule so the message matches
  // the schedule type (range/specific) and uses its real deadline.
  let scheduleType: string | null = null;
  let rangeDays: number | null = null;
  let realPlayTs = playTs;
  let realDeadlineTs = deadlineTs;
  if (matchInfo && !isTournament) {
    const cs = matchInfo.stage.startsWith("group_") ? "group" : matchInfo.stage;
    const { data: sched } = await supabaseAdmin
      .from("round_schedules")
      .select("schedule_type, play_at, deadline_at, range_days")
      .is("tournament_id", null)
      .eq("stage", cs)
      .eq("round", matchInfo.round)
      .maybeSingle();
    if (sched) {
      scheduleType = sched.schedule_type as string;
      rangeDays = sched.range_days as number | null;
      realPlayTs = Math.floor(new Date(sched.play_at as string).getTime() / 1000);
      realDeadlineTs = Math.floor(new Date(sched.deadline_at as string).getTime() / 1000);
    }
    // An admin-pinned individual match overrides the round window with its fixed time.
    if (matchInfo.adminScheduled && matchInfo.scheduledAt) {
      scheduleType = "specific";
      realPlayTs = Math.floor(new Date(matchInfo.scheduledAt).getTime() / 1000);
      realDeadlineTs = realPlayTs;
    }
  }

  let message: string;
  if (isTournament && matchInfo?.matchId) {
    const lobbyName = lobbyCode(`${matchInfo.matchId}:name`);
    const lobbyPw   = lobbyCode(`${matchInfo.matchId}:pw`);
    message =
      `## Welcome! ##\n\n` +
      `Match: ${homePing} 🏠 **Home**  vs  ${awayPing} ✈️ **Away**\n` +
      `Format: **Best of ${bestOf}**\n\n` +
      `**Private Match Lobby** — ${awayPing} (Away) creates the lobby:\n` +
      `> Room Name: \`${lobbyName}\`\n` +
      `> Password: \`${lobbyPw}\`\n\n` +
      `- **To report a match**: Head to the website and submit your result under My Team.`;
  } else {
    let scheduleLines: string;
    let coordinateLine: string;
    if (scheduleType === "specific") {
      scheduleLines = `Scheduled for: <t:${realPlayTs}:F>`;
      coordinateLine = `- This is a fixed time set by the admins — please be ready to play then.`;
    } else if (scheduleType === "range" && (rangeDays ?? 1) <= 1) {
      scheduleLines = `Play any time on: <t:${realPlayTs}:D>\nMatch Deadline (end of day): <t:${realDeadlineTs}:F>`;
      coordinateLine = `- This match must be played on this day — coordinate a time that works for both teams.`;
    } else if (scheduleType === "custom") {
      scheduleLines = (rangeDays ?? 1) <= 1
        ? `Window: <t:${realPlayTs}:D>\nMatch Deadline (end of day): <t:${realDeadlineTs}:F>`
        : `Window: between <t:${realPlayTs}:D> and <t:${realDeadlineTs}:D>\nMatch Deadline: <t:${realDeadlineTs}:F>`;
      coordinateLine = `- This match requires admin approval — an admin will confirm your match time individually.`;
    } else if (scheduleType === "weekly") {
      scheduleLines = `Play any time this week: <t:${realPlayTs}:D> to <t:${realDeadlineTs}:D>\nMatch Deadline: <t:${realDeadlineTs}:F>`;
      coordinateLine = `- Coordinate a time that works for both teams sometime this week, before the deadline.`;
    } else {
      // multi-day range / fallback
      scheduleLines = `Play any time between <t:${realPlayTs}:D> and <t:${realDeadlineTs}:D>, before the deadline.\nMatch Deadline: <t:${realDeadlineTs}:F>`;
      coordinateLine = `- Coordinate a time that works for both teams before the match deadline.`;
    }

    message =
      `## Welcome to Round ${weekNum}! ##\n\n` +
      `Match: ${homePing} 🏠 **Home**  vs  ${awayPing} ✈️ **Away**\n` +
      `${scheduleLines}\n` +
      `Format: **Best of ${bestOf}**\n\n` +
      `${coordinateLine}\n` +
      `- If a sub is needed, please follow what is listed in the rulebook located in ${rulesRef}. ` +
      `If these procedures are not followed, a match played with the illegal sub will be forfeited.\n` +
      `- **To report a match**: Head to the website and submit your result under My Team.`;
  }

  await sendChannelMessage(result.id, message);
  return { created: true };
}

// Deletes all dynamic match categories (and their channels) created during the season.
// Also handles channels tracked on individual match rows and the legacy match_category_id.
export async function deleteMatchChannels(): Promise<number> {
  let deleted = 0;

  // Delete all dynamically-created stage categories (primary path)
  deleted += await deleteAllMatchCategories();

  // Fallback: also delete any channels stored directly on match rows — catches anything
  // the category table missed (e.g. if a category DB write failed mid-creation).
  const { data: matchRows } = await supabaseAdmin
    .from("matches")
    .select("discord_channel_id")
    .not("discord_channel_id", "is", null);
  const orphanIds = (matchRows ?? []).map(m => m.discord_channel_id as string).filter(Boolean);
  if (orphanIds.length > 0) {
    await Promise.all(orphanIds.map(id => deleteChannel(id).catch(() => {})));
    await supabaseAdmin.from("matches").update({ discord_channel_id: null }).not("id", "is", null);
    deleted += orphanIds.length;
  }

  // Legacy: also clear any channels from the legacy single match_category_id (backward compat)
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("match_category_id").single();
  const legacyCategoryId = settings?.match_category_id;
  if (legacyCategoryId) {
    const channels = await getGuildChannels();
    const legacyChannels = channels.filter(c => c.parent_id === legacyCategoryId);
    await Promise.all(legacyChannels.map(c => deleteChannel(c.id)));
    deleted += legacyChannels.length;
  }

  return deleted;
}

// Snake draft: picks go N, N-1, ..., 1, 1, 2, ..., N, ...
function getTeamNumberForPick(pickIndex: number, numTeams: number): number {
  const pickInRound = pickIndex % numTeams;
  const roundIndex = Math.floor(pickIndex / numTeams);
  return roundIndex % 2 === 0 ? numTeams - pickInRound : pickInRound + 1;
}

function rankValue(p: { peak_2v2: string; current_2v2: string; peak_3v3: string; current_3v3: string }) {
  return (
    (Number(p.peak_2v2) + Number(p.current_2v2)) * 1.2 +
    (Number(p.peak_3v3) + Number(p.current_3v3)) * 0.8
  ) / 4;
}

// ── Season rating calculator ──────────────────────────────────────────────────
// Model: crl-game-share-elo-v1. Pure math lives in app/lib/rating.ts (shared
// with the wager predictor); this layer only reads/writes season_rating.
// Full spec: wagers-prediction-explainer.txt

// Lazy-initialises a team's season_rating from its current roster RVs.
async function initTeamSeasonRating(teamId: string): Promise<number> {
  const { data: players } = await supabaseAdmin
    .from("players")
    .select("peak_2v2, current_2v2, peak_3v3, current_3v3")
    .eq("team_id", teamId)
    .eq("status", "approved");
  const rvs = (players ?? []).map((p) => rankValue(p as Parameters<typeof rankValue>[0]));
  return teamRatingFromRVs(rvs);
}

// Applies the game-share Elo update to both teams after a series result.
// homeScore/awayScore are games won in the series; the update is exactly
// zero-sum, so goal differential no longer feeds the rating.
async function applySeasonRatingUpdate(
  homeTeamId: string,
  awayTeamId: string,
  homeRatingRaw: number | null,
  awayRatingRaw: number | null,
  homeScore: number,
  awayScore: number,
): Promise<void> {
  const [hRating, aRating] = await Promise.all([
    homeRatingRaw != null ? Promise.resolve(Number(homeRatingRaw)) : initTeamSeasonRating(homeTeamId),
    awayRatingRaw != null ? Promise.resolve(Number(awayRatingRaw)) : initTeamSeasonRating(awayTeamId),
  ]);

  const { newRatingA: newHome, newRatingB: newAway } = applyRatingUpdate(
    hRating, aRating, homeScore, awayScore,
  );

  await Promise.all([
    supabaseAdmin.from("teams").update({ season_rating: newHome }).eq("id", homeTeamId),
    supabaseAdmin.from("teams").update({ season_rating: newAway }).eq("id", awayTeamId),
  ]);
}

async function getTeamByPosition(position: number, fields = "id"): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin.from("teams")
    .select(fields).not("slot_number", "is", null).order("slot_number");
  return ((data as unknown as Record<string, unknown>[]) ?? [])[position - 1] ?? null;
}

async function getCaptainPing(teamNum: number): Promise<string> {
  const team = await getTeamByPosition(teamNum, "id");
  if (!team) return `**Team ${teamNum}**`;
  const { data: cap } = await supabaseAdmin.from("players")
    .select("discord_id, username").eq("team_id", team.id).eq("is_captain", true).single();
  if (!cap) return `**Team ${teamNum}**`;
  return cap.discord_id ? `<@${cap.discord_id}>` : `**${cap.username}**`;
}

// ─── Exported core execution functions (no admin check, used from web admin too) ─

export async function execStartDraft(maxTeams?: number | "max" | null): Promise<{ ok: boolean; message: string }> {
  const { data: settings } = await supabaseAdmin.from("league_settings").select("*").single();
  if (!settings?.draft_channel_id)
    return { ok: false, message: "Set a draft channel first with `/setdraftchannel`." };
  if (settings.draft_active)
    return { ok: false, message: "❌ A draft is already in progress. Use `/enddraft` first." };
  if (settings.season_active)
    return { ok: false, message: "❌ A season is currently active. End the season before starting a new draft." };

  const { data: enteredAll } = await supabaseAdmin
    .from("players")
    .select("id, username, discord_id, peak_2v2, current_2v2, peak_3v3, current_3v3, draft_entered_at")
    .eq("status", "approved")
    .eq("draft_entered", true)
    .order("draft_entered_at", { ascending: true, nullsFirst: false });

  if (!enteredAll?.length) return { ok: false, message: "No players have entered the draft." };

  // Validate pre-created team slots (identified by slot_number, not current name)
  const { data: allPreTeams } = await supabaseAdmin
    .from("teams").select("id, name, discord_role_id, slot_number").not("slot_number", "is", null).order("slot_number");
  const numberedTeams = (allPreTeams ?? [])
    .filter((t): t is typeof t & { slot_number: number } => typeof t.slot_number === "number")
    .map(t => ({ ...t, num: t.slot_number }))
    .sort((a, b) => a.num - b.num);

  // numTeams resolution:
  //  • a positive number caps the team count (admin-specified max),
  //  • "max" builds as many as the pool (3 per team) and slots allow,
  //  • null/undefined (cron/tournament) respects the configured num_teams, else max.
  const feasibleByPlayers = Math.floor(enteredAll.length / 3);
  const slotCappedMax = Math.min(feasibleByPlayers, numberedTeams.length);
  const storedNum = (settings?.num_teams as number | null) ?? 0;
  const numTeams: number =
    typeof maxTeams === "number" && maxTeams > 0 ? Math.min(maxTeams, feasibleByPlayers)
    : maxTeams === "max"                         ? slotCappedMax
    : storedNum > 0                              ? Math.min(storedNum, feasibleByPlayers)
    :                                              slotCappedMax;
  if (numTeams < 2)
    return { ok: false, message: "Not enough players to form teams (need at least 6 in the pool)." };

  if (numberedTeams.length < numTeams)
    return { ok: false, message: `Need ${numTeams} team slots but only ${numberedTeams.length} exist. Add them in the admin panel first.` };

  // Apply cutoff: first numTeams × 3 by sign-up time
  const entered = enteredAll.slice(0, numTeams * 3);
  if (entered.length < numTeams)
    return { ok: false, message: `Need at least ${numTeams} players in the draft pool (have ${entered.length} after cutoff, need ${numTeams}).` };

  // Mark only cutoff players as active; clear any previous active flags first
  await supabaseAdmin.from("players").update({ in_active_draft: false }).eq("status", "approved");
  await supabaseAdmin.from("players").update({ in_active_draft: true }).in("id", entered.map(p => p.id));

  const teamsToUse = numberedTeams.slice(0, numTeams);
  const missingRoleIds = teamsToUse.filter(t => !t.discord_role_id).map(t => `Team ${t.num}`);
  if (missingRoleIds.length > 0)
    return { ok: false, message: `Missing Discord role IDs for: ${missingRoleIds.join(", ")}. Set them in the Team Slots section of the admin panel.` };

  const sorted = [...entered].sort((a, b) => rankValue(b) - rankValue(a));
  const drafted = numTeams * 3;
  const undrafted = sorted.length - drafted;

  // ── Phase 1: all database writes ─────────────────────────────────────────
  // Do this before any Discord calls so a slow/rate-limited Discord API
  // can't prevent draft_active from being set.

  // Highest-RV captain gets the highest team number, which picks first in round 1
  // of the snake draft (getTeamNumberForPick returns numTeams for pick 0).
  const captainTeams = [...teamsToUse].reverse();

  // Build captain assignments before any awaits
  const captainLines: string[] = [];
  const captains: Array<{ discordId: string | null; teamRoleId?: string }> = [];
  for (let i = 0; i < numTeams; i++) {
    captainLines.push(`Team ${captainTeams[i].num}: **${sorted[i].username}** (RV: ${rankValue(sorted[i]).toFixed(0)})`);
    captains.push({ discordId: sorted[i].discord_id ?? null, teamRoleId: captainTeams[i].discord_role_id ?? undefined });
  }

  // All DB writes in one parallel batch, then immediately mark draft active
  await Promise.all([
    supabaseAdmin.from("players").update({ team_id: null, is_captain: false }).eq("status", "approved"),
    supabaseAdmin.from("matches").delete().not("id", "is", null),
    // credits column kept in DB but unused in snake draft
    ...teamsToUse.map(t =>
      supabaseAdmin.from("teams").update({ wins: 0, losses: 0, name: `Team ${t.num}`, logo_url: null }).eq("id", t.id)
    ),
    ...sorted.slice(0, numTeams).map((captain, i) =>
      supabaseAdmin.from("players")
        .update({ team_id: captainTeams[i].id, is_captain: true, updated_at: new Date().toISOString() })
        .eq("id", captain.id)
    ),
  ]);

  const { data: activateRows, error: activateError } = await supabaseAdmin
    .from("league_settings").update({
      draft_active: true, draft_open: false, current_pick: 0,
      draft_phase: "picking", num_teams: numTeams,
      // First pick gets an extra 2 minutes on top of the usual 45s so everyone
      // has time to get to the draft channel before the clock is really live.
      pick_deadline: new Date(Date.now() + (45 + 120) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).not("id", "is", null).select("id, draft_active");

  if (activateError)
    return { ok: false, message: `❌ DB error activating draft: ${activateError.message}` };
  if (!activateRows?.length)
    return { ok: false, message: "❌ draft_active write matched 0 rows — check league_settings table (may be empty or id is null)." };

  // ── Phase 2: Discord (best-effort, won't block draft if slow) ────────────

  await deleteMatchChannels();

  // Strip old roles from all real players
  const { data: allPlayers } = await supabaseAdmin
    .from("players").select("discord_id").eq("status", "approved").not("discord_id", "is", null);
  const realDiscordIds = (allPlayers ?? [])
    .map(p => p.discord_id as string)
    .filter(id => id && !id.startsWith("test_"));

  const guildRoles = await getGuildRoles();
  const roleIdsToStrip = [
    ...guildRoles.filter(r => r.name === "Drafted" || r.name === "Captain").map(r => r.id),
    ...teamsToUse.map(t => t.discord_role_id).filter(Boolean) as string[],
  ];
  await stripRoleIdsFromMembers(realDiscordIds, roleIdsToStrip);

  // Rename team roles and assign captain roles in parallel
  const roleMap = await ensureRoles(["Drafted", "Captain"]);
  await Promise.all([
    ...teamsToUse.filter(t => t.discord_role_id).map(t =>
      editRole(t.discord_role_id!, { name: `Team ${t.num}` })
    ),
    ...captains.map(({ discordId, teamRoleId }) => {
      if (!discordId) return Promise.resolve();
      return Promise.all([
        roleMap["Drafted"] ? addRoleById(discordId, roleMap["Drafted"]) : Promise.resolve(),
        teamRoleId        ? addRoleById(discordId, teamRoleId)          : Promise.resolve(),
        roleMap["Captain"] ? addRoleById(discordId, roleMap["Captain"]) : Promise.resolve(),
        removeRole(discordId, "EnteredDraft"),
      ]);
    }),
  ]);

  const round1 = Array.from({ length: numTeams }, (_, i) => numTeams - i).join(", ");
  const round2 = Array.from({ length: numTeams }, (_, i) => i + 1).join(", ");
  const sizeNote = `3 per team${undrafted > 0 ? ` · ${undrafted} not drafted` : ""}`;
  const firstTeamNum = getTeamNumberForPick(0, numTeams);
  const firstCaptainPing = await getCaptainPing(firstTeamNum);

  const startMsg =
    `🚀 **Snake Draft has started!**\n` +
    `${numTeams} teams · ${sorted.length} entered · ${sizeNote}\n\n` +
    `**Captains (auto-assigned by Rank Value):**\n${captainLines.join("\n")}\n\n` +
    `**Pick order (snake):** ${round1}, ${round2}, …\n\n` +
    `⏭️ ${firstCaptainPing} (**Team ${firstTeamNum}**), you're on the clock! Use \`/pick <player>\` *(45 sec)*`;

  await sendChannelMessage(settings.draft_channel_id, startMsg);
  return { ok: true, message: `Snake draft started! Check <#${settings.draft_channel_id}>.` };
}

/**
 * Auto-balance the draft pool into even teams by Rank Value (snake distribution),
 * with no live draft. Mirrors execStartDraft's DB-then-Discord ordering.
 */
export async function execAutoBalanceTeams(maxTeams?: number | "max" | null): Promise<{ ok: boolean; message: string }> {
  const { data: settings } = await supabaseAdmin.from("league_settings").select("*").single();
  if (settings.draft_active)
    return { ok: false, message: "❌ A draft is in progress. End it before auto-balancing." };
  if (settings.season_active)
    return { ok: false, message: "❌ A season is active. End it before forming new teams." };

  const { data: enteredAll } = await supabaseAdmin
    .from("players")
    .select("id, username, discord_id, peak_2v2, current_2v2, peak_3v3, current_3v3, draft_entered_at")
    .eq("status", "approved")
    .eq("draft_entered", true)
    .order("draft_entered_at", { ascending: true, nullsFirst: false });

  if (!enteredAll?.length) return { ok: false, message: "No players have entered the pool." };

  // Validate pre-created team slots + role IDs (same checks as the snake draft)
  const { data: allPreTeams } = await supabaseAdmin
    .from("teams").select("id, name, discord_role_id, slot_number").not("slot_number", "is", null).order("slot_number");
  const numberedTeams = (allPreTeams ?? [])
    .filter((t): t is typeof t & { slot_number: number } => typeof t.slot_number === "number")
    .map(t => ({ ...t, num: t.slot_number }))
    .sort((a, b) => a.num - b.num);

  // numTeams resolution:
  //  • a positive number caps the team count (admin-specified max),
  //  • "max" builds as many as the pool (3 per team) and slots allow,
  //  • null/undefined (cron/tournament) respects the configured num_teams, else max.
  const feasibleByPlayers = Math.floor(enteredAll.length / 3);
  const slotCappedMax = Math.min(feasibleByPlayers, numberedTeams.length);
  const storedNum = (settings?.num_teams as number | null) ?? 0;
  const numTeams: number =
    typeof maxTeams === "number" && maxTeams > 0 ? Math.min(maxTeams, feasibleByPlayers)
    : maxTeams === "max"                         ? slotCappedMax
    : storedNum > 0                              ? Math.min(storedNum, feasibleByPlayers)
    :                                              slotCappedMax;
  if (numTeams < 2)
    return { ok: false, message: "Not enough players to form teams (need at least 6 in the pool)." };

  if (numberedTeams.length < numTeams)
    return { ok: false, message: `Need ${numTeams} team slots but only ${numberedTeams.length} exist.` };

  const entered = enteredAll.slice(0, numTeams * 3);
  if (entered.length < numTeams * 3)
    return { ok: false, message: `Need ${numTeams * 3} players to fill ${numTeams} teams (have ${entered.length}).` };

  const teamsToUse = numberedTeams.slice(0, numTeams);
  const missingRoleIds = teamsToUse.filter(t => !t.discord_role_id).map(t => `Team ${t.num}`);
  if (missingRoleIds.length > 0)
    return { ok: false, message: `Missing Discord role IDs for: ${missingRoleIds.join(", ")}.` };

  const rvById = new Map<string, number>(entered.map(p => [p.id, rankValue(p)]));

  // Random shuffle into groups, then 10000 greedy single-swap iterations.
  // Each iteration proposes one swap between two random groups and keeps it
  // only if it reduces the sum of squared team totals (equivalent to minimising
  // variance of group means since the grand total is constant).
  const shuffled = [...entered].sort(() => Math.random() - 0.5);
  const teamPlayerIds: string[][] = Array.from({ length: numTeams }, (_, i) =>
    shuffled.slice(i * 3, (i + 1) * 3).map(p => p.id)
  );
  const teamTotals = teamPlayerIds.map(ids => ids.reduce((s, id) => s + rvById.get(id)!, 0));

  for (let iter = 0; iter < 10000; iter++) {
    const gi = Math.floor(Math.random() * numTeams);
    let gj = Math.floor(Math.random() * numTeams);
    while (gj === gi) gj = Math.floor(Math.random() * numTeams);

    const pi = Math.floor(Math.random() * 3);
    const pj = Math.floor(Math.random() * 3);

    const idA = teamPlayerIds[gi][pi];
    const idB = teamPlayerIds[gj][pj];
    const rvA = rvById.get(idA)!;
    const rvB = rvById.get(idB)!;

    const newTI = teamTotals[gi] - rvA + rvB;
    const newTJ = teamTotals[gj] - rvB + rvA;

    if (newTI * newTI + newTJ * newTJ < teamTotals[gi] ** 2 + teamTotals[gj] ** 2) {
      teamPlayerIds[gi][pi] = idB;
      teamPlayerIds[gj][pj] = idA;
      teamTotals[gi] = newTI;
      teamTotals[gj] = newTJ;
    }
  }

  // Captain = highest-RV player per team (recomputed after swaps may have
  // changed the ordering within each team's list).
  const captainIds = teamPlayerIds
    .filter(ids => ids.length > 2)
    .map(ids => ids.reduce((best, id) => (rvById.get(id) ?? 0) > (rvById.get(best) ?? 0) ? id : best))
    .filter(Boolean);

  // ── Phase 1: DB writes ───────────────────────────────────────────────────
  await supabaseAdmin.from("players").update({ in_active_draft: false }).eq("status", "approved");
  await supabaseAdmin.from("players").update({ team_id: null, is_captain: false }).eq("status", "approved");
  await supabaseAdmin.from("matches").delete().not("id", "is", null);

  await Promise.all([
    ...teamsToUse.map(t =>
      supabaseAdmin.from("teams").update({ wins: 0, losses: 0, name: `Team ${t.num}`, logo_url: null }).eq("id", t.id)
    ),
    ...teamsToUse.map((t, i) =>
      teamPlayerIds[i].length
        ? supabaseAdmin.from("players")
            .update({ team_id: t.id, in_active_draft: true, updated_at: new Date().toISOString() })
            .in("id", teamPlayerIds[i])
        : Promise.resolve()
    ),
  ]);
  if (captainIds.length)
    await supabaseAdmin.from("players").update({ is_captain: true }).in("id", captainIds);

  await supabaseAdmin.from("league_settings").update({
    draft_open: false, draft_active: false, draft_phase: null,
    num_teams: numTeams, updated_at: new Date().toISOString(),
  }).not("id", "is", null);

  // ── Phase 2: Discord roles (best-effort) ─────────────────────────────────
  await deleteMatchChannels();
  await execSyncRoles();

  return { ok: true, message: `Auto-balanced ${entered.length} players into ${numTeams} teams.` };
}

/**
 * Finalize team sign-ups: drop pending invites, disband teams under the minimum,
 * keep the earliest-formed teams up to the limit, and map them onto the team-slot pool.
 */
export async function execFinalizeTeamSignups(): Promise<{ ok: boolean; message: string }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("active_tournament_id, num_teams, season_active")
    .single();
  if (settings?.season_active) return { ok: false, message: "❌ Season already active." };
  const tid = settings?.active_tournament_id as string | null | undefined;
  if (!tid) return { ok: false, message: "❌ No active tournament." };
  const teamLimit: number = settings?.num_teams ?? 0;

  const { data: signups } = await supabaseAdmin
    .from("team_signups")
    .select("id, name, creator_player_id, formed_at, created_at, team_signup_members(player_id, status)")
    .eq("tournament_id", tid);

  const signupIds = (signups ?? []).map((s) => s.id);
  if (signupIds.length)
    await supabaseAdmin.from("team_signup_members").delete().in("team_signup_id", signupIds).eq("status", "invited");

  // Valid = 3+ accepted; ordered by when they first reached the minimum (then creation).
  const valid = (signups ?? [])
    .map((s) => {
      const accepted = (s.team_signup_members as { player_id: string; status: string }[])
        .filter((m) => m.status === "accepted");
      return {
        name: s.name,
        creator: s.creator_player_id as string,
        formed_at: s.formed_at as string | null,
        created_at: s.created_at as string,
        memberIds: accepted.map((m) => m.player_id),
      };
    })
    .filter((t) => t.memberIds.length >= 3)
    .sort((a, b) => {
      const fa = a.formed_at ? new Date(a.formed_at).getTime() : Infinity;
      const fb = b.formed_at ? new Date(b.formed_at).getTime() : Infinity;
      if (fa !== fb) return fa - fb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const { data: allPreTeams } = await supabaseAdmin
    .from("teams").select("id, discord_role_id, slot_number").not("slot_number", "is", null).order("slot_number");
  const numberedTeams = (allPreTeams ?? [])
    .filter((t): t is typeof t & { slot_number: number } => typeof t.slot_number === "number")
    .sort((a, b) => a.slot_number - b.slot_number);

  const capacity = teamLimit > 0 ? Math.min(teamLimit, numberedTeams.length) : numberedTeams.length;
  const kept = valid.slice(0, capacity);
  if (kept.length === 0) return { ok: false, message: "❌ No valid teams (each needs at least 3 players)." };

  const teamsToUse = numberedTeams.slice(0, kept.length);

  // ── DB writes ──
  await supabaseAdmin.from("players").update({ team_id: null, is_captain: false, in_active_draft: false }).eq("status", "approved");
  await supabaseAdmin.from("matches").delete().not("id", "is", null);
  await Promise.all([
    ...teamsToUse.map((t, i) =>
      supabaseAdmin.from("teams").update({ wins: 0, losses: 0, name: kept[i].name }).eq("id", t.id)
    ),
    ...teamsToUse.map((t, i) =>
      supabaseAdmin.from("players")
        .update({ team_id: t.id, in_active_draft: true, updated_at: new Date().toISOString() })
        .in("id", kept[i].memberIds)
    ),
  ]);
  await Promise.all(
    teamsToUse.map((t, i) =>
      supabaseAdmin.from("players").update({ is_captain: true }).eq("id", kept[i].creator)
    )
  );

  await supabaseAdmin.from("league_settings")
    .update({ num_teams: kept.length, draft_open: false, updated_at: new Date().toISOString() })
    .not("id", "is", null);

  // Sign-up records are no longer needed once rosters are committed.
  await supabaseAdmin.from("team_signups").delete().eq("tournament_id", tid);

  // ── Discord ──
  await deleteMatchChannels();
  await execSyncRoles();
  const { data: renameTeams } = await supabaseAdmin
    .from("teams").select("name, discord_role_id").not("discord_role_id", "is", null);
  for (const t of renameTeams ?? []) await editRole(t.discord_role_id!, { name: t.name });

  return { ok: true, message: `Finalized ${kept.length} team(s) from sign-ups.` };
}

export async function execEndDraft(): Promise<{ ok: boolean; message: string }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("draft_active").single();
  if (!settings?.draft_active)
    return { ok: false, message: "❌ No draft is currently active." };
  await Promise.all([
    supabaseAdmin.from("league_settings").update({
      draft_active: false, draft_phase: null,
      pick_deadline: null, updated_at: new Date().toISOString(),
    }).not("id", "is", null),
    supabaseAdmin.from("players").update({ in_active_draft: false }).eq("status", "approved"),
  ]);
  return { ok: true, message: "🔒 **Draft has ended.** Rosters are now locked." };
}

type PickSettings = { num_teams: number; current_pick: number; draft_channel_id: string | null };

async function completePick(s: PickSettings, teamId: string, playerId: string): Promise<{ ok: boolean; message: string }> {
  const totalPicks = s.num_teams * 2;

  const [{ data: player }, { data: team }] = await Promise.all([
    supabaseAdmin.from("players").select("id, username, discord_id").eq("id", playerId).single(),
    supabaseAdmin.from("teams").select("id, name, discord_role_id").eq("id", teamId).single(),
  ]);
  if (!player || !team) return { ok: false, message: "❌ Could not find player or team." };

  await supabaseAdmin.from("players").update({ team_id: team.id, updated_at: new Date().toISOString() }).eq("id", player.id);

  if (player.discord_id) {
    const roleMap = await ensureRoles(["Drafted"]);
    if (roleMap["Drafted"]) await addRoleById(player.discord_id, roleMap["Drafted"]);
    if (team.discord_role_id) await addRoleById(player.discord_id, team.discord_role_id);
    else await addRole(player.discord_id, team.name);
    await removeRole(player.discord_id, "EnteredDraft");
  }

  const newPick = s.current_pick + 1;
  const isDone = newPick >= totalPicks;

  await supabaseAdmin.from("league_settings").update({
    draft_phase: isDone ? null : "picking",
    current_pick: newPick,
    pick_deadline: isDone ? null : new Date(Date.now() + 45 * 1000).toISOString(),
    ...(isDone ? { draft_active: false } : {}),
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);

  if (s.draft_channel_id) {
    await sendChannelMessage(s.draft_channel_id,
      `✅ **${team.name}** picks **${player.username}**!\n\n${"—".repeat(32)}`
    );
    if (isDone) {
      await sendChannelMessage(s.draft_channel_id, "🏁 **Snake draft complete! Rosters are locked.**");
    } else {
      const nextTeamNum = getTeamNumberForPick(newPick, s.num_teams);
      const nextPing = await getCaptainPing(nextTeamNum);
      await sendChannelMessage(s.draft_channel_id,
        `⏭️ ${nextPing} (**Team ${nextTeamNum}**), you're on the clock! Use \`/pick <player>\` *(45 sec)*`
      );
    }
  }

  return { ok: true, message: isDone ? "🏁 Draft complete!" : `✅ **${player.username}** → **${team.name}**` };
}

export async function execAutoPick(): Promise<{ done: boolean }> {
  const { data: settings, error: settingsErr } = await supabaseAdmin.from("league_settings").select("*").single();
  if (settingsErr) { console.error("[execAutoPick] settings read failed:", settingsErr.message); return { done: true }; }
  if (!settings?.draft_active || settings.draft_phase !== "picking") return { done: true };

  const deadline: Date | null = settings.pick_deadline ? new Date(settings.pick_deadline) : null;
  if (!deadline || new Date() < deadline) return { done: true };

  // Atomically claim this autopick by clearing the deadline only if it still matches.
  // If two callers race here (cron + client timer), only one will update a row; the
  // other gets 0 rows back and exits early, preventing duplicate messages.
  const { data: claimed } = await supabaseAdmin
    .from("league_settings")
    .update({ pick_deadline: null, updated_at: new Date().toISOString() })
    .eq("pick_deadline", settings.pick_deadline)
    .select("id");
  if (!claimed?.length) return { done: true };

  const numTeams: number = settings.num_teams;
  const currentPick: number = settings.current_pick ?? 0;
  const channelId: string | null = settings.draft_channel_id ?? null;
  const totalPicks = numTeams * 2;

  if (currentPick >= totalPicks) {
    await supabaseAdmin.from("league_settings").update({
      draft_active: false, draft_phase: null, pick_deadline: null, updated_at: new Date().toISOString(),
    }).not("id", "is", null);
    return { done: true };
  }

  const currentTeamNum = getTeamNumberForPick(currentPick, numTeams);
  const teamRow = await getTeamByPosition(currentTeamNum, "id, name") as { id: string; name: string } | null;
  if (!teamRow) {
    console.error(`[execAutoPick] No team at position ${currentTeamNum}`);
    return { done: true };
  }

  const { data: available, error: avErr } = await supabaseAdmin.from("players")
    .select("id, username, discord_id, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .eq("status", "approved").eq("in_active_draft", true).is("team_id", null);
  if (avErr) { console.error("[execAutoPick] available players query failed:", avErr.message); return { done: true }; }

  if (!available?.length) {
    await supabaseAdmin.from("league_settings").update({
      draft_active: false, draft_phase: null, pick_deadline: null, updated_at: new Date().toISOString(),
    }).not("id", "is", null);
    return { done: true };
  }

  const best = [...available].sort((a, b) => rankValue(b) - rankValue(a))[0];
  if (channelId) {
    await sendChannelMessage(channelId,
      `⏰ **Team ${currentTeamNum}** ran out of time! Auto-picking **${best.username}**…`
    );
  }

  const result = await completePick(
    { num_teams: numTeams, current_pick: currentPick, draft_channel_id: channelId },
    teamRow.id, best.id,
  );
  console.log("[execAutoPick] auto-pick:", result.message);
  return { done: false };
}

const PRESET_MIN_TEAMS: Record<string, number> = {
  single_elimination: 4,
  double_elimination: 4,
  group_single_elimination: 8,
  group_swiss_single_elimination: 32,
  se_swiss_single_elimination: 32,
  de_swiss_single_elimination: 32,
};
const GROUP_PRESETS = new Set(["group_single_elimination", "group_swiss_single_elimination"]);

/**
 * Default-schedule all scheduled matches off the active tournament's season start.
 * "Gap between rounds": every match in round R starts at season_start + (R-1) × gap,
 * replaced by the admin Scheduling panel (round_schedules table).
 */

export async function execStartSeason(): Promise<{ ok: boolean; message: string }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("season_format, num_teams, draft_active, season_active, active_tournament_id, is_test_season")
    .single();

  const format = settings?.season_format as { preset?: string } | null;
  const numTeams: number = settings?.num_teams ?? 0;

  if (!format?.preset) {
    return { ok: false, message: "❌ No season format selected. Set one in the admin panel first." };
  }

  if (settings?.draft_active)
    return { ok: false, message: "❌ A draft is still in progress. End it before starting the season." };
  if (settings?.season_active)
    return { ok: false, message: "❌ A season is already active." };

  const min = PRESET_MIN_TEAMS[format.preset] ?? 4;
  if (numTeams < min) {
    return { ok: false, message: `❌ **${format.preset.replace(/_/g, " ")}** requires at least **${min} teams** (current: ${numTeams}).` };
  }

  if (GROUP_PRESETS.has(format.preset) && numTeams > 64) {
    return { ok: false, message: `❌ Group stage formats support a maximum of **64 teams** (current: ${numTeams}).` };
  }

  // Clear any stale round schedules left over from a previous season; otherwise the
  // channel gate sees old (past-deadline) entries and opens every channel instantly,
  // before the admin can set new times.
  await supabaseAdmin.from("round_schedules").delete().not("id", "is", null);

  await supabaseAdmin.from("league_settings")
    .update({ season_active: true, round1_manual_start_pending: true, updated_at: new Date().toISOString() })
    .not("id", "is", null);

  const bracketResult = await buildAndSaveBracket();
  if (!bracketResult.ok) {
    // Roll back season_active so the admin knows something went wrong
    await supabaseAdmin.from("league_settings")
      .update({ season_active: false, updated_at: new Date().toISOString() })
      .not("id", "is", null);
    return { ok: false, message: `❌ Season start failed: bracket generation error — ${bracketResult.error}` };
  }

  // Rename each Discord role to match the team's current name (set by captains pre-season).
  const { data: teamsToRename } = await supabaseAdmin
    .from("teams").select("name, discord_role_id").not("discord_role_id", "is", null);
  for (const team of teamsToRename ?? []) {
    await editRole(team.discord_role_id!, { name: team.name });
  }

  // Lock all team info now that the season is live; admins can unlock individual teams later.
  await supabaseAdmin.from("teams").update({ is_locked: true }).not("id", "is", null);

  // Open channels for the opening round. openReadyMatchChannels only opens matches
  // whose teams have no earlier unplayed round, so at season start that's round 1;
  // later rounds open automatically as matches are reported (no /openround needed).
  await openReadyMatchChannels();

  // One-time start-grant (100 coins × participants) applies to every season start —
  // tournament-driven or manual — on top of the separate weekly recurring bonus that
  // manual seasons also get. Fires here so it's identical regardless of whether the
  // season was started by the cron's auto-trigger, the admin dashboard button, or the
  // Discord /confirm command, since all three call this same function.
  const activeTournamentId = settings?.active_tournament_id as string | null;
  let isTestRun = !!settings?.is_test_season;
  if (activeTournamentId) {
    const { data: t } = await supabaseAdmin
      .from("tournaments").select("is_test").eq("id", activeTournamentId).single();
    isTestRun = !!t?.is_test;
  }
  if (!isTestRun) {
    try {
      const { count: participantCount } = await supabaseAdmin
        .from("players")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved")
        .not("team_id", "is", null);
      const grant = (participantCount ?? 0) * 100;
      await Promise.all([
        supabaseAdmin.from("players").update({ coin_grant_pending_start: true }).eq("status", "approved"),
        supabaseAdmin.from("league_settings")
          .update({ pending_start_coin_amount: grant, last_coin_grant_at: new Date().toISOString() })
          .not("id", "is", null),
      ]);
    } catch { /* best-effort */ }
  }

  const cut = bracketResult.cutTeams ?? 0;
  const playing = numTeams - cut;
  const base = `🏆 **Season has officially started!** ${playing} teams · ${format.preset.replace(/_/g, " ")} · Bracket generated.`;
  const cutoffNote = cut > 0
    ? ` ⚠ ${cut} team${cut === 1 ? "" : "s"} exceeded this format's team limit and were left out (lowest Rank Value) — those players won't participate this season.`
    : "";
  return { ok: true, message: base + cutoffNote };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function totalPlayers() {
  const { count } = await supabaseAdmin
    .from("players").select("*", { count: "exact", head: true }).eq("status", "approved");
  return reply(`✅ **Total approved players:** ${count ?? 0}`);
}

async function totalUsers() {
  const { count } = await supabaseAdmin
    .from("players").select("*", { count: "exact", head: true });
  return reply(`👥 **Total registered users:** ${count ?? 0} (all statuses)`);
}

async function playerInfo(username: string) {
  const { data } = await supabaseAdmin
    .from("players")
    .select("username, status, peak_3v3, current_3v3, peak_2v2, current_2v2, tracker_url, team_id")
    .ilike("username", username).single();

  if (!data) return reply(`❌ No player found: "${username}"`);
  const rv = rankValue(data);
  return reply(
    `**${data.username}**\nStatus: ${data.status}\n` +
    `Peak 3v3: ${data.peak_3v3} | Current: ${data.current_3v3}\n` +
    `Peak 2v2: ${data.peak_2v2} | Current: ${data.current_2v2}\n` +
    `Rank Value: ${rv.toFixed(0)}\nTracker: ${data.tracker_url}`
  );
}

async function setDraftChannel(userId: string, channelId: string) {
  const denied = await adminGuard(userId);
  if (denied) return denied;
  if (!channelId) return ephemeralReply("❌ Provide a channel ID.");

  await supabaseAdmin.from("league_settings")
    .update({ draft_channel_id: channelId, updated_at: new Date().toISOString() }).not("id", "is", null);

  return ephemeralReply(`✅ Draft channel set to <#${channelId}>. The draft will post there.`);
}

async function pickPlayer(userId: string, playerUsername: string) {
  const { data: settings } = await supabaseAdmin.from("league_settings").select("*").single();
  if (!settings?.draft_active) return reply("❌ No draft is currently active.");
  if (settings.draft_phase !== "picking") return reply("❌ Not in picking phase.");

  const numTeams: number = settings.num_teams;
  const currentPick: number = settings.current_pick ?? 0;
  if (currentPick >= numTeams * 2) return reply("✅ Draft is already complete.");

  const currentTeamNum = getTeamNumberForPick(currentPick, numTeams);

  if (!(await isModerator(userId))) {
    const { data: caller } = await supabaseAdmin.from("players").select("is_captain, team_id").eq("discord_id", userId).single();
    if (!caller?.is_captain) return reply("❌ Only captains can pick.");
    const { data: callerTeam } = await supabaseAdmin.from("teams").select("slot_number").eq("id", caller.team_id).single();
    if (!callerTeam || callerTeam.slot_number !== currentTeamNum)
      return reply(`❌ It's **Team ${currentTeamNum}**'s turn to pick.`);
  }

  const currentTeam = await getTeamByPosition(currentTeamNum, "id, name") as { id: string; name: string } | null;
  if (!currentTeam) return reply(`❌ Team lookup failed for position ${currentTeamNum}.`);

  const { data: target } = await supabaseAdmin.from("players")
    .select("id, username, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .ilike("username", playerUsername).eq("status", "approved").eq("in_active_draft", true).is("team_id", null).single();
  if (!target) return reply(`❌ "${playerUsername}" is not in the draft pool.`);

  const result = await completePick(
    { num_teams: numTeams, current_pick: currentPick, draft_channel_id: settings.draft_channel_id as string | null },
    currentTeam.id, target.id,
  );
  return reply(result.message);
}

async function setRulesChannel(userId: string, channelId: string) {
  const denied = await adminGuard(userId);
  if (denied) return denied;
  const { error } = await supabaseAdmin.from("league_settings")
    .update({ rules_channel_id: channelId, updated_at: new Date().toISOString() }).not("id", "is", null);
  if (error) return ephemeralReply(`❌ DB error: ${error.message}`);
  return ephemeralReply(`✅ Rules channel set to <#${channelId}>.`);
}

// Omit `categoryId` to clear the anchor — new match categories then default back to the bottom.
async function setMatchCategoryAnchor(userId: string, categoryId?: string) {
  const denied = await adminGuard(userId);
  if (denied) return denied;
  const { error } = await supabaseAdmin.from("league_settings")
    .update({ match_category_anchor_id: categoryId ?? null, updated_at: new Date().toISOString() }).not("id", "is", null);
  if (error) return ephemeralReply(`❌ DB error: ${error.message}`);
  return ephemeralReply(categoryId
    ? `✅ New match categories will now be placed right after <#${categoryId}>.`
    : "✅ Match category anchor cleared — new categories will default to the bottom.");
}

async function setAnnouncementChannel(userId: string, channelId: string) {
  const denied = await adminGuard(userId);
  if (denied) return denied;
  const { error } = await supabaseAdmin.from("league_settings")
    .update({ announcement_channel_id: channelId, updated_at: new Date().toISOString() }).not("id", "is", null);
  if (error) return ephemeralReply(`❌ DB error: ${error.message}`);
  return ephemeralReply(`✅ Announcement channel set to <#${channelId}>.`);
}

// Reports what's still missing before the Discord server is fully wired up for the
// website — run after /admin disconnect, or on a brand-new server, to see what's left.
async function adminChecklist(userId: string) {
  const denied = await directorGuard(userId);
  if (denied) return denied;

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("rules_channel_id, announcement_channel_id, draft_channel_id, moderator_role_id, director_role_id, ceo_role_id, registered_role_id")
    .single();

  const { count: teamCount } = await supabaseAdmin
    .from("teams").select("id", { count: "exact", head: true });

  const missing: string[] = [];
  if (!settings) missing.push("`league_settings` row is missing entirely (should always have exactly one row)");
  if (!settings?.rules_channel_id) missing.push("Rules channel — run `/setruleschannel` in the target channel");
  if (!settings?.announcement_channel_id) missing.push("Announcement channel — run `/setannouncement` in the target channel");
  if (!settings?.draft_channel_id) missing.push("Draft channel — run `/setdraftchannel` in the target channel");
  if (!settings?.moderator_role_id) missing.push("Moderator role — run `/admin setmoderatorid`");
  if (!settings?.director_role_id) missing.push("Director role — run `/admin setdirectorid`");
  if (!settings?.ceo_role_id) missing.push("CEO role — run `/admin setceoid`");
  if (!settings?.registered_role_id) missing.push("Registered role — run `/admin setregisteredrole`");
  if (!teamCount) missing.push("No team slots exist yet — add them from the dashboard admin panel");

  if (!missing.length) return ephemeralReply("✅ Nothing missing — the server looks fully configured.");
  return ephemeralReply(`⚠️ **Setup checklist — ${missing.length} item(s) remaining:**\n${missing.map(m => `• ${m}`).join("\n")}`);
}

// DB-only: clears every guild-scoped Discord ID reference so a stale server's channel/role
// IDs don't linger after switching which Discord server the bot is invited to. Makes no
// Discord API calls itself and never touches staff_roles or player Discord IDs, since those
// are global user IDs, not scoped to any one guild.
async function adminDisconnect(userId: string, confirm: string) {
  const denied = await ceoGuard(userId);
  if (denied) return denied;
  if (confirm !== "CONFIRM DISCONNECT") return ephemeralReply('❌ Type exactly: "CONFIRM DISCONNECT"');

  await Promise.all([
    supabaseAdmin.from("league_settings").update({
      rules_channel_id: null, announcement_channel_id: null, match_category_anchor_id: null,
      match_category_id: null, draft_channel_id: null, moderator_role_id: null,
      director_role_id: null, ceo_role_id: null, registered_role_id: null,
      updated_at: new Date().toISOString(),
    }).not("id", "is", null),
    supabaseAdmin.from("teams").update({ discord_role_id: null }).not("id", "is", null),
    supabaseAdmin.from("matches").update({ discord_channel_id: null }).not("id", "is", null),
    supabaseAdmin.from("match_discord_categories").delete().not("id", "is", null),
  ]);

  return ephemeralReply("✅ Disconnected. All Discord channel/role/category references cleared from the database — no changes were made in the Discord server itself. Run `/admin checklist` to see what to reconfigure.");
}

// Clears live game/season data so the website starts fresh, without touching staff roles,
// player registration, or any of the Discord-connection config /admin disconnect owns.
// player_game_stats rows cascade-delete automatically with their parent match (DB constraint),
// regardless of clearHistory — clearHistory only additionally clears the completed-seasons archive.
async function adminWipe(userId: string, confirm: string, clearHistory: boolean) {
  const denied = await ceoGuard(userId);
  if (denied) return denied;
  if (confirm !== "CONFIRM WIPE") return ephemeralReply('❌ Type exactly: "CONFIRM WIPE"');

  await deleteMatchChannels();
  await voidAllPendingWagers();

  const { data: allPlayers } = await supabaseAdmin
    .from("players").select("discord_id").not("discord_id", "is", null);
  const realDiscordIds = (allPlayers ?? [])
    .map(p => p.discord_id as string)
    .filter(id => id && !id.startsWith("test_"));
  const { data: allTeams } = await supabaseAdmin.from("teams").select("discord_role_id");
  const guildRoles = await getGuildRoles();
  const roleIdsToStrip = [
    ...guildRoles.filter(r => r.name === "Drafted" || r.name === "Captain" || r.name === "EnteredDraft").map(r => r.id),
    ...(allTeams ?? []).map(t => t.discord_role_id).filter((id): id is string => !!id),
  ];
  await stripRoleIdsFromMembers(realDiscordIds, roleIdsToStrip);

  await Promise.all([
    supabaseAdmin.from("sub_requests").delete().not("id", "is", null),
    supabaseAdmin.from("matches").delete().not("id", "is", null),
    supabaseAdmin.from("teams").delete().not("id", "is", null),
  ]);
  await supabaseAdmin.from("players").update({
    team_id: null, is_captain: false, draft_entered: false, draft_entered_at: null,
    in_active_draft: false, must_update_tracker: false, coin_grant_pending_start: false,
    coin_grant_pending_weekly: false,
  }).not("id", "is", null);
  await supabaseAdmin.from("league_settings").update({
    draft_open: false, draft_signups_closed: false, draft_active: false, season_active: false,
    is_test_season: false, num_teams: 0, current_pick: 0, draft_phase: null,
    nominated_player_id: null, current_bid: null, current_bid_team_id: null, current_bid_time: null,
    pick_deadline: null, pending_start_coin_amount: 0, updated_at: new Date().toISOString(),
  }).not("id", "is", null);

  if (clearHistory) await supabaseAdmin.from("seasons").delete().not("id", "is", null);

  return ephemeralReply(`✅ Wiped. All teams, matches, and season/draft state cleared — the website is a clean slate.${clearHistory ? " Completed-season history was also cleared." : " Completed-season history was preserved (pass clear_history:true to also clear it)."}`);
}

async function openRound(userId: string, roundOverride?: number) {
  const denied = await adminGuard(userId);
  if (denied) return denied;

  // Only consider matches that don't have a channel yet
  const { data: pending } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, round, stage, scheduled_at")
    .eq("status", "scheduled")
    .is("discord_channel_id", null)
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null);

  if (!pending?.length) return ephemeralReply("❌ No upcoming matches without channels found.");

  // Use provided round or auto-detect: lowest round number that has no channels yet
  const targetRound = roundOverride ?? Math.min(...pending.map(m => m.round));
  const matches = pending.filter(m => m.round === targetRound);

  if (!matches.length) return ephemeralReply(`❌ No matches found for round ${targetRound}.`);

  const teamIds = [...new Set(matches.flatMap(m => [m.home_team_id!, m.away_team_id!]))];
  const { data: teamsData } = await supabaseAdmin.from("teams").select("id, name").in("id", teamIds);
  const teamNameById: Record<string, string> = {};
  teamsData?.forEach(t => { teamNameById[t.id] = t.name; });

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("match_deadline_day, match_play_day, match_play_hour, rules_channel_id, match_category_anchor_id, season_format, active_tournament_id")
    .single();

  const allTeamNames = [...new Set(
    matches.flatMap(m => [teamNameById[m.home_team_id!], teamNameById[m.away_team_id!]]).filter(Boolean)
  )];
  await ensureRoles(allTeamNames);

  const format = settings?.season_format as { roundBestOf?: Record<string, number> } | null;
  const [existingChannels, guildRoles, allMatchRows, staffRoleIds] = await Promise.all([
    getGuildChannels(),
    getGuildRoles(),
    supabaseAdmin.from("matches").select("stage, round").then(r => r.data ?? []),
    getStaffRoleIds(),
  ]);
  const maxRoundByStage: Record<string, number> = {};
  allMatchRows.forEach((m: { stage: string; round: number }) => {
    maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
  });
  const ctx: MatchChannelContext = {
    categoryCache:  new Map(),
    deadlineDay:    settings?.match_deadline_day ?? 2,
    playDay:        settings?.match_play_day   ?? 0,
    playHour:       settings?.match_play_hour  ?? 19,
    rulesChannelId: settings?.rules_channel_id ?? null,
    categoryAnchorId: settings?.match_category_anchor_id ?? null,
    existingChannels,
    guildRoles,
    roundBestOf: format?.roundBestOf ?? {},
    maxRoundByStage,
    staffRoleIds,
    isTournament: !!(settings?.active_tournament_id as string | null | undefined),
  };

  let created = 0;
  let skipped = 0;
  let firstError: string | undefined;
  for (const m of matches) {
    const h = teamNameById[m.home_team_id!];
    const a = teamNameById[m.away_team_id!];
    if (!h || !a) continue;
    const result = await createMatchChannel(h, a, targetRound, ctx, {
      round: m.round, stage: m.stage,
      homeTeamId: m.home_team_id!, awayTeamId: m.away_team_id!, matchId: m.id,
      scheduledAt: (m as { scheduled_at?: string | null }).scheduled_at ?? null,
    });
    if (result.created) {
      created++;
    } else if (result.skipped) {
      skipped++;
    } else if (result.error && !firstError) {
      firstError = result.error;
    }
  }

  if (firstError && created === 0 && skipped === 0) return ephemeralReply(`❌ ${firstError}`);
  const parts: string[] = [];
  if (created > 0) parts.push(`✅ Created **${created}** channel${created === 1 ? "" : "s"} for Round ${targetRound}`);
  if (skipped > 0) parts.push(`ℹ️ **${skipped}** already exist`);
  if (firstError) parts.push(`⚠️ ${firstError}`);
  return ephemeralReply(parts.join(" · ") || "ℹ️ Nothing to do.");
}

// Format-agnostic auto channel creation. Opens a Discord channel for every
// scheduled match that is "ready": both teams are assigned AND neither team has
// an unplayed (scheduled) match in an EARLIER round of the same stage — i.e.
// both teams have finished the round that gates this one. This covers group /
// round-robin (a round-N+1 match opens once both its teams finish round N),
// Swiss, and bracket first-rounds after a stage transition. Idempotent: matches
// that already have a channel are skipped, and createMatchChannel creates the
// match's category lazily only if one doesn't already exist. Called after every
// match report and every round/stage generation, replacing the need for /openround.
export async function openReadyMatchChannels(): Promise<void> {
  const { data: allMatches } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, round, match_number, stage, status, discord_channel_id, scheduled_at, admin_scheduled, home_checked_in, away_checked_in, checkin_deadline");
  if (!allMatches?.length) return;

  // Load round schedules. Always gate channels on schedule + previous deadline.
  // Works for both tournament-based seasons (keyed by tournament_id) and standalone
  // seasons (tournament_id IS NULL).
  const { data: ls } = await supabaseAdmin
    .from("league_settings")
    .select("active_tournament_id, round1_manual_start_pending")
    .single();
  const activeTournamentId = (ls?.active_tournament_id as string | null) ?? null;
  const round1ManualStartPending = !!ls?.round1_manual_start_pending;

  // The season's opening stage — round 1 of this stage waits for an explicit admin
  // "Start Round" click instead of opening the instant its schedule is set, so a
  // scheduling mistake on round 1 can still be corrected before anything goes live.
  const presentStages = new Set(allMatches.map((m) => canonicalStage(m.stage as string)));
  const firstStage = STAGE_ORDER.find((s) => presentStages.has(s));

  const scheduleMap = new Map<string, { play_at: string; deadline_at: string }>();
  {
    const schedQuery = activeTournamentId
      ? supabaseAdmin.from("round_schedules").select("stage, round, play_at, deadline_at").eq("tournament_id", activeTournamentId)
      : supabaseAdmin.from("round_schedules").select("stage, round, play_at, deadline_at").is("tournament_id", null);
    const { data: schedules } = await schedQuery;
    for (const s of schedules ?? []) {
      scheduleMap.set(`${s.stage}:${s.round}`, {
        play_at: s.play_at as string,
        deadline_at: s.deadline_at as string,
      });
    }
  }

  const now = Date.now();
  const isTournamentMode = !!activeTournamentId;

  const blockedByEarlierRound = (m: (typeof allMatches)[number]) => {
    const check = (teamId: string) =>
      allMatches.some((x) =>
        x.stage === m.stage && x.round < m.round && x.status === "scheduled" &&
        (x.home_team_id === teamId || x.away_team_id === teamId),
      );
    return check(m.home_team_id!) || check(m.away_team_id!);
  };

  // Tournament check-in: open a 10-minute window for each newly-ready match.
  // Channels are then created (below) only once both teams have checked in.
  if (isTournamentMode) {
    for (const m of allMatches) {
      if (m.status !== "scheduled" || m.discord_channel_id || !m.home_team_id || !m.away_team_id) continue;
      if (m.checkin_deadline) continue;
      if (blockedByEarlierRound(m)) continue;
      await openCheckInForMatch(m.id, m.stage, m.round);
    }
  }

  const ready = allMatches.filter((m) => {
    if (m.status !== "scheduled" || m.discord_channel_id || !m.home_team_id || !m.away_team_id) return false;
    if (blockedByEarlierRound(m)) return false;

    // Tournaments: channel opens only once BOTH teams check in.
    if (isTournamentMode) return !!m.home_checked_in && !!m.away_checked_in;

    const cs = (m.stage as string).startsWith("group_") ? "group" : (m.stage as string);
    if (round1ManualStartPending && (m.round as number) === 1 && cs === firstStage) return false;
    if (!scheduleMap.has(`${cs}:${m.round}`)) return false;
    if ((m.round as number) > 1) {
      const prev = scheduleMap.get(`${cs}:${(m.round as number) - 1}`);
      if (prev && new Date(prev.deadline_at).getTime() > now) return false;
    }
    return true;
  });
  if (!ready.length) return;

  const teamIds = [...new Set(ready.flatMap((m) => [m.home_team_id!, m.away_team_id!]))];
  const { data: teamsData } = await supabaseAdmin.from("teams").select("id, name").in("id", teamIds);
  const teamNameById: Record<string, string> = {};
  teamsData?.forEach((t) => { teamNameById[t.id] = t.name; });

  await ensureRoles([...new Set(Object.values(teamNameById))]);

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("match_deadline_day, match_play_day, match_play_hour, rules_channel_id, match_category_anchor_id, season_format, active_tournament_id")
    .single();
  const format = settings?.season_format as { roundBestOf?: Record<string, number> } | null;
  const isTournament = !!(settings?.active_tournament_id as string | null | undefined);

  const [existingChannels, guildRoles, staffRoleIds] = await Promise.all([
    getGuildChannels(),
    getGuildRoles(),
    getStaffRoleIds(),
  ]);
  const maxRoundByStage: Record<string, number> = {};
  allMatches.forEach((m) => {
    maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
  });
  const ctx: MatchChannelContext = {
    categoryCache: new Map(),
    deadlineDay: settings?.match_deadline_day ?? 2,
    playDay: settings?.match_play_day ?? 0,
    playHour: settings?.match_play_hour ?? 19,
    rulesChannelId: settings?.rules_channel_id ?? null,
    categoryAnchorId: settings?.match_category_anchor_id ?? null,
    existingChannels,
    guildRoles,
    roundBestOf: format?.roundBestOf ?? {},
    maxRoundByStage,
    staffRoleIds,
    isTournament,
  };

  for (const m of ready) {
    const h = teamNameById[m.home_team_id!];
    const a = teamNameById[m.away_team_id!];
    if (!h || !a) continue;
    const cs = (m.stage as string).startsWith("group_") ? "group" : (m.stage as string);
    const schedEntry = scheduleMap.get(`${cs}:${m.round}`);
    const pinned = !!(m as { admin_scheduled?: boolean }).admin_scheduled;
    const matchScheduledAt = (m as { scheduled_at?: string | null }).scheduled_at ?? null;
    const r = await createMatchChannel(h, a, m.round, ctx, {
      round: m.round, stage: m.stage,
      homeTeamId: m.home_team_id!, awayTeamId: m.away_team_id!, matchId: m.id,
      // A pinned match uses its own fixed time; otherwise the round window start.
      scheduledAt: pinned && matchScheduledAt ? matchScheduledAt : (schedEntry?.play_at ?? matchScheduledAt),
      adminScheduled: pinned,
    });
    if (!r.created && r.error) console.error("[openReadyMatchChannels]", r.error);
    if (r.created && isTournament) {
      // Notify both teams that their match is now ready to play.
      const notifBase = { url: "/dashboard/my-team", tag: "match-ready", category: "tournament" as const };
      pushToTeam(m.home_team_id!, { ...notifBase, title: "Match Ready!", body: `Your match vs ${a} is ready. Head to My Team to get started.` }).catch(() => {});
      pushToTeam(m.away_team_id!, { ...notifBase, title: "Match Ready!", body: `Your match vs ${h} is ready. Head to My Team to get started.` }).catch(() => {});
    }
    await sleep(DISCORD_PACE_MS);
  }
}

// ─── Tournament check-in ────────────────────────────────────────────────────────

const CHECKIN_WINDOW_MS = 10 * 60 * 1000;

async function isTournamentActive(): Promise<boolean> {
  const { data } = await supabaseAdmin.from("league_settings").select("active_tournament_id").maybeSingle();
  return !!(data?.active_tournament_id as string | null | undefined);
}

// Scheduled start time of a stage (round 1's play time), if an admin set one.
async function stageStartPlayAt(stage: string): Promise<string | null> {
  const { data: ls } = await supabaseAdmin.from("league_settings").select("active_tournament_id").maybeSingle();
  const tid = (ls?.active_tournament_id as string | null) ?? null;
  const cs = stage.startsWith("group_") ? "group" : stage;
  const q = tid
    ? supabaseAdmin.from("round_schedules").select("play_at").eq("tournament_id", tid).eq("stage", cs).eq("round", 1).maybeSingle()
    : supabaseAdmin.from("round_schedules").select("play_at").is("tournament_id", null).eq("stage", cs).eq("round", 1).maybeSingle();
  const { data } = await q;
  return (data?.play_at as string | undefined) ?? null;
}

// Opens a 10-minute check-in window for a tournament match if one isn't open yet.
// First round of a stage opens at the stage's scheduled start; later rounds open now.
async function openCheckInForMatch(matchId: string, stage: string, round: number): Promise<void> {
  const { data: m } = await supabaseAdmin.from("matches").select("checkin_deadline, home_team_id, away_team_id").eq("id", matchId).maybeSingle();
  if (!m || m.checkin_deadline) return;
  let deadlineMs = Date.now() + CHECKIN_WINDOW_MS;
  if (round === 1) {
    // The first round of a stage starts at its scheduled time. If the admin hasn't
    // scheduled it yet, do NOT open a window — otherwise every team would be DQ'd
    // 10 minutes after the bracket is generated. Scheduling the stage re-runs this.
    const start = await stageStartPlayAt(stage);
    if (!start) return;
    deadlineMs = new Date(start).getTime() + CHECKIN_WINDOW_MS;
  }
  // Later rounds open immediately, so notify now and mark notified. Round 1 opens at
  // the scheduled stage start — processExpiredCheckIns notifies when that arrives.
  const immediate = deadlineMs - CHECKIN_WINDOW_MS <= Date.now();
  await supabaseAdmin.from("matches")
    .update({ checkin_deadline: new Date(deadlineMs).toISOString(), checkin_notified: immediate })
    .eq("id", matchId);

  if (immediate && m.home_team_id && m.away_team_id) {
    const payload = { title: "Check in now!", body: "Your match is ready — check in within 10 minutes or forfeit.", url: "/dashboard/my-team", tag: "checkin", category: "tournament" as const };
    pushToTeam(m.home_team_id, payload).catch(() => {});
    pushToTeam(m.away_team_id, payload).catch(() => {});
  }
}

// Creates the match's Discord channel once both teams have checked in.
export async function createChannelIfCheckedIn(matchId: string): Promise<void> {
  const { data: m } = await supabaseAdmin.from("matches")
    .select("id, home_team_id, away_team_id, home_checked_in, away_checked_in, discord_channel_id, stage, round, scheduled_at")
    .eq("id", matchId).maybeSingle();
  if (!m || m.discord_channel_id || !m.home_team_id || !m.away_team_id) return;
  if (!m.home_checked_in || !m.away_checked_in) return;
  const [{ data: hTeam }, { data: aTeam }] = await Promise.all([
    supabaseAdmin.from("teams").select("name").eq("id", m.home_team_id).single(),
    supabaseAdmin.from("teams").select("name").eq("id", m.away_team_id).single(),
  ]);
  if (!hTeam || !aTeam) return;
  const r = await createMatchChannel(hTeam.name, aTeam.name, m.round, undefined, {
    round: m.round, stage: m.stage,
    homeTeamId: m.home_team_id, awayTeamId: m.away_team_id, matchId: m.id,
    scheduledAt: (m as { scheduled_at?: string | null }).scheduled_at ?? null,
  });
  if (!r.created && r.error) console.error("[createChannelIfCheckedIn]", r.error);
}

// Notifies teams when a check-in window opens (covers round 1 opening at stage start),
// and DQs matches whose window expired without both teams checking in. The team that
// checked in advances by forfeit; if neither did, the higher seed (home) advances.
export async function processExpiredCheckIns(): Promise<void> {
  if (!(await isTournamentActive())) return;
  const now = Date.now();
  const { data: matches } = await supabaseAdmin.from("matches")
    .select("id, home_checked_in, away_checked_in, checkin_deadline, checkin_notified, discord_channel_id, status, home_team_id, away_team_id")
    .eq("status", "scheduled")
    .not("checkin_deadline", "is", null)
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null);
  for (const m of matches ?? []) {
    if (m.discord_channel_id) continue;
    if (m.home_checked_in && m.away_checked_in) continue;

    const deadline = new Date(m.checkin_deadline as string).getTime();
    const opensAt = deadline - CHECKIN_WINDOW_MS;

    // Window just opened (e.g. round 1 reaching its stage start) — notify both teams.
    if (now >= opensAt && now <= deadline && !m.checkin_notified) {
      await supabaseAdmin.from("matches").update({ checkin_notified: true }).eq("id", m.id);
      const payload = { title: "Check in now!", body: "Your match is ready — check in within 10 minutes or forfeit.", url: "/dashboard/my-team", tag: "checkin", category: "tournament" as const };
      if (m.home_team_id) pushToTeam(m.home_team_id, payload).catch(() => {});
      if (m.away_team_id) pushToTeam(m.away_team_id, payload).catch(() => {});
      continue;
    }

    if (deadline > now) continue; // still counting down

    // Expired — forfeit. Winner = the team that checked in (home if neither).
    const neither = !m.home_checked_in && !m.away_checked_in;
    const winnerIsHome = m.home_checked_in || neither;
    await execReportMatchResult(m.id, winnerIsHome ? 1 : 0, winnerIsHome ? 0 : 1, 0, true);

    const winnerTeam = winnerIsHome ? m.home_team_id : m.away_team_id;
    const loserTeam = winnerIsHome ? m.away_team_id : m.home_team_id;
    if (loserTeam) pushToTeam(loserTeam, {
      title: "Match forfeited",
      body: neither
        ? "Neither team checked in within 10 minutes — your team was disqualified."
        : "Your team missed the 10-minute check-in and forfeited the match.",
      url: "/dashboard/my-team", tag: "checkin-dq", category: "tournament",
    }).catch(() => {});
    if (winnerTeam) pushToTeam(winnerTeam, {
      title: neither ? "Match forfeited" : "Opponent no-show — you advance!",
      body: neither
        ? "Neither team checked in. You advance as the higher seed."
        : "Your opponent missed check-in. You advance by forfeit.",
      url: "/dashboard/my-team", tag: "checkin-advance", category: "tournament",
    }).catch(() => {});
  }
}

// ─── Score auto-confirm ─────────────────────────────────────────────────────────

const SCORE_CONFIRM_WINDOW_MS = 5 * 60 * 1000;

// Auto-finalizes submitted series results the opposing team hasn't confirmed within
// 5 minutes. Same outcome as a manual confirm — the submitted score stands.
export async function processExpiredScoreConfirmations(): Promise<void> {
  const cutoff = new Date(Date.now() - SCORE_CONFIRM_WINDOW_MS).toISOString();
  const { data: matches } = await supabaseAdmin
    .from("matches")
    .select("id, pending_home_score, pending_away_score, home_team_id, away_team_id, score_submitted_by_team_id")
    .not("pending_home_score", "is", null)
    .is("home_score", null)
    .eq("score_confirmed", false)
    .not("score_submitted_at", "is", null)
    .lte("score_submitted_at", cutoff);
  for (const m of matches ?? []) {
    // Step 8: an auto-confirm must not be able to clear an identity
    // discrepancy either — leave the match pending for admin review instead
    // of silently finalizing it once the window elapses.
    if (await hasBlockingIdentityDiscrepancy(m.id)) continue;

    // Atomic claim: only the caller that flips score_confirmed false→true proceeds,
    // so a concurrent cron + client trigger can't both finalize the same match.
    const { data: claimed } = await supabaseAdmin
      .from("matches")
      .update({ score_confirmed: true })
      .eq("id", m.id)
      .eq("score_confirmed", false)
      .select("id");
    if (!claimed || claimed.length === 0) continue;
    try {
      await execReportMatchResult(m.id, m.pending_home_score as number, m.pending_away_score as number);
    } catch { /* admin can finalize manually */ }

    // Let the team that didn't confirm know the result was auto-submitted.
    const otherTeam = m.score_submitted_by_team_id === m.home_team_id ? m.away_team_id : m.home_team_id;
    if (otherTeam) pushToTeam(otherTeam as string, {
      title: "Result auto-submitted",
      body: "You didn't confirm the reported score within 5 minutes, so it was finalized automatically.",
      url: "/dashboard/my-team", tag: "score-auto",
    }).catch(() => {});
  }
}

// Reconciles every approved player's Discord roles to the current DB state. First
// strips all managed roles (every team role + Drafted + Captain) using the
// rate-limit-safe strategy (only removes roles a member actually has), then re-adds
// only the roles each player should have. This both fills in missing roles and
// removes stale/incorrect ones (e.g. a player who switched teams, left a team, or
// rejoined the server). Every approved player is processed, not just rostered ones,
// so free agents get leftover team/Drafted/Captain roles cleared.
export async function execSyncRoles(): Promise<{ assigned: number; roleNames: string[]; warnings: string[] }> {
  const warnings: string[] = [];

  const [{ data: teams }, { data: approved }, { data: allPlayers }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name, discord_role_id"),
    supabaseAdmin.from("players")
      .select("discord_id, team_id, is_captain")
      .eq("status", "approved")
      .not("discord_id", "is", null),
    supabaseAdmin.from("players")
      .select("discord_id")
      .not("discord_id", "is", null),
    supabaseAdmin.from("league_settings")
      .select("registered_role_id")
      .single(),
  ]);

  const registeredRoleId = settings?.registered_role_id as string | null;

  // Only auto-create Drafted and Captain — team roles are pre-created manually
  const roleMap = await ensureRoles(["Drafted", "Captain"]);
  if (!roleMap["Drafted"] || !roleMap["Captain"]) {
    warnings.push(`Failed to create Drafted/Captain roles — check bot permissions`);
  }

  // For teams without a stored role ID, fall back to creating by name
  const teamsNeedingFallback = (teams ?? []).filter(t => !t.discord_role_id);
  const fallbackMap = teamsNeedingFallback.length > 0
    ? await ensureRoles(teamsNeedingFallback.map(t => t.name))
    : {};

  const teamById: Record<string, { name: string; roleId: string | null }> = {};
  (teams ?? []).forEach(t => {
    teamById[t.id] = { name: t.name, roleId: t.discord_role_id ?? fallbackMap[t.name] ?? null };
  });

  // Every role this sync owns — used to strip stale assignments before re-adding.
  // Includes registered role so it gets stripped from non-approved players.
  const managedRoleIds = [
    registeredRoleId,
    roleMap["Drafted"], roleMap["Captain"],
    ...Object.values(teamById).map(t => t.roleId),
  ].filter((id): id is string => !!id);

  // Skip test users (fake IDs like "test_...") — they don't exist in Discord
  const realPlayers = (allPlayers ?? []).filter(p => {
    const id = p.discord_id as string;
    return id && !id.startsWith("test_");
  });

  // 1) Strip every managed role off every player (clears stale/wrong roles).
  if (managedRoleIds.length) {
    await stripRoleIdsFromMembers(realPlayers.map(p => p.discord_id as string), managedRoleIds);
  }

  // 2) Re-add only the roles each player should have per the DB.
  let assigned = 0;
  await Promise.all(
    (approved ?? []).map(player => {
      const discordId = player.discord_id as string;
      const promises: Promise<void>[] = [];

      // All approved players get the registered role
      if (registeredRoleId) promises.push(addRoleById(discordId, registeredRoleId));

      // Team-specific roles (drafted/team/captain) only if on a team
      const team = player.team_id ? teamById[player.team_id as string] : null;
      if (team) {
        assigned++;
        if (roleMap["Drafted"]) promises.push(addRoleById(discordId, roleMap["Drafted"]));
        if (team.roleId)        promises.push(addRoleById(discordId, team.roleId));
        if (player.is_captain && roleMap["Captain"])
          promises.push(addRoleById(discordId, roleMap["Captain"]));
      }

      return Promise.all(promises);
    })
  );

  const roleNames = [
    ...(registeredRoleId ? ["Registered"] : []),
    "Drafted", "Captain", ...(teams ?? []).map(t => t.name),
  ];
  return { assigned, roleNames, warnings };
}

async function syncRoles(userId: string) {
  const denied = await adminGuard(userId);
  if (denied) return denied;

  const { data: teams } = await supabaseAdmin.from("teams").select("id").limit(1);
  if (!teams?.length) return ephemeralReply("❌ No teams found in the database.");

  const { assigned, roleNames, warnings } = await execSyncRoles();
  const lines = [
    `• Roles ensured: ${roleNames.join(", ")}`,
    `• Players updated: **${assigned}**`,
    ...warnings.map(w => `⚠️ ${w}`),
  ];
  return ephemeralReply((warnings.length ? "⚠️ Partial sync" : "✅ Roles synced") + "\n" + lines.join("\n"));
}

async function diagRoles(userId: string) {
  const denied = await adminGuard(userId);
  if (denied) return denied;

  // Look up the player record for the calling admin
  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, username, discord_id, team_id, is_captain, status")
    .eq("discord_id", userId)
    .maybeSingle();

  if (!player) {
    return ephemeralReply(
      `❌ No player record found for your Discord ID (\`${userId}\`).\n` +
      `You must register on the website so your Discord ID is saved to the database.`
    );
  }

  const lines: string[] = [
    `**Player record for <@${userId}>:**`,
    `• Username: \`${player.username}\``,
    `• Discord ID in DB: \`${player.discord_id}\``,
    `• Status: \`${player.status}\``,
    `• is_captain: \`${player.is_captain}\``,
    `• team_id: \`${player.team_id ?? "none"}\``,
  ];

  // Check if team role exists
  if (player.team_id) {
    const { data: team } = await supabaseAdmin.from("teams").select("name").eq("id", player.team_id).single();
    if (team) {
      lines.push(`• Team name: \`${team.name}\``);
      const guildRoles = await getGuildRoles();
      const role = guildRoles.find(r => r.name === team.name);
      lines.push(role
        ? `• Discord role "${team.name}" exists: \`${role.id}\``
        : `• ⚠️ Discord role "${team.name}" does NOT exist in the server`
      );

      // Try to assign the team role
      if (role) {
        const res = await fetch(
          `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}/roles/${role.id}`,
          { method: "PUT", headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );
        lines.push(res.ok || res.status === 204
          ? `• ✅ Test role assignment succeeded`
          : `• ❌ Test role assignment failed (HTTP ${res.status}) — check bot role hierarchy`
        );
      }
    }
  }

  return ephemeralReply(lines.join("\n"));
}

const DEFAULT_KICK_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

// Re-applies ban/timeout/"Kicked" state to the currently-configured guild for
// players whose DB moderation state (guild-independent) says they should
// currently be banned or kicked. Needed after moving the bot to a new Discord
// server, since bans/timeouts/roles are all guild-scoped and don't carry over.
export async function execResyncModeration(): Promise<{ banned: number; kicked: number; warnings: string[] }> {
  const warnings: string[] = [];

  const { data: players } = await supabaseAdmin
    .from("players")
    .select("discord_id, status, kick_reason, kicked_until")
    .not("discord_id", "is", null)
    .or("status.eq.banned,kick_reason.not.is.null");

  const realPlayers = (players ?? []).filter(p => {
    const id = p.discord_id as string;
    return id && !id.startsWith("test_");
  });

  let banned = 0;
  let kicked = 0;

  for (const player of realPlayers) {
    const discordId = player.discord_id as string;

    if (player.status === "banned") {
      await banMember(discordId);
      banned++;
      await sleep(DISCORD_PACE_MS);
    }

    if (isCurrentlyKicked(player.kick_reason, player.kicked_until)) {
      const timeoutMs = player.kicked_until
        ? new Date(player.kicked_until).getTime() - Date.now()
        : DEFAULT_KICK_TIMEOUT_MS;
      await addRole(discordId, "Kicked");
      await timeoutMember(discordId, timeoutMs);
      kicked++;
      await sleep(DISCORD_PACE_MS);
    }
  }

  return { banned, kicked, warnings };
}

async function resyncModeration(userId: string) {
  const denied = await ceoGuard(userId);
  if (denied) return denied;

  const { banned, kicked, warnings } = await execResyncModeration();
  const lines = [
    `• Players re-banned: **${banned}**`,
    `• Players re-kicked (role + timeout): **${kicked}**`,
    ...warnings.map(w => `⚠️ ${w}`),
  ];
  return ephemeralReply(
    (warnings.length ? "⚠️ Partial resync" : "✅ Moderation resynced") + "\n" + lines.join("\n") +
    "\n\nThis re-applies bans/timeouts/the Kicked role to the guild currently configured for this bot — run it once after pointing the bot at a new Discord server."
  );
}

async function assignRole(userId: string, targetUserId: string, roleId: string) {
  const denied = await adminGuard(userId);
  if (denied) return denied;
  await addRoleById(targetUserId, roleId);
  return ephemeralReply(`✅ Role assigned to <@${targetUserId}>.`);
}

async function removeRoleCmd(userId: string, targetUserId: string, roleId: string) {
  const denied = await adminGuard(userId);
  if (denied) return denied;
  await removeRoleById(targetUserId, roleId);
  return ephemeralReply(`✅ Role removed from <@${targetUserId}>.`);
}

// Sets a team into a match slot and marks it scheduled if both teams are now set.
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

// After every WB or LB match result, scan for LB matches that are indefinitely
// waiting for a team that will never arrive (because its source was a bye).
// Returns true if any byes were resolved (caller should loop until false).
async function resolveDeByeMatches(): Promise<boolean> {
  const { data: lbMatches } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, home_team_id, away_team_id")
    .eq("stage", DE_LOSERS)
    .neq("status", "completed");

  let resolved = false;

  for (const m of lbMatches ?? []) {
    const hasHome = !!m.home_team_id;
    const hasAway = !!m.away_team_id;
    if (hasHome === hasAway) continue; // both teams present, or neither — skip

    const presentTeamId: string = hasHome ? m.home_team_id : m.away_team_id;

    // Determine which match should have produced the missing team.
    // LB round topology:
    //   R1 (odd):  home ← WB R1 match (2M-1) loser,  away ← WB R1 match (2M) loser
    //   even R:    home ← LB (R-1) match M winner,    away ← WB R(R/2+1) match M loser
    //   odd R > 1: home ← LB (R-1) match (2M-1) win, away ← LB (R-1) match (2M) win
    let sourceStage: string;
    let sourceRound: number;
    let sourceMatchNum: number;

    if (!hasHome) {
      if (m.round === 1) {
        sourceStage = DE_WINNERS; sourceRound = 1; sourceMatchNum = 2 * m.match_number - 1;
      } else if (m.round % 2 === 0) {
        sourceStage = DE_LOSERS; sourceRound = m.round - 1; sourceMatchNum = m.match_number;
      } else {
        sourceStage = DE_LOSERS; sourceRound = m.round - 1; sourceMatchNum = 2 * m.match_number - 1;
      }
    } else {
      if (m.round === 1) {
        sourceStage = DE_WINNERS; sourceRound = 1; sourceMatchNum = 2 * m.match_number;
      } else if (m.round % 2 === 0) {
        sourceStage = DE_WINNERS; sourceRound = m.round / 2 + 1; sourceMatchNum = m.match_number;
      } else {
        sourceStage = DE_LOSERS; sourceRound = m.round - 1; sourceMatchNum = 2 * m.match_number;
      }
    }

    const { data: sourceMatch } = await supabaseAdmin
      .from("matches")
      .select("status")
      .eq("stage", sourceStage)
      .eq("round", sourceRound)
      .eq("match_number", sourceMatchNum)
      .maybeSingle();

    if (sourceMatch?.status !== "completed") continue;

    // Source is done and the slot is still empty — the missing team will never arrive.
    // Auto-complete as a bye win for the present team.
    const homeScore = hasHome ? 1 : 0;
    const awayScore = hasHome ? 0 : 1;
    await supabaseAdmin.from("matches")
      .update({ home_score: homeScore, away_score: awayScore, status: "completed" })
      .eq("id", m.id);
    await advanceBracketWinner(
      { round: m.round, match_number: m.match_number, stage: DE_LOSERS },
      presentTeamId,
    );
    resolved = true;
    // Opening channels may unblock downstream matches in the bracket
    await openReadyMatchChannels().catch(() => {});
  }

  return resolved;
}

async function getDEBracketSizes() {
  const [{ data: wbRows }, { data: lbRows }] = await Promise.all([
    supabaseAdmin.from("matches").select("round").eq("stage", DE_WINNERS),
    supabaseAdmin.from("matches").select("round").eq("stage", DE_LOSERS),
  ]);
  if (!wbRows?.length) return null;
  const numWB = Math.max(...wbRows.map(m => m.round));
  const numLB = lbRows?.length ? Math.max(...lbRows.map(m => m.round)) : 0;
  return { numWB, numLB };
}

async function getDEQBracketSizes() {
  const [{ data: wbRows }, { data: lbRows }] = await Promise.all([
    supabaseAdmin.from("matches").select("round").eq("stage", DE_QUALIFIER_WINNERS),
    supabaseAdmin.from("matches").select("round").eq("stage", DE_QUALIFIER_LOSERS),
  ]);
  if (!wbRows?.length) return null;
  const numWBQ = Math.max(...wbRows.map(m => m.round));
  const numLBQ = lbRows?.length ? Math.max(...lbRows.map(m => m.round)) : 0;
  return { numWBQ, numLBQ };
}

// Creates a channel for a match if both teams are now set after a slot assignment.
async function maybeCreateChannelForMatch(
  stage: string, round: number, matchNum: number,
): Promise<void> {
  const { data: m } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, scheduled_at")
    .eq("stage", stage).eq("round", round).eq("match_number", matchNum)
    .maybeSingle();
  if (!m?.home_team_id || !m?.away_team_id) return;

  // Tournaments gate the channel behind a check-in window instead of opening it now.
  if (await isTournamentActive()) {
    await openCheckInForMatch(m.id, stage, round);
    await createChannelIfCheckedIn(m.id);
    return;
  }

  const [{ data: hTeam }, { data: aTeam }] = await Promise.all([
    supabaseAdmin.from("teams").select("name").eq("id", m.home_team_id).single(),
    supabaseAdmin.from("teams").select("name").eq("id", m.away_team_id).single(),
  ]);
  if (!hTeam || !aTeam) return;
  const r = await createMatchChannel(hTeam.name, aTeam.name, round, undefined, {
    round, stage,
    homeTeamId: m.home_team_id, awayTeamId: m.away_team_id, matchId: m.id,
    scheduledAt: (m as { scheduled_at?: string | null }).scheduled_at ?? null,
  });
  if (!r.created && r.error) console.error("[createMatchChannel]", r.error);
}

// Shared bracket advancement after a match result is recorded. Handles SE, DE, Swiss, and group stages.
async function advanceBracketWinner(
  bracketMatch: { round: number; match_number: number; stage: string },
  winnerId: string,
  loserId?: string,
) {
  const { stage, round, match_number } = bracketMatch;

  // ── Double Elimination — Winners Bracket ──────────────────────────────────
  if (stage === DE_WINNERS) {
    const sizes = await getDEBracketSizes();
    if (!sizes) return;

    if (round < sizes.numWB) {
      const nr = round + 1;
      const nm = Math.ceil(match_number / 2);
      const slot = match_number % 2 === 1 ? "home_team_id" : "away_team_id";
      await setMatchSlot(DE_WINNERS, nr, nm, slot, winnerId);
      await maybeCreateChannelForMatch(DE_WINNERS, nr, nm);
    } else {
      await setMatchSlot(DE_GF, 1, 1, "home_team_id", winnerId);
      await maybeCreateChannelForMatch(DE_GF, 1, 1);
    }

    if (loserId) {
      const { lbRound, lbMatchNum, slot } = wbLoserTarget(round, match_number);
      await setMatchSlot(DE_LOSERS, lbRound, lbMatchNum, slot, loserId);
      await maybeCreateChannelForMatch(DE_LOSERS, lbRound, lbMatchNum);
    }
    return;
  }

  // ── Double Elimination — Losers Bracket ───────────────────────────────────
  if (stage === DE_LOSERS) {
    const sizes = await getDEBracketSizes();
    if (!sizes) return;

    const target = lbWinnerTarget(round, match_number, sizes.numLB);
    if (target.section === "grand_final") {
      await setMatchSlot(DE_GF, 1, 1, "away_team_id", winnerId);
      await maybeCreateChannelForMatch(DE_GF, 1, 1);
    } else {
      await setMatchSlot(DE_LOSERS, target.round, target.matchNum, target.slot, winnerId);
      await maybeCreateChannelForMatch(DE_LOSERS, target.round, target.matchNum);
    }
    return;
  }

  // ── Double Elimination — Grand Final ──────────────────────────────────────
  if (stage === DE_GF && match_number === 1) {
    const { data: gf } = await supabaseAdmin
      .from("matches").select("home_team_id, away_team_id")
      .eq("stage", DE_GF).eq("match_number", 1).maybeSingle();
    if (gf && winnerId === gf.away_team_id) {
      await supabaseAdmin.from("matches")
        .update({ home_team_id: gf.home_team_id, away_team_id: gf.away_team_id, status: "scheduled" })
        .eq("stage", DE_GF).eq("match_number", 2);
      await maybeCreateChannelForMatch(DE_GF, 1, 2);
    }
    return;
  }

  // ── DE Qualifier — Winners Bracket ───────────────────────────────────────
  if (stage === DE_QUALIFIER_WINNERS) {
    const sizes = await getDEQBracketSizes();
    if (!sizes) return;

    if (round < sizes.numWBQ) {
      const nr = round + 1;
      const nm = Math.ceil(match_number / 2);
      const slot = match_number % 2 === 1 ? "home_team_id" : "away_team_id";
      await setMatchSlot(DE_QUALIFIER_WINNERS, nr, nm, slot, winnerId);
      await maybeCreateChannelForMatch(DE_QUALIFIER_WINNERS, nr, nm);
    }

    if (loserId) {
      const { lbRound, lbMatchNum, slot } = wbLoserTarget(round, match_number);
      await setMatchSlot(DE_QUALIFIER_LOSERS, lbRound, lbMatchNum, slot, loserId);
      await maybeCreateChannelForMatch(DE_QUALIFIER_LOSERS, lbRound, lbMatchNum);
    }
    return;
  }

  // ── DE Qualifier — Losers Bracket ────────────────────────────────────────
  if (stage === DE_QUALIFIER_LOSERS) {
    const sizes = await getDEQBracketSizes();
    if (!sizes) return;

    if (round < sizes.numLBQ) {
      const target = lbWinnerTarget(round, match_number, sizes.numLBQ);
      if (target.section === "losers") {
        await setMatchSlot(DE_QUALIFIER_LOSERS, target.round, target.matchNum, target.slot, winnerId);
        await maybeCreateChannelForMatch(DE_QUALIFIER_LOSERS, target.round, target.matchNum);
      }
    }
    return;
  }

  // ── Hybrid UB ─────────────────────────────────────────────────────────────
  if (stage === HYBRID_UB) {
    // UB QF winner → SF home slot (match_number preserved).
    // Loser cross-routes to the OPPOSITE LB R3 slot so the same two teams
    // cannot meet again in the SF (UB M1 loser → LB R3 M2, M2 loser → M1).
    await setMatchSlot(HYBRID_SF, 1, match_number, "home_team_id", winnerId);
    await maybeCreateChannelForMatch(HYBRID_SF, 1, match_number);
    if (loserId) {
      const lbMatchNum = match_number === 1 ? 2 : 1;
      await setMatchSlot(HYBRID_LB, 3, lbMatchNum, "away_team_id", loserId);
      await maybeCreateChannelForMatch(HYBRID_LB, 3, lbMatchNum);
    }
    return;
  }

  // ── Hybrid LB ─────────────────────────────────────────────────────────────
  if (stage === HYBRID_LB) {
    if (round === 1) {
      // LB R1 M1/M2 winners → LB R2 M1; M3/M4 → LB R2 M2
      const nm   = Math.ceil(match_number / 2);
      const slot = match_number % 2 === 1 ? "home_team_id" : "away_team_id";
      await setMatchSlot(HYBRID_LB, 2, nm, slot, winnerId);
      await maybeCreateChannelForMatch(HYBRID_LB, 2, nm);
    } else if (round === 2) {
      // LB R2 winner → LB R3 home slot (match_number preserved)
      await setMatchSlot(HYBRID_LB, 3, match_number, "home_team_id", winnerId);
      await maybeCreateChannelForMatch(HYBRID_LB, 3, match_number);
    } else if (round === 3) {
      // LB QF winner → SF away slot (match_number preserved)
      await setMatchSlot(HYBRID_SF, 1, match_number, "away_team_id", winnerId);
      await maybeCreateChannelForMatch(HYBRID_SF, 1, match_number);
    }
    return;
  }

  // ── Hybrid SF ─────────────────────────────────────────────────────────────
  if (stage === HYBRID_SF) {
    const slot = match_number === 1 ? "home_team_id" : "away_team_id";
    await setMatchSlot(HYBRID_GF, 1, 1, slot, winnerId);
    await maybeCreateChannelForMatch(HYBRID_GF, 1, 1);
    return;
  }

  // HYBRID_GF: winner is champion, no further routing needed.
  if (stage === HYBRID_GF) return;

  // ── Hybrid8 UB ────────────────────────────────────────────────────────────
  if (stage === HYBRID8_UB) {
    // UB winner → SF home; loser cross-routes to the OPPOSITE LB R2 slot
    // (UB M1 loser → LB R2 M2, M2 loser → M1) so the pair cannot rematch in the SF.
    await setMatchSlot(HYBRID8_SF, 1, match_number, "home_team_id", winnerId);
    await maybeCreateChannelForMatch(HYBRID8_SF, 1, match_number);
    if (loserId) {
      const lbMatchNum = match_number === 1 ? 2 : 1;
      await setMatchSlot(HYBRID8_LB, 2, lbMatchNum, "away_team_id", loserId);
      await maybeCreateChannelForMatch(HYBRID8_LB, 2, lbMatchNum);
    }
    return;
  }

  // ── Hybrid8 LB ────────────────────────────────────────────────────────────
  if (stage === HYBRID8_LB) {
    if (round === 1) {
      // LB R1: each match winner feeds same-numbered LB R2 match, home slot
      await setMatchSlot(HYBRID8_LB, 2, match_number, "home_team_id", winnerId);
      await maybeCreateChannelForMatch(HYBRID8_LB, 2, match_number);
    } else if (round === 2) {
      // LB QF winner → SF away (same match_number)
      await setMatchSlot(HYBRID8_SF, 1, match_number, "away_team_id", winnerId);
      await maybeCreateChannelForMatch(HYBRID8_SF, 1, match_number);
    }
    return;
  }

  // ── Hybrid8 SF ────────────────────────────────────────────────────────────
  if (stage === HYBRID8_SF) {
    const slot = match_number === 1 ? "home_team_id" : "away_team_id";
    await setMatchSlot(HYBRID8_GF, 1, 1, slot, winnerId);
    await maybeCreateChannelForMatch(HYBRID8_GF, 1, 1);
    return;
  }

  if (stage === HYBRID8_GF) return;

  // Group / Swiss matches don't advance a winner into a fixed next slot — their
  // next-round pairings are pre-generated (group) or generated as a batch (Swiss).
  // openReadyMatchChannels opens those channels once both teams finish the prior
  // round, so there's nothing to advance here.
  if (stage.startsWith(GROUP_STAGE_PREFIX) || stage === "swiss") return;

  // ── SE — winner advances into the next round's slot ───────────────────────
  const nr   = round + 1;
  const nm   = nextMatchNumber(match_number);
  const slot = nextSlot(match_number);
  const { data: nextMatch } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, scheduled_at")
    .eq("stage", stage).eq("round", nr).eq("match_number", nm)
    .maybeSingle();
  if (!nextMatch) return;
  await supabaseAdmin.from("matches")
    .update({ [slot === "home" ? "home_team_id" : "away_team_id"]: winnerId, status: "scheduled" })
    .eq("id", nextMatch.id);

  // Routes through maybeCreateChannelForMatch so tournaments open a check-in window
  // instead of creating the channel immediately.
  await maybeCreateChannelForMatch(stage, nr, nm);
}

export async function execReportMatchResult(
  matchId: string,
  homeScore: number,
  awayScore: number,
  goalDiff = 0,
  forfeit = false,
): Promise<{ ok: boolean; message: string }> {
  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, stage, round, match_number, status, discord_channel_id")
    .eq("id", matchId).single();
  if (!match) return { ok: false, message: "Match not found." };
  if (match.status === "completed") return { ok: false, message: "Match already reported." };

  const [{ data: homeTeam }, { data: awayTeam }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name, wins, losses, season_rating").eq("id", match.home_team_id).single(),
    supabaseAdmin.from("teams").select("id, name, wins, losses, season_rating").eq("id", match.away_team_id).single(),
  ]);
  if (!homeTeam || !awayTeam) return { ok: false, message: "Team not found." };

  await supabaseAdmin.from("matches")
    .update({ home_score: homeScore, away_score: awayScore, status: "completed" })
    .eq("id", matchId);

  // A match's sub requests are consumed once it's played — clear them so the team
  // is free to request a sub for their next match and the panel stays clean.
  await supabaseAdmin.from("sub_requests").delete().eq("match_id", matchId);

  const winnerId = homeScore > awayScore ? homeTeam.id : awayScore > homeScore ? awayTeam.id : null;
  const loserId  = homeScore > awayScore ? awayTeam.id : awayScore > homeScore ? homeTeam.id : null;

  if (homeScore !== awayScore) {
    const [winner, loser] = homeScore > awayScore ? [homeTeam, awayTeam] : [awayTeam, homeTeam];
    await Promise.all([
      supabaseAdmin.from("teams").update({ wins: (winner.wins ?? 0) + 1 }).eq("id", winner.id),
      supabaseAdmin.from("teams").update({ losses: (loser.losses ?? 0) + 1 }).eq("id", loser.id),
    ]);

    // Update season ratings. Lazy-init from roster RVs on first match.
    applySeasonRatingUpdate(
      homeTeam.id, awayTeam.id,
      homeTeam.season_rating as number | null,
      awayTeam.season_rating as number | null,
      homeScore, awayScore,
    ).catch(() => {});

    if (match.stage) {
      await advanceBracketWinner(
        { round: match.round, match_number: match.match_number, stage: match.stage },
        winnerId!,
        loserId ?? undefined,
      );
      await cleanupStageCategoryIfComplete(match.stage, match.round);
    }
  }

  // Open channels for any match whose teams just became free (e.g. the other
  // group/Swiss pairing finishing the round). Format-agnostic; idempotent.
  await openReadyMatchChannels();

  // Auto-advance DE lower-bracket teams whose source slot was a bye. Loop until
  // stable because one resolved bye may unblock another dependent bye.
  if (match.stage === DE_WINNERS || match.stage === DE_LOSERS) {
    // eslint-disable-next-line no-await-in-loop
    while (await resolveDeByeMatches()) {
      await openReadyMatchChannels();
    }
  }

  const winnerName = homeScore > awayScore ? homeTeam.name : awayScore > homeScore ? awayTeam.name : null;

  if (match.discord_channel_id) {
    try {
      const roles = await getGuildRoles();
      const homeMention = await roleMentionByName(homeTeam.name, roles);
      const awayMention = await roleMentionByName(awayTeam.name, roles);
      const resultLine = winnerName ? `🏆 **${winnerName} wins!**` : "🤝 **Draw**";
      await sendChannelMessage(
        match.discord_channel_id,
        `${homeMention} ${awayMention}\n📊 **Match result: ${homeTeam.name} ${homeScore}–${awayScore} ${awayTeam.name}**\n${resultLine}`,
      );
    } catch { /* best-effort */ }
    // Delete the channel now that the result has been posted — don't wait for the
    // whole round to finish.
    await deleteChannel(match.discord_channel_id);
    await supabaseAdmin.from("matches").update({ discord_channel_id: null }).eq("id", matchId);
  }

  // Fire a completion notification when the championship-deciding match is
  // reported. The decider always lives in a terminal stage (an SE final or a
  // grand final); group/swiss/qualifier matches are never terminal, so a
  // between-stages lull (0 scheduled matches mid-event) can't trigger it. Once
  // we're in a terminal stage with no scheduled matches left, the event is over
  // and the just-reported winner is the champion. (For a DE grand final, a
  // lower-bracket win has already scheduled the reset match above, so the count
  // stays > 0 until the bracket is truly decided.)
  const TERMINAL_STAGES = new Set(["single_elimination", DE_GF, HYBRID_GF, HYBRID8_GF]);
  try {
    if (TERMINAL_STAGES.has(match.stage ?? "") && winnerName) {
      const { count: remaining } = await supabaseAdmin
        .from("matches")
        .select("*", { count: "exact", head: true })
        .eq("status", "scheduled")
        .not("home_team_id", "is", null)
        .not("away_team_id", "is", null);

      if ((remaining ?? 1) === 0) {
        const { data: ls } = await supabaseAdmin
          .from("league_settings").select("active_tournament_id").single();
        const tournamentId = ls?.active_tournament_id as string | null | undefined;

        if (tournamentId) {
          const { data: t } = await supabaseAdmin
            .from("tournaments").select("name").eq("id", tournamentId).single();
          const name = t?.name ?? "The tournament";
          pushToAllApproved({
            title: "Tournament Complete!",
            body: `${name} is over. Congratulations to ${winnerName} on winning!`,
            url: "/dashboard/podium",
            tag: "tournament-complete",
            category: "tournament",
          }).catch(() => {});
        } else {
          pushToAllApproved({
            title: "Season Complete!",
            body: `All matches have been played. Congratulations to ${winnerName} on winning the season!`,
            url: "/dashboard/season",
            tag: "season-complete",
            category: "season",
          }).catch(() => {});
        }
      }
    }
  } catch { /* best-effort — never block the match report */ }

  // Resolve wagers for this match
  // A forfeit didn't actually play out, so refund all wagers instead of settling them.
  if (forfeit) voidMatchWagers(matchId).catch(() => {});
  else resolveMatchWagers(matchId, homeScore, awayScore).catch(() => {});

  return {
    ok: true,
    message: `${homeTeam.name} ${homeScore} — ${awayScore} ${awayTeam.name}${winnerName ? ` · ${winnerName} wins` : " · Draw"}`,
  };
}

// Refunds every pending wager/parlay on a forfeited match (the game wasn't played,
// so over/under and moneyline bets can't fairly be settled).
async function voidMatchWagers(matchId: string): Promise<void> {
  const { data: wagers } = await supabaseAdmin
    .from("wagers").select("id, player_id, amount").eq("match_id", matchId).eq("status", "pending");
  if ((wagers ?? []).length) {
    await supabaseAdmin.from("wagers").update({ status: "void" }).in("id", wagers!.map((w) => w.id));
    await Promise.all(wagers!.map((w) =>
      supabaseAdmin.rpc("increment_crl_coins", { player_discord_id: w.player_id, coin_amount: w.amount }),
    ));
  }

  // Any parlay that includes this match is voided in full and the stake refunded.
  const { data: legs } = await supabaseAdmin
    .from("parlay_legs").select("parlay_id").eq("match_id", matchId).eq("status", "pending");
  const parlayIds = [...new Set((legs ?? []).map((l) => l.parlay_id as string))];
  for (const pid of parlayIds) {
    const { data: p } = await supabaseAdmin.from("parlays").select("player_id, amount, status").eq("id", pid).single();
    if (!p || p.status !== "pending") continue;
    await Promise.all([
      supabaseAdmin.from("parlays").update({ status: "void" }).eq("id", pid),
      supabaseAdmin.from("parlay_legs").update({ status: "void" }).eq("parlay_id", pid),
      supabaseAdmin.rpc("increment_crl_coins", { player_discord_id: p.player_id, coin_amount: p.amount }),
    ]);
  }
}

// Refunds every pending wager/parlay league-wide. Called when a season/tournament
// is reset or cancelled early — resetSeason wipes the matches those bets reference,
// so there is no future match-completion event left to settle them naturally.
export async function voidAllPendingWagers(): Promise<void> {
  const { data: wagers } = await supabaseAdmin
    .from("wagers").select("id, player_id, amount").eq("status", "pending");
  if ((wagers ?? []).length) {
    await supabaseAdmin.from("wagers").update({ status: "void" }).in("id", wagers!.map((w) => w.id));
    await Promise.all(wagers!.map((w) =>
      supabaseAdmin.rpc("increment_crl_coins", { player_discord_id: w.player_id, coin_amount: w.amount }),
    ));
  }

  const { data: parlays } = await supabaseAdmin
    .from("parlays").select("id, player_id, amount").eq("status", "pending");
  if ((parlays ?? []).length) {
    const parlayIds = parlays!.map((p) => p.id);
    await Promise.all([
      supabaseAdmin.from("parlays").update({ status: "void" }).in("id", parlayIds),
      supabaseAdmin.from("parlay_legs").update({ status: "void" }).in("parlay_id", parlayIds),
      ...parlays!.map((p) =>
        supabaseAdmin.rpc("increment_crl_coins", { player_discord_id: p.player_id, coin_amount: p.amount }),
      ),
    ]);
  }
}

async function resolveMatchWagers(matchId: string, homeScore: number, awayScore: number): Promise<void> {
  const { data: wagers } = await supabaseAdmin
    .from("wagers")
    .select("id, player_id, bet_type, amount, odds_multiplier")
    .eq("match_id", matchId)
    .eq("status", "pending");

  if (!(wagers ?? []).length) return;

  const totalGames = homeScore + awayScore;
  const homeWon = homeScore > awayScore;

  const wonIds: string[] = [];
  const lostIds: string[] = [];
  const gainByPlayer: Record<string, number> = {};

  for (const w of wagers!) {
    let won = false;
    if (w.bet_type === "home") won = homeWon;
    else if (w.bet_type === "away") won = !homeWon;
    else {
      const m = (w.bet_type as string).match(/^(over|under)_([\d.]+)$/);
      if (m) {
        const line = parseFloat(m[2]);
        won = m[1] === "over" ? totalGames > line : totalGames < line;
      }
    }
    if (won) {
      wonIds.push(w.id);
      const gain = Math.round(w.amount * Number(w.odds_multiplier));
      gainByPlayer[w.player_id] = (gainByPlayer[w.player_id] ?? 0) + gain;
    } else {
      lostIds.push(w.id);
    }
  }

  const updates: PromiseLike<unknown>[] = [];
  if (wonIds.length) updates.push(supabaseAdmin.from("wagers").update({ status: "won" }).in("id", wonIds));
  if (lostIds.length) updates.push(supabaseAdmin.from("wagers").update({ status: "lost" }).in("id", lostIds));
  for (const [playerId, gain] of Object.entries(gainByPlayer)) {
    updates.push(supabaseAdmin.rpc("increment_crl_coins", { player_discord_id: playerId, coin_amount: gain }));
  }

  await Promise.all(updates);

  // Resolve parlay legs for this match
  const { data: parlayLegs } = await supabaseAdmin
    .from("parlay_legs")
    .select("id, parlay_id, bet_type")
    .eq("match_id", matchId)
    .eq("status", "pending");

  if ((parlayLegs ?? []).length) {
    const legWonIds: string[] = [];
    const legLostIds: string[] = [];

    for (const leg of parlayLegs!) {
      let won = false;
      if (leg.bet_type === "home") won = homeWon;
      else if (leg.bet_type === "away") won = !homeWon;
      else {
        const m = (leg.bet_type as string).match(/^(over|under)_([\d.]+)$/);
        if (m) {
          const line = parseFloat(m[2]);
          won = m[1] === "over" ? totalGames > line : totalGames < line;
        }
      }
      if (won) legWonIds.push(leg.id);
      else legLostIds.push(leg.id);
    }

    const legUpdates: PromiseLike<unknown>[] = [];
    if (legWonIds.length) legUpdates.push(supabaseAdmin.from("parlay_legs").update({ status: "won" }).in("id", legWonIds));
    if (legLostIds.length) legUpdates.push(supabaseAdmin.from("parlay_legs").update({ status: "lost" }).in("id", legLostIds));
    await Promise.all(legUpdates);

    const affectedParlayIds = [...new Set(parlayLegs!.map((l) => l.parlay_id as string))];
    for (const parlayId of affectedParlayIds) {
      const { data: allLegs } = await supabaseAdmin
        .from("parlay_legs")
        .select("status")
        .eq("parlay_id", parlayId);

      const hasLost = (allLegs ?? []).some((l) => l.status === "lost");
      const allDone = (allLegs ?? []).every((l) => l.status !== "pending");

      if (hasLost) {
        await supabaseAdmin.from("parlays").update({ status: "lost" }).eq("id", parlayId);
      } else if (allDone) {
        const { data: p } = await supabaseAdmin
          .from("parlays")
          .select("player_id, amount, combined_multiplier")
          .eq("id", parlayId)
          .single();
        if (p) {
          const payout = Math.round(p.amount * Number(p.combined_multiplier));
          await Promise.all([
            supabaseAdmin.from("parlays").update({ status: "won" }).eq("id", parlayId),
            supabaseAdmin.rpc("increment_crl_coins", { player_discord_id: p.player_id, coin_amount: payout }),
          ]);
        }
      }
    }
  }
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────

export async function handleAutocomplete(interaction: Interaction) {
  const focused = interaction.data.options?.find((o) => o.focused);
  if (!focused) return { type: 8, data: { choices: [] } };

  const value = String(focused.value ?? "");
  const pattern = value ? `%${value}%` : "%";

  if (interaction.data.name === "pick") {
    const { data } = await supabaseAdmin
      .from("players").select("username").ilike("username", pattern)
      .eq("status", "approved").eq("in_active_draft", true).is("team_id", null).limit(25);
    return { type: 8, data: { choices: (data ?? []).map((p) => ({ name: p.username, value: p.username })) } };
  }

  return { type: 8, data: { choices: [] } };
}

// ─── Modal submit handler ─────────────────────────────────────────────────────

export async function handleModalSubmit(interaction: Interaction) {
  const userId = getUserId(interaction);
  const customId = interaction.data.custom_id ?? "";
  const value: string = interaction.data.components?.[0]?.components?.[0]?.value ?? "";

  const modals: Record<string, { code: string; fn: () => Promise<{ ok: boolean; message: string }> }> = {
    confirm_startdraft: { code: "CONFIRM DRAFT", fn: execStartDraft },
    confirm_enddraft:   { code: "END DRAFT",     fn: execEndDraft },
    confirm_startseason: { code: "START SEASON", fn: execStartSeason },
  };

  const modal = modals[customId];
  if (!modal) return reply("❌ Unknown confirmation.");
  if (!(await isModerator(userId))) return reply("❌ You don't have permission.");
  if (value !== modal.code) return reply(`❌ Incorrect code. Type exactly: "${modal.code}"`);

  const result = await modal.fn();
  return result.ok ? reply(result.message) : reply(`❌ ${result.message}`);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handleCommand(interaction: Interaction) {
  const userId = getUserId(interaction);
  const name = interaction.data.name;

  if (name === "admin") {
    const sub = adminSubcommand(interaction);
    const sOpt = (n: string) => optFrom(sub.opts, n);

    switch (sub.name) {
      case "setdraftchannel": return setDraftChannel(userId, interaction.channel_id ?? "");
      case "syncroles":         return syncRoles(userId);
      case "diagroles":         return diagRoles(userId);
      case "setmoderatorid":    return setStaffRoleId(userId, String(sOpt("role")), "moderator");
      case "setdirectorid":     return setStaffRoleId(userId, String(sOpt("role")), "director");
      case "setceoid":          return setStaffRoleId(userId, String(sOpt("role")), "ceo");
      case "setregisteredrole": return setRegisteredRoleId(userId, String(sOpt("role")));
      case "assignrole":        return assignRole(userId, String(sOpt("user")), String(sOpt("role")));
      case "removerole":        return removeRoleCmd(userId, String(sOpt("user")), String(sOpt("role")));
      case "setruleschannel":   return setRulesChannel(userId, interaction.channel_id ?? "");
      case "setannouncement":   return setAnnouncementChannel(userId, interaction.channel_id ?? "");
      case "setmatchcategoryanchor": {
        const categoryId = sOpt("category");
        return setMatchCategoryAnchor(userId, categoryId ? String(categoryId) : undefined);
      }
      case "checklist":  return adminChecklist(userId);
      case "disconnect": return adminDisconnect(userId, String(sOpt("confirm")));
      case "wipe":       return adminWipe(userId, String(sOpt("confirm")), sOpt("clear_history") === true);
      case "resyncmoderation": return resyncModeration(userId);
      default:           return ephemeralReply("Unknown admin subcommand.");
    }
  }

  switch (name) {
    case "totalplayers":  return totalPlayers();
    case "totalusers":    return totalUsers();
    case "playerinfo":    return playerInfo(String(opt(interaction, "username")));
    case "pick":          return pickPlayer(userId, String(opt(interaction, "player")));
    case "openround": {
      const w = opt(interaction, "round");
      return openRound(userId, w ? Number(w) : undefined);
    }
    default:              return reply("Unknown command.");
  }
}
