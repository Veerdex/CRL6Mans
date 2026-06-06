import { supabaseAdmin } from "./supabase";
import { isAdmin } from "./players";
import { addRole, removeRole, addRoleById, removeRoleById, ensureRoles, editRole, sendChannelMessage, getGuildRoles, stripRolesFromUsers, getGuildChannels, createTextChannel, deleteChannel } from "./discord-api";
import {
  nextMatchNumber, nextSlot,
  DE_WINNERS, DE_LOSERS, DE_GF,
  DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS,
  wbLoserTarget, lbWinnerTarget,
} from "./bracket";
import { buildAndSaveBracket } from "./bracket-server";

type Option = { name: string; value: string | number; focused?: boolean };
type Interaction = {
  channel_id?: string;
  channel?: { id: string; name?: string };
  data: {
    name?: string;
    options?: Option[];
    custom_id?: string;
    components?: Array<{ type: number; components: Array<{ custom_id: string; value: string }> }>;
  };
  member?: { user: { id: string } };
  user?: { id: string };
};

const reply = (content: string) => ({ type: 4, data: { content } });


function getUserId(i: Interaction) {
  return i.member?.user.id ?? i.user?.id ?? "";
}

function opt(i: Interaction, name: string): string | number {
  return i.data.options?.find((o) => o.name === name)?.value ?? "";
}

function adminGuard(userId: string) {
  if (!isAdmin(userId)) return reply("❌ You don't have permission to use this command.");
  return null;
}

// Returns a Unix timestamp (seconds) for the next occurrence of targetDay at hour:minute PT.
// Approximates PT as UTC-7 (PDT). Off by 1h during PST but acceptable for scheduling.
function nextWeekdayTimestamp(targetDay: number, hourPT: number, minutePT: number): number {
  const PT_OFFSET_MS = 7 * 60 * 60 * 1000;
  const nowPTMs = Date.now() - PT_OFFSET_MS;
  const nowPT = new Date(nowPTMs);
  const currentDay = nowPT.getUTCDay();
  let daysAhead = (targetDay - currentDay + 7) % 7;
  if (daysAhead === 0) {
    const past = nowPT.getUTCHours() > hourPT ||
      (nowPT.getUTCHours() === hourPT && nowPT.getUTCMinutes() >= minutePT);
    if (past) daysAhead = 7;
  }
  const target = new Date(nowPTMs);
  target.setUTCDate(nowPT.getUTCDate() + daysAhead);
  target.setUTCHours(hourPT, minutePT, 0, 0);
  return Math.floor((target.getTime() + PT_OFFSET_MS) / 1000);
}

type ChannelResult = { created: true } | { created: false; skipped?: true; error?: string };

const BEST_OF_DEFAULTS: Record<string, number> = { standard: 3, quarterfinals: 3, semifinals: 3, finals: 3 };

async function buildTeamMmrByName(): Promise<Record<string, number>> {
  const [{ data: teams }, { data: players }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name"),
    supabaseAdmin.from("players").select("team_id, peak_2v2, peak_3v3").not("team_id", "is", null),
  ]);
  const mmr: Record<string, number> = {};
  teams?.forEach(t => {
    const roster = players?.filter(p => p.team_id === t.id) ?? [];
    const sum = roster.reduce((s, p) => s + Math.max(Number(p.peak_2v2) || 0, Number(p.peak_3v3) || 0), 0);
    mmr[t.name] = roster.length ? sum / roster.length : 0;
  });
  return mmr;
}

function getTier(round: number, totalRounds: number): string {
  const fromFinal = totalRounds - round;
  if (fromFinal === 0) return "finals";
  if (fromFinal === 1) return "semifinals";
  if (fromFinal === 2) return "quarterfinals";
  return "standard";
}

type MatchChannelContext = {
  categoryId: string;
  deadlineDay: number;
  playDay: number;
  playHour: number;
  rulesChannelId: string | null;
  existingChannels: Array<{ id: string; name: string; parent_id?: string | null }>;
  guildRoles: Array<{ id: string; name: string }>;
  roundBestOf: Record<string, number>;
  maxRoundByStage: Record<string, number>;
  teamMmrByName: Record<string, number>;
};

// Creates a private Discord channel for a match and posts the welcome message.
// Pass a pre-fetched ctx to avoid redundant API calls when creating multiple channels.
export async function createMatchChannel(
  homeTeamName: string,
  awayTeamName: string,
  weekNum: number,
  ctx?: MatchChannelContext,
  matchInfo?: { round: number; stage: string },
): Promise<ChannelResult> {
  let resolvedCtx: MatchChannelContext;

  if (ctx) {
    resolvedCtx = ctx;
  } else {
    const { data: settings } = await supabaseAdmin
      .from("league_settings")
      .select("match_category_id, match_deadline_day, match_play_day, match_play_hour, rules_channel_id, season_format")
      .single();
    const categoryId: string | null = settings?.match_category_id ?? null;
    if (!categoryId) return { created: false, error: "No match category set — run `/setmatchcategory` first." };
    const format = settings?.season_format as { roundBestOf?: Record<string, number> } | null;
    const [existingChannels, guildRoles, allMatches, teamMmrByName] = await Promise.all([
      getGuildChannels(),
      getGuildRoles(),
      supabaseAdmin.from("matches").select("stage, round").then(r => r.data ?? []),
      buildTeamMmrByName(),
    ]);
    const maxRoundByStage: Record<string, number> = {};
    allMatches.forEach(m => {
      maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
    });
    resolvedCtx = {
      categoryId,
      deadlineDay: settings?.match_deadline_day ?? 2,
      playDay:     settings?.match_play_day   ?? 0,
      playHour:    settings?.match_play_hour  ?? 19,
      rulesChannelId: settings?.rules_channel_id ?? null,
      existingChannels,
      guildRoles,
      roundBestOf: format?.roundBestOf ?? {},
      maxRoundByStage,
      teamMmrByName,
    };
  }

  const { categoryId, deadlineDay, playDay, playHour, rulesChannelId, existingChannels, guildRoles, roundBestOf, maxRoundByStage, teamMmrByName } = resolvedCtx;

  const channelName = `${homeTeamName}-vs-${awayTeamName}`
    .toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 100);

  if (existingChannels.some(c => c.name === channelName && c.parent_id === categoryId)) {
    return { created: false, skipped: true };
  }

  // Ensure team roles exist (creates them if missing, e.g. when using test teams)
  let homeRole = guildRoles.find(r => r.name === homeTeamName);
  let awayRole = guildRoles.find(r => r.name === awayTeamName);
  if (!homeRole || !awayRole) {
    const needed = [homeTeamName, awayTeamName].filter(n => !guildRoles.find(r => r.name === n));
    const newRoles = await ensureRoles(needed);
    const refreshed = await getGuildRoles();
    homeRole = refreshed.find(r => r.name === homeTeamName);
    awayRole = refreshed.find(r => r.name === awayTeamName);
  }
  const allowedRoleIds = [homeRole?.id, awayRole?.id].filter(Boolean) as string[];

  const result = await createTextChannel(channelName, categoryId, allowedRoleIds);
  if (!result.id) return { created: false, error: result.error };

  const deadlineTs = nextWeekdayTimestamp(deadlineDay, 23, 59);
  const playTs     = nextWeekdayTimestamp(playDay, playHour, 0);

  // Determine home/away by MMR (higher MMR = home; equal = random)
  const mmrA = teamMmrByName[homeTeamName] ?? 0;
  const mmrB = teamMmrByName[awayTeamName] ?? 0;
  const aIsHome = mmrA > mmrB ? true : mmrA < mmrB ? false : Math.random() >= 0.5;
  const [trueHome, trueAway] = aIsHome ? [homeTeamName, awayTeamName] : [awayTeamName, homeTeamName];
  const trueHomeRole = aIsHome ? homeRole : awayRole;
  const trueAwayRole = aIsHome ? awayRole : homeRole;
  const homePing = trueHomeRole ? `<@&${trueHomeRole.id}>` : `**${trueHome}**`;
  const awayPing = trueAwayRole ? `<@&${trueAwayRole.id}>` : `**${trueAway}**`;
  const rulesRef = rulesChannelId ? `<#${rulesChannelId}>` : "the rulebook";

  // Determine best-of from round tier
  let bestOf = 3;
  if (matchInfo) {
    const totalRounds = maxRoundByStage[matchInfo.stage] ?? matchInfo.round;
    const tier = getTier(matchInfo.round, totalRounds);
    bestOf = roundBestOf[tier] ?? BEST_OF_DEFAULTS[tier] ?? 3;
  }

  const message =
    `## Welcome to Round ${weekNum}! ##\n\n` +
    `Match: ${homePing} 🏠 **Home**  vs  ${awayPing} ✈️ **Away**\n` +
    `Scheduled for: <t:${playTs}:F>\n` +
    `Match Deadline: <t:${deadlineTs}:F>\n` +
    `Format: **Best of ${bestOf}**\n\n` +
    `- In the event a team can't make this time, please discuss an alternative.\n` +
    `- If a sub is needed, please follow what is listed in the rulebook located in ${rulesRef}. ` +
    `If these procedures are not followed, a match played with the illegal sub will be forfeited.\n` +
    `- **To report a match**: Tag an admin/moderator, list the teams and respective scores, and __upload replays__. ` +
    `The admin will remove the channel manually. Need more info?`;

  await sendChannelMessage(result.id, message);
  return { created: true };
}

