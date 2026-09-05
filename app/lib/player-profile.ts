import "server-only";

import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./paginate";
import { careerPoints } from "./career-points";
import { fetchEventHistory, type EventHistoryEntry } from "./event-results";

/**
 * Everything one player's profile shows, loaded on demand.
 *
 * Nothing here is pre-fetched: a profile costs a handful of indexed lookups for
 * the single player being viewed, which is why event results are indexed by
 * discord_id (app/lib/event-results.ts) rather than scanned out of archives.
 *
 * Every column read is named explicitly. `accounts` also carries ban_reason,
 * kick_reason, mfa_enabled and Patreon tokens, and `pending_players` carries
 * college_image_url — a student's enrolment proof. A `select *` here would put
 * all of that one JSON response away from being public, so the allowlist is the
 * privacy boundary, not a style preference.
 */

export type ProfileIdentity = {
  discordId: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  joinedAt: string | null;
};

/**
 * Queue-bot stats. Every field is null for a player with no queue-bot row —
 * only 14 of 63 queue-bot players have an account here, so "never queued" is the
 * common case and must not render as a measured zero.
 */
export type SixMansStats = {
  currentMmr: number | null;
  peakMmr: number | null;
  wins: number | null;
  losses: number | null;
  band: string | null;
  /** Sum of season_score across closed seasons; the 6mans half of career points. */
  points: number | null;
};

/** The four MMR figures a profile shows, as registered. */
export type RankStats = {
  seasonPeak2v2: number | null;
  allTimePeak2v2: number | null;
  seasonPeak3v3: number | null;
  allTimePeak3v3: number | null;
};

export type PlayerProfile = {
  identity: ProfileIdentity;
  teamName: string | null;
  isCaptain: boolean;
  sixMans: SixMansStats;
  ranks: RankStats;
  events: EventHistoryEntry[];
  /** 6mans points + the points from every event in `events`. */
  careerPoints: number;
};

const EMPTY_SIX_MANS: SixMansStats = {
  currentMmr: null,
  peakMmr: null,
  wins: null,
  losses: null,
  band: null,
  points: null,
};

/**
 * Look a profile up by either key. Live UI has a username to hand (that is what
 * PlayerName renders), while an archived roster entry has a discord_id — and a
 * player who has since renamed only resolves by the latter. Both funnel into the
 * same account row, and discord_id remains the identity everything else joins on.
 */
export async function loadPlayerProfile(
  key: { discordId: string } | { username: string },
): Promise<PlayerProfile | null> {
  const account = await resolveAccount(key);
  if (!account) return null;

  const [tierThree, registration, queueBot] = await Promise.all([
    fetchTierThree(account.id),
    fetchRegistration(account.id),
    fetchQueueBotPlayer(account.discord_id),
  ]);

  const [teamName, sixMans, events] = await Promise.all([
    fetchTeamName(tierThree?.team_id ?? null),
    queueBot ? fetchSixMansStats(queueBot) : Promise.resolve(EMPTY_SIX_MANS),
    fetchEventHistory(account.discord_id),
  ]);

  return {
    identity: {
      discordId: account.discord_id,
      username: account.username,
      displayName: account.display_name,
      avatar: account.avatar,
      joinedAt: account.created_at,
    },
    teamName,
    isCaptain: tierThree?.is_captain ?? false,
    sixMans,
    ranks: {
      seasonPeak2v2: toMmr(registration?.current_2v2),
      allTimePeak2v2: toMmr(registration?.peak_2v2),
      seasonPeak3v3: toMmr(registration?.current_3v3),
      allTimePeak3v3: toMmr(registration?.peak_3v3),
    },
    events,
    careerPoints: careerPoints(
      sixMans.points,
      events.map((e) => ({
        placement: e.placement,
        teamCount: e.team_count,
        prizePool: e.prize_pool,
        kind: e.event_kind,
      })),
    ),
  };
}

type AccountRow = {
  id: string;
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  created_at: string | null;
};

const ACCOUNT_FIELDS = "id, discord_id, username, display_name, avatar, created_at";