// Deletes all channels inside the configured match category. Returns count deleted.
export async function deleteMatchChannels(): Promise<number> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("match_category_id").single();
  const categoryId = settings?.match_category_id;
  if (!categoryId) return 0;
  const channels = await getGuildChannels();
  const matchChannels = channels.filter(c => c.parent_id === categoryId);
  await Promise.all(matchChannels.map(c => deleteChannel(c.id)));
  return matchChannels.length;
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

function confirmModal(customId: string, title: string, code: string) {
  return {
    type: 9,
    data: {
      title,
      custom_id: customId,
      components: [{
        type: 1,
        components: [{
          type: 4,
          custom_id: "code",
          label: `Type "${code}" to confirm`,
          style: 1,
          min_length: code.length,
          max_length: code.length,
          placeholder: code,
        }],
      }],
    },
  };
}

async function getTeamByPosition(position: number, fields = "id"): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin.from("teams")
    .select(fields).not("slot_number", "is", null).order("slot_number");
  return (data ?? [])[position - 1] ?? null;
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

export async function execStartDraft(): Promise<{ ok: boolean; message: string }> {
  const { data: settings } = await supabaseAdmin.from("league_settings").select("*").single();
  if (!settings?.num_teams)
    return { ok: false, message: "Set the number of teams first with `/setnumteams`." };
  if (!settings?.draft_channel_id)
    return { ok: false, message: "Set a draft channel first with `/setdraftchannel`." };
  if (settings.draft_active)
    return { ok: false, message: "❌ A draft is already in progress. Use `/enddraft` first." };
  if (settings.season_active)
    return { ok: false, message: "❌ A season is currently active. End the season before starting a new draft." };

  const numTeams: number = settings.num_teams;

  const { data: enteredAll } = await supabaseAdmin
    .from("players")
    .select("id, username, discord_id, peak_2v2, current_2v2, peak_3v3, current_3v3, draft_entered_at")
    .eq("status", "approved")
    .eq("draft_entered", true)
    .order("draft_entered_at", { ascending: true, nullsFirst: false });

  if (!enteredAll?.length) return { ok: false, message: "No players have entered the draft." };

  // Apply cutoff: first numTeams × 3 by sign-up time
  const entered = enteredAll.slice(0, numTeams * 3);
  if (entered.length < numTeams)
    return { ok: false, message: `Need at least ${numTeams} players in the draft pool (have ${entered.length} after cutoff, need ${numTeams}).` };

  // Mark only cutoff players as active; clear any previous active flags first
  await supabaseAdmin.from("players").update({ in_active_draft: false }).eq("status", "approved");
  await supabaseAdmin.from("players").update({ in_active_draft: true }).in("id", entered.map(p => p.id));

  // Validate pre-created team slots (identified by slot_number, not current name)
  const { data: allPreTeams } = await supabaseAdmin
    .from("teams").select("id, name, discord_role_id, slot_number").not("slot_number", "is", null).order("slot_number");
  const numberedTeams = (allPreTeams ?? [])
    .filter((t): t is typeof t & { slot_number: number } => typeof t.slot_number === "number")
    .map(t => ({ ...t, num: t.slot_number }))
    .sort((a, b) => a.num - b.num);

  if (numberedTeams.length < numTeams)
    return { ok: false, message: `Need ${numTeams} team slots but only ${numberedTeams.length} exist. Add them in the admin panel first.` };

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

  // Build captain assignments before any awaits
  const captainLines: string[] = [];
  const captains: Array<{ discordId: string | null; teamRoleId?: string }> = [];
  for (let i = 0; i < numTeams; i++) {
    captainLines.push(`Team ${teamsToUse[i].num}: **${sorted[i].username}** (RV: ${rankValue(sorted[i]).toFixed(0)})`);
    captains.push({ discordId: sorted[i].discord_id ?? null, teamRoleId: teamsToUse[i].discord_role_id ?? undefined });
  }

  // All DB writes in one parallel batch, then immediately mark draft active
  await Promise.all([
    supabaseAdmin.from("players").update({ team_id: null, is_captain: false }).eq("status", "approved"),
    supabaseAdmin.from("matches").delete().not("id", "is", null),
    supabaseAdmin.from("teams").update({ credits: 1000 }).in("id", teamsToUse.map(t => t.id)),
    ...teamsToUse.map(t =>
      supabaseAdmin.from("teams").update({ wins: 0, losses: 0, name: `Team ${t.num}` }).eq("id", t.id)
    ),
    ...sorted.slice(0, numTeams).map((captain, i) =>
      supabaseAdmin.from("players")
        .update({ team_id: teamsToUse[i].id, is_captain: true, updated_at: new Date().toISOString() })
        .eq("id", captain.id)
    ),
  ]);

  const { data: activateRows, error: activateError } = await supabaseAdmin
    .from("league_settings").update({
      draft_active: true, draft_open: false, current_pick: 0,
      draft_phase: "nomination",
      nominated_player_id: null, current_bid: null, current_bid_team_id: null, current_bid_time: null,
      pick_deadline: new Date(Date.now() + 45 * 1000).toISOString(),
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
  if (realDiscordIds.length > 0 && roleIdsToStrip.length > 0) {
    const BATCH = 5;
    for (let i = 0; i < realDiscordIds.length; i += BATCH) {
      await Promise.all(
        realDiscordIds.slice(i, i + BATCH).flatMap(uid =>
          roleIdsToStrip.map(rid => removeRoleById(uid, rid))
        )
      );
    }
  }

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
  const sizeNote = `3 per team · 1,000 credits each${undrafted > 0 ? ` · ${undrafted} not drafted` : ""}`;
  const firstTeamNum = getTeamNumberForPick(0, numTeams);
  const firstCaptainPing = await getCaptainPing(firstTeamNum);

  const startMsg =
    `🚀 **Auction Draft has started!**\n` +
    `${numTeams} teams · ${sorted.length} entered · ${sizeNote}\n\n` +
    `**Captains (auto-assigned by Rank Value):**\n${captainLines.join("\n")}\n\n` +
    `**Nomination order (snake):** ${round1}, ${round2}, …\n` +
    `Max starting bid: **800 credits** · Use \`/budget\` to check credits\n\n` +
    `⏭️ ${firstCaptainPing} (**Team ${firstTeamNum}**), you're on the clock! Use \`/nominate <player> <bid>\` *(45 sec)*`;

  await sendChannelMessage(settings.draft_channel_id, startMsg);
  return { ok: true, message: `Auction draft started! Check <#${settings.draft_channel_id}>.` };
}

export async function execEndDraft(): Promise<{ ok: boolean; message: string }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("draft_active").single();
  if (!settings?.draft_active)
    return { ok: false, message: "❌ No draft is currently active." };
  await Promise.all([
    supabaseAdmin.from("league_settings").update({
      draft_active: false, draft_phase: null,
      nominated_player_id: null, current_bid: null, current_bid_team_id: null, current_bid_time: null,
      pick_deadline: null, updated_at: new Date().toISOString(),
    }).not("id", "is", null),
    supabaseAdmin.from("players").update({ in_active_draft: false }).eq("status", "approved"),
  ]);
  return { ok: true, message: "🔒 **Draft has ended.** Rosters are now locked." };
}

type AuctionSettings = {
  num_teams: number; current_pick: number; draft_channel_id: string | null;
  nominated_player_id: string; current_bid_team_id: string; current_bid: number;
};

async function concludeAuction(s: AuctionSettings): Promise<{ ok: boolean; message: string }> {
  const totalPicks = s.num_teams * 2;

  const [{ data: player }, { data: winnerTeam }] = await Promise.all([
    supabaseAdmin.from("players").select("id, username, discord_id").eq("id", s.nominated_player_id).single(),
    supabaseAdmin.from("teams").select("id, name, credits, discord_role_id").eq("id", s.current_bid_team_id).single(),
  ]);
  if (!player || !winnerTeam) return { ok: false, message: "❌ Could not find player or team." };

  const remainingCredits = (winnerTeam.credits ?? 0) - s.current_bid;
  await Promise.all([
    supabaseAdmin.from("players").update({ team_id: winnerTeam.id, updated_at: new Date().toISOString() }).eq("id", player.id),
    supabaseAdmin.from("teams").update({ credits: remainingCredits }).eq("id", winnerTeam.id),
  ]);

  if (player.discord_id) {
    const roleMap = await ensureRoles(["Drafted"]);
    if (roleMap["Drafted"]) await addRoleById(player.discord_id, roleMap["Drafted"]);
    if (winnerTeam.discord_role_id) await addRoleById(player.discord_id, winnerTeam.discord_role_id);
    else await addRole(player.discord_id, winnerTeam.name);
    await removeRole(player.discord_id, "EnteredDraft");
  }

  const newPick = s.current_pick + 1;
  const isDone = newPick >= totalPicks;

  await supabaseAdmin.from("league_settings").update({
    draft_phase: isDone ? null : "nomination",
    nominated_player_id: null, current_bid: null, current_bid_team_id: null, current_bid_time: null,
    current_pick: newPick,
    pick_deadline: isDone ? null : new Date(Date.now() + 45 * 1000).toISOString(),
    ...(isDone ? { draft_active: false } : {}),
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);

  if (s.draft_channel_id) {
    let msg =
      `🏆 **${player.username}** → **${winnerTeam.name}** for **${s.current_bid}** credits! ` +
      `(${winnerTeam.name}: **${remainingCredits}** credits remaining)`;
    if (isDone) {
      msg += "\n\n🏁 **Auction draft complete! Rosters are locked.**";
    } else {
      const nextTeamNum = getTeamNumberForPick(newPick, s.num_teams);
      const nextPing = await getCaptainPing(nextTeamNum);
      msg += `\n\n⏭️ ${nextPing} (**Team ${nextTeamNum}**), nominate next! Use \`/nominate <player> <bid>\` *(45 sec)*`;
    }
    await sendChannelMessage(s.draft_channel_id, msg);
  }

  return { ok: true, message: isDone ? "🏁 Draft complete!" : `✅ **${player.username}** → **${winnerTeam.name}** for **${s.current_bid}** credits.` };
}

export async function execAutoPick(): Promise<{ done: boolean }> {
  const { data: settings, error: settingsErr } = await supabaseAdmin.from("league_settings").select("*").single();
  if (settingsErr) { console.error("[execAutoPick] settings read failed:", settingsErr.message); return { done: true }; }
  if (!settings?.draft_active) { console.log("[execAutoPick] draft not active"); return { done: true }; }

  const deadline: Date | null = settings.pick_deadline ? new Date(settings.pick_deadline) : null;
  if (!deadline) { console.log("[execAutoPick] no pick_deadline"); return { done: true }; }
  if (new Date() < deadline) { console.log("[execAutoPick] deadline not yet reached, msLeft:", deadline.getTime() - Date.now()); return { done: true }; }

  const numTeams: number = settings.num_teams;
  const currentPick: number = settings.current_pick ?? 0;
  const channelId: string | null = settings.draft_channel_id ?? null;
  const totalPicks = numTeams * 2;

  console.log(`[execAutoPick] phase=${settings.draft_phase} pick=${currentPick}/${totalPicks}`);

  // Nomination timeout → auto-nominate highest RV player at 1 credit
  if (settings.draft_phase === "nomination") {
    if (currentPick >= totalPicks) {
      await supabaseAdmin.from("league_settings").update({
        draft_active: false, draft_phase: null, pick_deadline: null, updated_at: new Date().toISOString(),
      }).not("id", "is", null);
      return { done: true };
    }

    const currentTeamNum = getTeamNumberForPick(currentPick, numTeams);
    // Select only id — credits not needed for auto-nomination and may not be in schema cache
    const teamRow = await getTeamByPosition(currentTeamNum, "id, name") as { id: string; name: string } | null;
    if (!teamRow) {
      console.error(`[execAutoPick] No team at position ${currentTeamNum} (pick ${currentPick}/${totalPicks}, numTeams=${numTeams})`);
      return { done: true };
    }
    console.log(`[execAutoPick] team position ${currentTeamNum} → id=${teamRow.id} name="${teamRow.name}"`);

    const { data: available, error: avErr } = await supabaseAdmin.from("players")
      .select("id, username, discord_id, peak_2v2, current_2v2, peak_3v3, current_3v3")
      .eq("status", "approved").eq("in_active_draft", true).is("team_id", null);
    if (avErr) { console.error("[execAutoPick] available players query failed:", avErr.message); return { done: true }; }

    if (!available?.length) {
      console.log("[execAutoPick] no available players — ending draft");
      await supabaseAdmin.from("league_settings").update({
        draft_active: false, draft_phase: null, pick_deadline: null, updated_at: new Date().toISOString(),
      }).not("id", "is", null);
      return { done: true };
    }

    const best = [...available].sort((a, b) => rankValue(b) - rankValue(a))[0];
    console.log(`[execAutoPick] auto-nominating "${best.username}" for team "${teamRow.name}"`);
    const { error: updateErr } = await supabaseAdmin.from("league_settings").update({
      draft_phase: "bidding",
      nominated_player_id: best.id,
      current_bid: 1,
      current_bid_team_id: teamRow.id,
      current_bid_time: new Date().toISOString(),
      pick_deadline: new Date(Date.now() + 45 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).not("id", "is", null);
    if (updateErr) { console.error("[execAutoPick] league_settings update failed:", updateErr.message); return { done: true }; }

    if (channelId) {
      await sendChannelMessage(channelId,
        `⏰ **Team ${currentTeamNum}** ran out of time! **${best.username}** auto-nominated for **1** credit.\n` +
        `Use \`/bid <amount>\` to bid higher. *(45 sec)*`
      );
    }
    return { done: false };
  }

  // Bidding phase: deadline expired → auto-close, highest bidder wins.
  if (!settings.nominated_player_id || !settings.current_bid_team_id || !settings.current_bid) {
    console.error("[execAutoPick] bidding phase expired but missing auction data");
    return { done: true };
  }
  const closeResult = await concludeAuction({
    num_teams: numTeams,
    current_pick: currentPick,
    draft_channel_id: channelId,
    nominated_player_id: settings.nominated_player_id as string,
    current_bid_team_id: settings.current_bid_team_id as string,
    current_bid: settings.current_bid as number,
  });
  console.log("[execAutoPick] bidding auto-closed:", closeResult.message);
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

export async function execStartSeason(): Promise<{ ok: boolean; message: string }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("season_format, num_teams, draft_active, season_active")
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

  await supabaseAdmin.from("league_settings")
    .update({ season_active: true, updated_at: new Date().toISOString() })
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

  // Create match channels for round 1 matches that already have both teams assigned.
  const { data: r1Matches } = await supabaseAdmin
    .from("matches")
    .select("home_team_id, away_team_id, round, stage")
    .eq("status", "scheduled")
    .eq("round", 1)
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null);

  if (r1Matches?.length) {
    const teamIds = [...new Set(r1Matches.flatMap(m => [m.home_team_id!, m.away_team_id!]))];
    const { data: teamsData } = await supabaseAdmin.from("teams").select("id, name").in("id", teamIds);
    const teamNameById: Record<string, string> = {};
    teamsData?.forEach(t => { teamNameById[t.id] = t.name; });
    for (const m of r1Matches) {
      const h = teamNameById[m.home_team_id!];
      const a = teamNameById[m.away_team_id!];
      if (h && a) {
        const r = await createMatchChannel(h, a, m.round, undefined, { round: m.round, stage: m.stage });
        if (!r.created && r.error) console.error("[createMatchChannel]", r.error);
      }
    }
  }

  return { ok: true, message: `🏆 **Season has officially started!** ${numTeams} teams · ${format.preset.replace(/_/g, " ")} · Bracket generated.` };
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

async function pending(userId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;

  const { data } = await supabaseAdmin
    .from("players").select("username, peak_3v3, peak_2v2").eq("status", "pending")
    .order("created_at", { ascending: true });

  if (!data?.length) return reply("✅ No pending registrations.");
  const list = data
    .map((p, i) => `${i + 1}. **${p.username}** — 3s: ${p.peak_3v3} | 2s: ${p.peak_2v2}`)
    .join("\n");
  return reply(`📋 **Pending registrations (${data.length}):**\n${list}`);
}

async function approve(userId: string, username: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from("players")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .ilike("username", username).eq("status", "pending")
    .select("username, discord_id").single();

  if (error || !data) return reply(`❌ No pending player found: "${username}"`);
  if (data.discord_id) await addRole(data.discord_id, "Registered");
  return reply(`✅ **${data.username}** has been approved!`);
}

async function reject(userId: string, username: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from("players")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .ilike("username", username).eq("status", "pending")
    .select("username").single();

  if (error || !data) return reply(`❌ No pending player found: "${username}"`);
  return reply(`❌ **${data.username}** has been rejected.`);
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

async function setNumTeams(userId: string, count: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;

  const { count: enteredCount } = await supabaseAdmin
    .from("players").select("*", { count: "exact", head: true })
    .eq("status", "approved").eq("draft_entered", true);
  const entered = enteredCount ?? 0;

  let numTeams: number;
  if (count.toLowerCase() === "max") {
    numTeams = Math.floor(entered / 3);
    if (numTeams < 1) return reply(`❌ Need at least 3 players in the draft pool to create teams (currently ${entered}).`);
  } else {
    numTeams = parseInt(count);
    if (isNaN(numTeams) || numTeams < 1) return reply("❌ Provide a valid number or `max`.");
    const required = numTeams * 3;
    if (entered < required)
      return reply(`❌ ${numTeams} teams requires **${required} players** in the draft pool (currently ${entered}).`);
  }

  await supabaseAdmin.from("league_settings")
    .update({ num_teams: numTeams, updated_at: new Date().toISOString() }).not("id", "is", null);

  return reply(`✅ Number of teams set to **${numTeams}**.`);
}

// Start/End/Season now show confirmation modals
async function startDraft(userId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  return confirmModal("confirm_startdraft", "Start Draft", "CONFIRM DRAFT");
}

async function endDraft(userId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  return confirmModal("confirm_enddraft", "End Draft", "END DRAFT");
}

async function startSeason(userId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  return confirmModal("confirm_startseason", "Start Season", "START SEASON");
}

async function setDraftChannel(userId: string, channelId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  if (!channelId) return reply("❌ Provide a channel ID.");

  await supabaseAdmin.from("league_settings")
    .update({ draft_channel_id: channelId, updated_at: new Date().toISOString() }).not("id", "is", null);

  return reply(`✅ Draft channel set to <#${channelId}>. The draft will post there.`);
}

async function nominatePlayer(userId: string, playerUsername: string, startingBid: number) {
  const { data: settings } = await supabaseAdmin.from("league_settings").select("*").single();
  if (!settings?.draft_active) return reply("❌ No draft is currently active.");
  if (settings.draft_phase === "bidding")
    return reply(`❌ **${(await supabaseAdmin.from("players").select("username").eq("id", settings.nominated_player_id).single()).data?.username}** is already up for auction. Use \`/bid\`.`);
  if (settings.draft_phase !== "nomination") return reply("❌ Not in nomination phase.");

  const numTeams: number = settings.num_teams;
  const currentPick: number = settings.current_pick ?? 0;
  if (currentPick >= numTeams * 2) return reply("✅ Draft is already complete.");

  const currentTeamNum = getTeamNumberForPick(currentPick, numTeams);

  if (!isAdmin(userId)) {
    const { data: caller } = await supabaseAdmin.from("players").select("is_captain, team_id").eq("discord_id", userId).single();
    if (!caller?.is_captain) return reply("❌ Only captains can nominate.");
    const { data: callerTeam } = await supabaseAdmin.from("teams").select("slot_number").eq("id", caller.team_id).single();
    if (!callerTeam || callerTeam.slot_number !== currentTeamNum)
      return reply(`❌ It's **Team ${currentTeamNum}**'s turn to nominate.`);
  }

  if (startingBid < 1 || startingBid > 800)
    return reply("❌ Starting bid must be between **1** and **800** credits.");

  const currentTeam = await getTeamByPosition(currentTeamNum, "id, name, credits") as {
    id: string; name: string; credits: number;
  } | null;
  if (!currentTeam)
    return reply(`❌ Team lookup failed: no team at position ${currentTeamNum} (pick ${currentPick}/${numTeams * 2}).`);

  const { count: rosterSize } = await supabaseAdmin.from("players")
    .select("*", { count: "exact", head: true }).eq("team_id", currentTeam.id).eq("status", "approved");
  const stillNeeded = 3 - (rosterSize ?? 0);
  const reserve = Math.max(0, stillNeeded - 1);
  const maxBid = (currentTeam.credits ?? 0) - reserve;

  if (startingBid > maxBid)
    return reply(`❌ You have **${currentTeam.credits}** credits with **${reserve}** reserved. Max bid: **${maxBid}**.`);

  const { data: target } = await supabaseAdmin.from("players")
    .select("id, username, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .ilike("username", playerUsername).eq("status", "approved").eq("in_active_draft", true).is("team_id", null).single();
  if (!target) return reply(`❌ "${playerUsername}" is not in the draft pool.`);

  await supabaseAdmin.from("league_settings").update({
    draft_phase: "bidding",
    nominated_player_id: target.id,
    current_bid: startingBid,
    current_bid_team_id: currentTeam.id,
    current_bid_time: new Date().toISOString(),
    pick_deadline: new Date(Date.now() + 45 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).not("id", "is", null);

  if (settings.draft_channel_id) {
    await sendChannelMessage(settings.draft_channel_id,
      `🎯 **${currentTeam.name}** nominates **${target.username}** (RV: ${rankValue(target).toFixed(0)}) ` +
      `with a starting bid of **${startingBid}** credits!\n` +
      `Current high bid: **${startingBid}** — **${currentTeam.name}**\n` +
      `Use \`/bid <amount>\` to bid higher. *(45 sec)*`
    );
  }
  return reply(`✅ Nominated **${target.username}** for **${startingBid}** credits.`);
}

async function placeBid(userId: string, amount: number) {
  const { data: settings } = await supabaseAdmin.from("league_settings").select("*").single();
  if (!settings?.draft_active) return reply("❌ No draft is currently active.");
  if (settings.draft_phase !== "bidding") return reply("❌ No player is currently up for auction.");

  if (amount <= (settings.current_bid ?? 0))
    return reply(`❌ Bid must be higher than the current bid of **${settings.current_bid}** credits.`);

  const { data: caller } = await supabaseAdmin.from("players").select("team_id, is_captain").eq("discord_id", userId).single();
  if (!caller?.team_id) return reply("❌ You are not on a team.");
  if (!caller.is_captain && !isAdmin(userId)) return reply("❌ Only team captains can bid.");
  if (caller.team_id === settings.current_bid_team_id) return reply("❌ You are already the highest bidder.");

  const { data: team } = await supabaseAdmin.from("teams").select("id, name, credits, last_bid_time").eq("id", caller.team_id).single();
  if (!team) return reply("❌ Team not found.");

  // 5-second slow mode: enforce per-team cooldown between bids
  if (team.last_bid_time) {
    const msSinceLastBid = Date.now() - new Date(team.last_bid_time as string).getTime();
    if (msSinceLastBid < 5000) {
      const secondsLeft = Math.ceil((5000 - msSinceLastBid) / 1000);
      return reply(`❌ Slow mode — wait **${secondsLeft}s** before bidding again.`);
    }
  }

  const { count: rosterSize } = await supabaseAdmin.from("players")
    .select("*", { count: "exact", head: true }).eq("team_id", caller.team_id).eq("status", "approved");
  if ((rosterSize ?? 0) >= 3) return reply("❌ Your roster is already full.");
  const stillNeeded = 3 - (rosterSize ?? 0);
  const reserve = Math.max(0, stillNeeded - 1);
  const maxBid = (team.credits ?? 0) - reserve;

  if (amount > maxBid)
    return reply(`❌ You have **${team.credits}** credits with **${reserve}** reserved. Max bid: **${maxBid}**.`);

  const { data: bidUpdate } = await supabaseAdmin.from("league_settings").update({
    current_bid: amount,
    current_bid_team_id: caller.team_id,
    current_bid_time: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).not("id", "is", null).eq("current_bid", settings.current_bid as number ?? 0).select("id");
  if (!bidUpdate?.length) return reply("❌ Another bid was placed at the same time. Please try again.");

  // Record bid time for slow mode
  await supabaseAdmin.from("teams").update({ last_bid_time: new Date().toISOString() }).eq("id", caller.team_id);

  const { data: player } = await supabaseAdmin.from("players").select("username").eq("id", settings.nominated_player_id).single();
  if (settings.draft_channel_id) {
    await sendChannelMessage(settings.draft_channel_id,
      `💰 **${team.name}** bids **${amount}** credits for **${player?.username ?? "?"}**!`
    );
  }
  return reply(`✅ Bid of **${amount}** credits placed!`);
}

async function endRound(userId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  const { data: settings } = await supabaseAdmin.from("league_settings").select("*").single();
  if (!settings?.draft_active || settings.draft_phase !== "bidding")
    return reply("❌ No active auction to end.");
  const result = await concludeAuction({
    num_teams: settings.num_teams as number,
    current_pick: (settings.current_pick as number) ?? 0,
    draft_channel_id: settings.draft_channel_id as string | null,
    nominated_player_id: settings.nominated_player_id as string,
    current_bid_team_id: settings.current_bid_team_id as string,
    current_bid: settings.current_bid as number,
  });
  return reply(result.message);
}

async function checkBudget(userId: string) {
  const { data: player } = await supabaseAdmin.from("players").select("team_id, is_captain").eq("discord_id", userId).single();
  if (!player?.team_id) return reply("❌ You are not on a team.");
  const { data: team } = await supabaseAdmin.from("teams").select("name, credits").eq("id", player.team_id).single();
  if (!team) return reply("❌ Team not found.");
  const { count: rosterSize } = await supabaseAdmin.from("players")
    .select("*", { count: "exact", head: true }).eq("team_id", player.team_id).eq("status", "approved");
  const stillNeeded = 3 - (rosterSize ?? 0);
  const reserve = Math.max(0, stillNeeded - 1);
  return reply(
    `💰 **${team.name}** — **${team.credits ?? 0}** credits\n` +
    `Players still needed: **${stillNeeded}** · Reserved: **${reserve}** · Max bid: **${(team.credits ?? 0) - reserve}**`
  );
}

async function draftPool(userId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;

  const { data: settings } = await supabaseAdmin.from("league_settings").select("*").single();
  const numTeams: number = settings?.num_teams ?? 0;
  const currentPick: number = settings?.current_pick ?? 0;

  const { data } = await supabaseAdmin
    .from("players").select("username, peak_3v3, current_3v3, peak_2v2, current_2v2")
    .eq("status", "approved").eq("draft_entered", true).is("team_id", null);

  if (!data?.length) return reply("No players available in the draft pool.");

  const sorted = [...data].sort((a, b) => rankValue(b) - rankValue(a));
  const lines = sorted.map((p, i) =>
    `${i + 1}. **${p.username}** — RV: ${rankValue(p).toFixed(0)} (3s: ${p.peak_3v3} | 2s: ${p.peak_2v2})`
  );

  let header = `🎯 **Draft Pool (${sorted.length} players):**`;
  if (settings?.draft_active && numTeams > 0)
    header += `\n⏱️ **Team ${getTeamNumberForPick(currentPick, numTeams)}** is on the clock.`;

  const content = `${header}\n${lines.join("\n")}`;
  return reply(content.length > 1900 ? content.slice(0, 1900) + "\n…(truncated)" : content);
}

async function draftCount() {
  const { count } = await supabaseAdmin
    .from("players").select("*", { count: "exact", head: true })
    .eq("status", "approved").eq("draft_entered", true);
  return reply(`📋 **Players entered in draft:** ${count ?? 0}`);
}

async function enterDraft(userId: string) {
  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, username, status, peak_2v2, current_2v2, peak_3v3, current_3v3")
    .eq("discord_id", userId).single();

  if (!player) return reply("❌ You are not registered. Sign up on the website first.");
  if (player.status !== "approved") return reply("❌ Your registration must be approved first.");

  const rv = rankValue(player);
  if (rv < 1280) {
    return reply(
      `❌ Your Rank Value of **${rv.toFixed(0)}** is below the minimum of **1280**.\n` +
      `RV = [(Peak 2s + Season Peak 2s) × 1.2 + (Peak 3s + Season Peak 3s) × 0.8] ÷ 4`
    );
  }

  const { data: signupSettings } = await supabaseAdmin
    .from("league_settings").select("draft_open").single();
  if (!signupSettings?.draft_open) return reply("❌ Draft signups are not currently open.");

  await supabaseAdmin.from("players")
    .update({ draft_entered: true, updated_at: new Date().toISOString() }).eq("id", player.id);
  await addRole(userId, "EnteredDraft");
  return reply(`✅ **${player.username}**, you've entered the draft! (RV: ${rv.toFixed(0)})`);
}

async function leaveDraft(userId: string) {
  const { data: draftSettings } = await supabaseAdmin
    .from("league_settings").select("draft_active, season_active").single();
  if (draftSettings?.draft_active || draftSettings?.season_active)
    return reply("❌ You cannot leave the draft once the draft or season has started.");

  const { data: player } = await supabaseAdmin
    .from("players").select("id, username").eq("discord_id", userId).single();

  if (!player) return reply("❌ You are not registered.");

  await supabaseAdmin.from("players")
    .update({ draft_entered: false, updated_at: new Date().toISOString() }).eq("id", player.id);
  await removeRole(userId, "EnteredDraft");
  return reply(`👋 **${player.username}**, you've been removed from the draft.`);
}

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

async function setMatchCategory(userId: string, categoryId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  const { error } = await supabaseAdmin.from("league_settings")
    .update({ match_category_id: categoryId, updated_at: new Date().toISOString() }).not("id", "is", null);
  if (error) return reply(`❌ DB error: ${error.message} — make sure the \`match_category_id\` column exists in \`league_settings\`.`);
  return reply(`✅ Match channels will be created in <#${categoryId}>.`);
}

async function setDeadlineDay(userId: string, day: number) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  const { error } = await supabaseAdmin.from("league_settings")
    .update({ match_deadline_day: day, updated_at: new Date().toISOString() }).not("id", "is", null);
  if (error) return reply(`❌ DB error: ${error.message}`);
  return reply(`✅ Match deadline set to **${DAYS[day]}s at 11:59 pm PT**.`);
}

async function setPlayTime(userId: string, day: number, hour: number) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  const h12 = hour === 0 ? "12:00 am" : hour < 12 ? `${hour}:00 am` : hour === 12 ? "12:00 pm" : `${hour - 12}:00 pm`;
  const { error } = await supabaseAdmin.from("league_settings")
    .update({ match_play_day: day, match_play_hour: hour, updated_at: new Date().toISOString() }).not("id", "is", null);
  if (error) return reply(`❌ DB error: ${error.message}`);
  return reply(`✅ Default play time set to **${DAYS[day]}s at ${h12} PT**.`);
}

async function setRulesChannel(userId: string, channelId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  const { error } = await supabaseAdmin.from("league_settings")
    .update({ rules_channel_id: channelId, updated_at: new Date().toISOString() }).not("id", "is", null);
  if (error) return reply(`❌ DB error: ${error.message}`);
  return reply(`✅ Rules channel set to <#${channelId}>.`);
}

async function openRound(userId: string, roundOverride?: number) {
  const denied = adminGuard(userId);
  if (denied) return denied;

  const { data: matches } = await supabaseAdmin
    .from("matches")
    .select("home_team_id, away_team_id, round, stage")
    .eq("status", "scheduled")
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null);

  if (!matches?.length) return reply("❌ No upcoming matches found.");

  const teamIds = [...new Set(matches.flatMap(m => [m.home_team_id!, m.away_team_id!]))];
  const { data: teamsData } = await supabaseAdmin.from("teams").select("id, name").in("id", teamIds);
  const teamNameById: Record<string, string> = {};
  teamsData?.forEach(t => { teamNameById[t.id] = t.name; });

  // Pre-fetch settings, channels, and roles once for all matches
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("match_category_id, match_deadline_day, match_play_day, match_play_hour, rules_channel_id")
    .single();

  const categoryId: string | null = settings?.match_category_id ?? null;
  if (!categoryId) return reply("❌ No match category set — run `/setmatchcategory` first.");

  // Ensure every team that appears in a scheduled match has a Discord role
  const allTeamNames = [...new Set(
    matches.flatMap(m => [teamNameById[m.home_team_id!], teamNameById[m.away_team_id!]]).filter(Boolean)
  )];
  await ensureRoles(allTeamNames);

  const format = settings?.season_format as { roundBestOf?: Record<string, number> } | null;
  const [existingChannels, guildRoles, allMatchRows, teamMmrByName] = await Promise.all([
    getGuildChannels(),
    getGuildRoles(),
    supabaseAdmin.from("matches").select("stage, round").then(r => r.data ?? []),
    buildTeamMmrByName(),
  ]);
  const maxRoundByStage: Record<string, number> = {};
  allMatchRows.forEach((m: { stage: string; round: number }) => {
    maxRoundByStage[m.stage] = Math.max(maxRoundByStage[m.stage] ?? 0, m.round);
  });
  const ctx = {
    categoryId,
    deadlineDay:    settings?.match_deadline_day ?? 2,
    playDay:        settings?.match_play_day   ?? 0,
    playHour:       settings?.match_play_hour  ?? 19,
    rulesChannelId: settings?.rules_channel_id ?? null,
    existingChannels,
    guildRoles,
    roundBestOf: format?.roundBestOf ?? {},
    maxRoundByStage,
    teamMmrByName,
  };

  let created = 0;
  let skipped = 0;
  let firstError: string | undefined;
  for (const m of matches) {
    const h = teamNameById[m.home_team_id!];
    const a = teamNameById[m.away_team_id!];
    if (!h || !a) continue;
    const result = await createMatchChannel(h, a, roundOverride ?? m.round, ctx, { round: m.round, stage: m.stage });
    if (result.created) {
      created++;
    } else if (result.skipped) {
      skipped++;
    } else if (result.error && !firstError) {
      firstError = result.error;
    }
  }

  if (firstError && created === 0 && skipped === 0) return reply(`❌ ${firstError}`);
  const parts: string[] = [];
  if (created > 0) parts.push(`✅ Created **${created}** channel${created === 1 ? "" : "s"}`);
  if (skipped > 0) parts.push(`ℹ️ **${skipped}** already exist in <#${categoryId}>`);
  if (firstError) parts.push(`⚠️ ${firstError}`);
  return reply(parts.join(" · ") || "ℹ️ Nothing to do.");
}

// Creates all missing Discord roles and assigns them to every player based on current DB state.
export async function execSyncRoles(): Promise<{ assigned: number; roleNames: string[]; warnings: string[] }> {
  const warnings: string[] = [];

  const [{ data: teams }, { data: players }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name, discord_role_id"),
    supabaseAdmin.from("players")
      .select("discord_id, team_id, is_captain")
      .eq("status", "approved")
      .not("team_id", "is", null)
      .not("discord_id", "is", null),
  ]);

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

  const teamById: Record<string, { name: string; discord_role_id: string | null }> = {};
  (teams ?? []).forEach(t => { teamById[t.id] = { name: t.name, discord_role_id: t.discord_role_id }; });

  // Skip test users (fake IDs like "test_...") — they don't exist in Discord
  const realPlayers = (players ?? []).filter(p => {
    const id = p.discord_id as string;
    return id && !id.startsWith("test_");
  });

  // Assign all players' roles in parallel instead of sequentially
  await Promise.all(
    realPlayers.map(player => {
      const discordId = player.discord_id as string;
      const team = teamById[player.team_id as string];
      if (!team) return Promise.resolve();
      const teamRoleId = team.discord_role_id ?? fallbackMap[team.name];
      const promises: Promise<void>[] = [];
      if (roleMap["Drafted"]) promises.push(addRoleById(discordId, roleMap["Drafted"]));
      if (teamRoleId)         promises.push(addRoleById(discordId, teamRoleId));
      if (player.is_captain && roleMap["Captain"])
        promises.push(addRoleById(discordId, roleMap["Captain"]));
      return Promise.all(promises);
    })
  );
  const assigned = realPlayers.length;

  const roleNames = ["Drafted", "Captain", ...(teams ?? []).map(t => t.name)];
  return { assigned, roleNames, warnings };
}

async function syncRoles(userId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;

  const { data: teams } = await supabaseAdmin.from("teams").select("id").limit(1);
  if (!teams?.length) return reply("❌ No teams found in the database.");

  const { assigned, roleNames, warnings } = await execSyncRoles();
  const lines = [
    `• Roles ensured: ${roleNames.join(", ")}`,
    `• Players updated: **${assigned}**`,
    ...warnings.map(w => `⚠️ ${w}`),
  ];
  return reply((warnings.length ? "⚠️ Partial sync" : "✅ Roles synced") + "\n" + lines.join("\n"));
}

async function diagRoles(userId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;

  // Look up the player record for the calling admin
  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, username, discord_id, team_id, is_captain, status")
    .eq("discord_id", userId)
    .maybeSingle();

  if (!player) {
    return reply(
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

  return reply(lines.join("\n"));
}

async function assignRole(userId: string, targetUserId: string, roleId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  await addRoleById(targetUserId, roleId);
  return reply(`✅ Role assigned to <@${targetUserId}>.`);
}

async function removeRoleCmd(userId: string, targetUserId: string, roleId: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;
  await removeRoleById(targetUserId, roleId);
  return reply(`✅ Role removed from <@${targetUserId}>.`);
}

async function assignTeam(userId: string, playerUsername: string, teamName: string) {
  const denied = adminGuard(userId);
  if (denied) return denied;

  const { data: player } = await supabaseAdmin
    .from("players").select("id, username").ilike("username", playerUsername)
    .eq("status", "approved").single();
  if (!player) return reply(`❌ No approved player found: "${playerUsername}"`);

  let { data: team } = await supabaseAdmin
    .from("teams").select("id, name").ilike("name", teamName).single();
  if (!team) {
    const { data: newTeam } = await supabaseAdmin
      .from("teams").insert({ name: teamName }).select().single();
    team = newTeam;
  }
  if (!team) return reply("❌ Failed to find or create team.");

  await supabaseAdmin.from("players")
    .update({ team_id: team.id, updated_at: new Date().toISOString() }).eq("id", player.id);
  return reply(`✅ **${player.username}** → **${team.name}**`);
}

// Parses "team-1-vs-team-2" → ["Team 1", "Team 2"]. Returns null if "-vs-" not found.
function parseChannelTeams(channelName: string): [string, string] | null {
  const idx = channelName.indexOf("-vs-");
  if (idx === -1) return null;
  const toTitle = (s: string) => s.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return [toTitle(channelName.slice(0, idx)), toTitle(channelName.slice(idx + 4))];
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
      const nr   = round + 1;
      const nm   = Math.ceil(match_number / 2);
      const slot = match_number % 2 === 1 ? "home_team_id" : "away_team_id";
      await setMatchSlot(DE_WINNERS, nr, nm, slot, winnerId);
    } else {
      await setMatchSlot(DE_GF, 1, 1, "home_team_id", winnerId);
    }

    if (loserId) {
      const { lbRound, lbMatchNum, slot } = wbLoserTarget(round, match_number);
      await setMatchSlot(DE_LOSERS, lbRound, lbMatchNum, slot, loserId);
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
    } else {
      await setMatchSlot(DE_LOSERS, target.round, target.matchNum, target.slot, winnerId);
    }
    return;
  }

  // ── Double Elimination — Grand Final ──────────────────────────────────────
  if (stage === DE_GF && match_number === 1) {
    // If the LB team (away slot) wins GF M1, trigger bracket reset
    const { data: gf } = await supabaseAdmin
      .from("matches").select("home_team_id, away_team_id")
      .eq("stage", DE_GF).eq("match_number", 1).maybeSingle();
    if (gf && winnerId === gf.away_team_id) {
      await supabaseAdmin.from("matches")
        .update({ home_team_id: gf.home_team_id, away_team_id: gf.away_team_id, status: "scheduled" })
        .eq("stage", DE_GF).eq("match_number", 2);
    }
    return;
  }

  // ── DE Qualifier — Winners Bracket ───────────────────────────────────────
  if (stage === DE_QUALIFIER_WINNERS) {
    const sizes = await getDEQBracketSizes();
    if (!sizes) return;

    if (round < sizes.numWBQ) {
      const nr   = round + 1;
      const nm   = Math.ceil(match_number / 2);
      const slot = match_number % 2 === 1 ? "home_team_id" : "away_team_id";
      await setMatchSlot(DE_QUALIFIER_WINNERS, nr, nm, slot, winnerId);
    }
    // Last WB round: winner is a qualifier survivor, no further WB routing

    if (loserId) {
      const { lbRound, lbMatchNum, slot } = wbLoserTarget(round, match_number);
      await setMatchSlot(DE_QUALIFIER_LOSERS, lbRound, lbMatchNum, slot, loserId);
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
      }
    }
    // Last LB round: winner is a qualifier survivor, no further routing
    return;
  }

  // ── SE / Swiss / Group — simple advancement in same stage ─────────────────
  const nr   = round + 1;
  const nm   = nextMatchNumber(match_number);
  const slot = nextSlot(match_number);
  const { data: nextMatch } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id")
    .eq("stage", stage).eq("round", nr).eq("match_number", nm)
    .maybeSingle();
  if (!nextMatch) return;
  await supabaseAdmin.from("matches")
    .update({ [slot === "home" ? "home_team_id" : "away_team_id"]: winnerId, status: "scheduled" })
    .eq("id", nextMatch.id);

  const otherId = slot === "home" ? nextMatch.away_team_id : nextMatch.home_team_id;
  if (otherId) {
    const [homeId, awayId] = slot === "home" ? [winnerId, otherId] : [otherId, winnerId];
    const [{ data: hTeam }, { data: aTeam }] = await Promise.all([
      supabaseAdmin.from("teams").select("name").eq("id", homeId).single(),
      supabaseAdmin.from("teams").select("name").eq("id", awayId).single(),
    ]);
    if (hTeam && aTeam) {
      const r = await createMatchChannel(hTeam.name, aTeam.name, nr, undefined, { round: nr, stage });
      if (!r.created && r.error) console.error("[createMatchChannel]", r.error);
    }
  }
}

export async function execReportMatchResult(
  matchId: string,
  homeScore: number,
  awayScore: number,
): Promise<{ ok: boolean; message: string }> {
  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, stage, round, match_number, status")
    .eq("id", matchId).single();
  if (!match) return { ok: false, message: "Match not found." };
  if (match.status === "completed") return { ok: false, message: "Match already reported." };

  const [{ data: homeTeam }, { data: awayTeam }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name, wins, losses").eq("id", match.home_team_id).single(),
    supabaseAdmin.from("teams").select("id, name, wins, losses").eq("id", match.away_team_id).single(),
  ]);
  if (!homeTeam || !awayTeam) return { ok: false, message: "Team not found." };

  await supabaseAdmin.from("matches")
    .update({ home_score: homeScore, away_score: awayScore, status: "completed" })
    .eq("id", matchId);

  const winnerId = homeScore > awayScore ? homeTeam.id : awayScore > homeScore ? awayTeam.id : null;
  const loserId  = homeScore > awayScore ? awayTeam.id : awayScore > homeScore ? homeTeam.id : null;

  if (homeScore !== awayScore) {
    const [winner, loser] = homeScore > awayScore ? [homeTeam, awayTeam] : [awayTeam, homeTeam];
    await Promise.all([
      supabaseAdmin.from("teams").update({ wins: (winner.wins ?? 0) + 1 }).eq("id", winner.id),
      supabaseAdmin.from("teams").update({ losses: (loser.losses ?? 0) + 1 }).eq("id", loser.id),
    ]);
    if (match.stage) {
      await advanceBracketWinner(
        { round: match.round, match_number: match.match_number, stage: match.stage },
        winnerId!,
        loserId ?? undefined,
      );
    }
  }

  const winnerName = homeScore > awayScore ? homeTeam.name : awayScore > homeScore ? awayTeam.name : null;
  return {
    ok: true,
    message: `${homeTeam.name} ${homeScore} — ${awayScore} ${awayTeam.name}${winnerName ? ` · ${winnerName} wins` : " · Draw"}`,
  };
}

async function reportResult(userId: string, team1Name: string, score1: number, team2Name: string, score2: number) {
  const denied = adminGuard(userId);
  if (denied) return denied;

  const [{ data: team1 }, { data: team2 }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name, wins, losses").ilike("name", team1Name).single(),
    supabaseAdmin.from("teams").select("id, name, wins, losses").ilike("name", team2Name).single(),
  ]);

  if (!team1) return reply(`❌ Team not found: "${team1Name}"`);
  if (!team2) return reply(`❌ Team not found: "${team2Name}"`);

  // Find if this is a bracket match (has round/match_number/stage)
  const { data: bracketMatch } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, stage")
    .eq("home_team_id", team1.id)
    .eq("away_team_id", team2.id)
    .eq("status", "scheduled")
    .not("stage", "is", null)
    .maybeSingle();

  if (bracketMatch) {
    // Update existing bracket match
    await supabaseAdmin.from("matches")
      .update({ home_score: score1, away_score: score2, status: "completed" })
      .eq("id", bracketMatch.id);
  } else {
    await supabaseAdmin.from("matches").insert({
      home_team_id: team1.id, away_team_id: team2.id,
      home_score: score1, away_score: score2,
      status: "completed",
    });
  }

  const winnerId = score1 > score2 ? team1.id : score2 > score1 ? team2.id : null;
  const loserId  = score1 > score2 ? team2.id : score2 > score1 ? team1.id : null;

  if (score1 !== score2) {
    const [winner, loser] = score1 > score2 ? [team1, team2] : [team2, team1];
    await Promise.all([
      supabaseAdmin.from("teams").update({ wins: (winner.wins ?? 0) + 1 }).eq("id", winner.id),
      supabaseAdmin.from("teams").update({ losses: (loser.losses ?? 0) + 1 }).eq("id", loser.id),
    ]);

    if (bracketMatch && winnerId) await advanceBracketWinner(bracketMatch, winnerId, loserId ?? undefined);
  }

  const winnerName = score1 > score2 ? team1.name : score2 > score1 ? team2.name : null;
  const result = winnerName ? `🏆 **${winnerName} wins!**` : "🤝 **Draw!**";
  return reply(`📊 **Match Recorded**\n**${team1.name}** ${score1} — ${score2} **${team2.name}**\n${result}`);
}

async function submitScore(userId: string, channelId: string, channelName: string, homeScore: number, awayScore: number) {
  if (!isAdmin(userId)) return reply("❌ Only admins can submit scores.");

  const teams = parseChannelTeams(channelName);
  if (!teams) return reply("❌ Run this command inside a match channel (name must contain \"-vs-\").");
  const [homeName, awayName] = teams;

  const [{ data: homeTeam }, { data: awayTeam }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name, wins, losses").ilike("name", homeName).single(),
    supabaseAdmin.from("teams").select("id, name, wins, losses").ilike("name", awayName).single(),
  ]);
  if (!homeTeam) return reply(`❌ Team not found: "${homeName}"`);
  if (!awayTeam) return reply(`❌ Team not found: "${awayName}"`);

  const { data: bracketMatch } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, stage")
    .eq("home_team_id", homeTeam.id)
    .eq("away_team_id", awayTeam.id)
    .eq("status", "scheduled")
    .not("stage", "is", null)
    .maybeSingle();

  if (bracketMatch) {
    await supabaseAdmin.from("matches")
      .update({ home_score: homeScore, away_score: awayScore, status: "completed" })
      .eq("id", bracketMatch.id);
  } else {
    await supabaseAdmin.from("matches").insert({
      home_team_id: homeTeam.id, away_team_id: awayTeam.id,
      home_score: homeScore, away_score: awayScore, status: "completed",
    });
  }

  const winnerId = homeScore > awayScore ? homeTeam.id : awayScore > homeScore ? awayTeam.id : null;
  const loserId  = homeScore > awayScore ? awayTeam.id : awayScore > homeScore ? homeTeam.id : null;
  if (homeScore !== awayScore) {
    const [winner, loser] = homeScore > awayScore ? [homeTeam, awayTeam] : [awayTeam, homeTeam];
    await Promise.all([
      supabaseAdmin.from("teams").update({ wins: (winner.wins ?? 0) + 1 }).eq("id", winner.id),
      supabaseAdmin.from("teams").update({ losses: (loser.losses ?? 0) + 1 }).eq("id", loser.id),
    ]);
    if (bracketMatch && winnerId) await advanceBracketWinner(bracketMatch, winnerId, loserId ?? undefined);
  }

  const winnerName = homeScore > awayScore ? homeTeam.name : awayScore > homeScore ? awayTeam.name : null;
  const resultLine = winnerName ? `🏆 **${winnerName} wins!**` : "🤝 **Draw**";

  // Announce result in draft channel, then delete match channel
  const { data: cfg } = await supabaseAdmin.from("league_settings").select("draft_channel_id").single();
  if (cfg?.draft_channel_id) {
    await sendChannelMessage(
      cfg.draft_channel_id,
      `📊 **Match Result** | **${homeTeam.name}** ${homeScore} — ${awayScore} **${awayTeam.name}** · ${resultLine}`
    );
  }
  await deleteChannel(channelId);

  // Ephemeral reply (flag 64) — visible only to the admin who ran the command
  return { type: 4, data: { content: `✅ Score submitted. Channel deleted.`, flags: 64 } };
}

async function myTeam(userId: string) {
  const { data: player } = await supabaseAdmin
    .from("players")
    .select("team_id")
    .eq("discord_id", userId)
    .single();

  if (!player?.team_id) return reply("❌ You are not on a team.");

  const teamId = player.team_id as string;

  const [{ data: team }, { data: roster }, { data: nextMatch }] = await Promise.all([
    supabaseAdmin.from("teams").select("name, wins, losses").eq("id", teamId).single(),
    supabaseAdmin.from("players")
      .select("username, peak_2v2, peak_3v3, is_captain")
      .eq("team_id", teamId)
      .eq("status", "approved"),
    supabaseAdmin.from("matches")
      .select("home_team_id, away_team_id, week, scheduled_at")
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!team) return reply("❌ Team not found.");

  const wins = team.wins ?? 0;
  const losses = team.losses ?? 0;
  const winRate = wins + losses > 0
    ? ` (${Math.round((wins / (wins + losses)) * 100)}% WR)` : "";

  const sorted = [...(roster ?? [])].sort((a, b) => {
    if (a.is_captain !== b.is_captain) return a.is_captain ? -1 : 1;
    const peakA = Math.max(Number(a.peak_2v2) || 0, Number(a.peak_3v3) || 0);
    const peakB = Math.max(Number(b.peak_2v2) || 0, Number(b.peak_3v3) || 0);
    return peakB - peakA;
  });

  const rosterLines = sorted.map((p) => {
    const peak = Math.max(Number(p.peak_2v2) || 0, Number(p.peak_3v3) || 0);
    return `${p.is_captain ? "👑" : "•"} **${p.username}** · ${peak.toLocaleString()} MMR`;
  }).join("\n");

  let matchLine = "";
  if (nextMatch) {
    const opponentId = nextMatch.home_team_id === teamId
      ? nextMatch.away_team_id : nextMatch.home_team_id;
    const { data: opp } = await supabaseAdmin
      .from("teams").select("name").eq("id", opponentId).single();
    const weekStr = nextMatch.week ? `Round ${nextMatch.week}` : "";
    const dateStr = nextMatch.scheduled_at
      ? new Date(nextMatch.scheduled_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      : "";
    const timeInfo = [weekStr, dateStr].filter(Boolean).join(" · ");
    matchLine = `\n\n📅 **Next:** vs **${opp?.name ?? "TBD"}**${timeInfo ? ` — ${timeInfo}` : ""}`;
  }

  return reply(
    `🛡️ **${team.name}** — ${wins}W ${losses}L${winRate}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    rosterLines +
    matchLine
  );
}

async function standings() {
  const { data: teams } = await supabaseAdmin.from("teams").select("id, name");
  const { data: matches } = await supabaseAdmin.from("matches").select("*");

  if (!teams?.length) return reply("No teams found.");
  if (!matches?.length) return reply("No matches played yet.");

  const stats: Record<string, { name: string; wins: number; losses: number }> = {};
  teams.forEach((t) => { stats[t.id] = { name: t.name, wins: 0, losses: 0 }; });

  matches.forEach((m) => {
    if (m.home_score > m.away_score) { stats[m.home_team_id].wins++; stats[m.away_team_id].losses++; }
    else if (m.away_score > m.home_score) { stats[m.away_team_id].wins++; stats[m.home_team_id].losses++; }
  });

  const sorted = Object.values(stats).sort((a, b) => b.wins - a.wins || a.losses - b.losses);
  const list = sorted.map((t, i) => `${i + 1}. **${t.name}** — ${t.wins}W ${t.losses}L`).join("\n");
  return reply(`🏆 **Standings**\n${list}`);
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────

export async function handleAutocomplete(interaction: Interaction) {
  const focused = interaction.data.options?.find((o) => o.focused);
  if (!focused) return { type: 8, data: { choices: [] } };

  const value = String(focused.value ?? "");
  const pattern = value ? `%${value}%` : "%";
  const commandName = interaction.data.name;

  if (commandName === "reportresult") {
    const { data: teams } = await supabaseAdmin
      .from("teams").select("name").ilike("name", pattern).limit(25);
    return { type: 8, data: { choices: (teams ?? []).map((t) => ({ name: t.name, value: t.name })) } };
  }

  const base = supabaseAdmin.from("players").select("username").ilike("username", pattern);
  let queryResult;

  if (commandName === "approve" || commandName === "reject") {
    queryResult = await base.eq("status", "pending").limit(25);
  } else if (commandName === "assignteam") {
    queryResult = await base.eq("status", "approved").limit(25);
  } else if (commandName === "nominate") {
    queryResult = await base
      .eq("status", "approved").eq("draft_entered", true).is("team_id", null).limit(25);
  } else {
    queryResult = await base.limit(25);
  }

  return { type: 8, data: { choices: (queryResult.data ?? []).map((p) => ({ name: p.username, value: p.username })) } };
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
  if (!isAdmin(userId)) return reply("❌ You don't have permission.");
  if (value !== modal.code) return reply(`❌ Incorrect code. Type exactly: "${modal.code}"`);

  const result = await modal.fn();
  return result.ok ? reply(result.message) : reply(`❌ ${result.message}`);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handleCommand(interaction: Interaction) {
  const userId = getUserId(interaction);
  const name = interaction.data.name;

  switch (name) {
    case "totalplayers":  return totalPlayers();
    case "totalusers":    return totalUsers();
    case "pending":       return pending(userId);
    case "approve":       return approve(userId, String(opt(interaction, "username")));
    case "reject":        return reject(userId, String(opt(interaction, "username")));
    case "playerinfo":    return playerInfo(String(opt(interaction, "username")));
    case "setnumteams":   return setNumTeams(userId, String(opt(interaction, "count")));
    case "setdraftchannel": return setDraftChannel(userId, String(opt(interaction, "channel")));
    case "startdraft":    return startDraft(userId);
    case "enddraft":      return endDraft(userId);
    case "draftpool":     return draftPool(userId);
    case "draftcount":    return draftCount();
    case "enterdraft":    return enterDraft(userId);
    case "leavedraft":    return leaveDraft(userId);
    case "nominate":      return nominatePlayer(userId, String(opt(interaction, "player")), Number(opt(interaction, "bid")));
    case "bid":           return placeBid(userId, Number(opt(interaction, "amount")));
    case "endround":      return endRound(userId);
    case "budget":        return checkBudget(userId);
    case "assignteam":    return assignTeam(userId, String(opt(interaction, "player")), String(opt(interaction, "team")));
    case "syncroles":         return syncRoles(userId);
    case "diagroles":         return diagRoles(userId);
    case "assignrole":        return assignRole(userId, String(opt(interaction, "user")), String(opt(interaction, "role")));
    case "removerole":        return removeRoleCmd(userId, String(opt(interaction, "user")), String(opt(interaction, "role")));
    case "setmatchcategory":  return setMatchCategory(userId, String(opt(interaction, "category")));
    case "setdeadlineday":    return setDeadlineDay(userId, Number(opt(interaction, "day")));
    case "setplaytime":       return setPlayTime(userId, Number(opt(interaction, "day")), Number(opt(interaction, "hour")));
    case "setruleschannel":   return setRulesChannel(userId, String(opt(interaction, "channel")));
    case "openround": {
      const w = opt(interaction, "round");
      return openRound(userId, w ? Number(w) : undefined);
    }
    case "startseason":   return startSeason(userId);
    case "reportresult":  return reportResult(userId, String(opt(interaction, "team1")), Number(opt(interaction, "score1")), String(opt(interaction, "team2")), Number(opt(interaction, "score2")));
    case "score":         return submitScore(userId, interaction.channel_id ?? "", interaction.channel?.name ?? "", Number(opt(interaction, "home")), Number(opt(interaction, "away")));
    case "standings":     return standings();
    case "myteam":        return myTeam(userId);
    default:              return reply("Unknown command.");
  }
}