async function resolveAccount(
  key: { discordId: string } | { username: string },
): Promise<AccountRow | null> {
  const query = supabaseAdmin.from("accounts").select(ACCOUNT_FIELDS);
  const { data, error } =
    "discordId" in key
      ? await query.eq("discord_id", key.discordId).maybeSingle()
      : await query.ilike("username", key.username).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AccountRow | null) ?? null;
}

async function fetchTierThree(accountId: string) {
  const { data, error } = await supabaseAdmin
    .from("players")
    .select("team_id, is_captain")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { team_id: string | null; is_captain: boolean } | null;
}

async function fetchRegistration(accountId: string) {
  const { data, error } = await supabaseAdmin
    .from("pending_players")
    .select("peak_2v2, current_2v2, peak_3v3, current_3v3")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as {
    peak_2v2: string | null;
    current_2v2: string | null;
    peak_3v3: string | null;
    current_3v3: string | null;
  } | null;
}

async function fetchTeamName(teamId: string | null): Promise<string | null> {
  if (!teamId) return null;
  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("name")
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { name: string } | null)?.name ?? null;
}

type QueueBotPlayer = {
  id: string;
  mmr: number | null;
  peak_mmr: number | null;
  band: string | null;
};

async function fetchQueueBotPlayer(discordId: string): Promise<QueueBotPlayer | null> {
  const { data, error } = await supabaseAdmin
    .from("crl6mansqueuebot_players")
    .select("id, mmr, peak_mmr, band")
    .eq("discord_id", discordId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as QueueBotPlayer | null) ?? null;
}

async function fetchSixMansStats(player: QueueBotPlayer): Promise<SixMansStats> {
  const [record, points] = await Promise.all([
    fetchSixMansRecord(player.id),
    fetchSixMansPoints(player.id),
  ]);

  // peak_mmr was added to the queue bot after the fact and is 0 for players who
  // have not peaked since, so a live rating above it is the real peak.
  const current = player.mmr;
  const peak =
    player.peak_mmr === null
      ? current
      : current === null
        ? player.peak_mmr
        : Math.max(current, player.peak_mmr);

  return {
    currentMmr: current,
    peakMmr: peak,
    wins: record.wins,
    losses: record.losses,
    band: player.band,
    points,
  };
}

/**
 * There is no win/loss column anywhere in the queue bot, so the record is the
 * player's series joined to their outcome. Void series carry no winner, so only
 * reported ones count.
 */
async function fetchSixMansRecord(queueBotPlayerId: string) {
  // Without generated database types the client widens a to-one embed to an
  // array, so accept either shape rather than lying to the compiler with a cast.
  type SeriesRef = { winner_team: string | null };
  type Row = { team: string | null; series: SeriesRef | SeriesRef[] | null };
  const rows = await fetchAllRows<Row>((from, to) =>
    supabaseAdmin
      .from("crl6mansqueuebot_series_players")
      .select("team, series:crl6mansqueuebot_series!inner(winner_team, status)")
      .eq("player_id", queueBotPlayerId)
      .eq("series.status", "reported")
      .range(from, to),
  );

  let wins = 0;
  let losses = 0;
  for (const row of rows) {
    const series = Array.isArray(row.series) ? row.series[0] : row.series;
    const winner = series?.winner_team;
    if (!winner || !row.team) continue;
    if (row.team === winner) wins++;
    else losses++;
  }
  return { wins, losses };
}

/**
 * season_score only accrues when a season closes, so a player partway through
 * their first season has no row — null, not zero.
 */
async function fetchSixMansPoints(queueBotPlayerId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("crl6mansqueuebot_season_history")
    .select("season_score")
    .eq("player_id", queueBotPlayerId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { season_score: number | null }[];
  if (rows.length === 0) return null;
  return rows.reduce((sum, r) => sum + (r.season_score ?? 0), 0);
}

/** Registered MMR is stored as text and defaults to "0" — an unset value, not a rating. */
function toMmr(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
