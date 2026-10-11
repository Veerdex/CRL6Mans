// Every embed a slash command replies with. Pure formatting with no Supabase
// import, so it can be read and tested on its own — same convention as
// draft-embeds.ts, clip-embeds.ts and match-embeds.ts.
//
// These are command *replies*, not match-channel posts, so there is no ping to
// resolve and no ChannelPost to assemble: each builder returns a bare embed and
// the caller decides whether it is ephemeral. Everything player-supplied (a
// username, a team name) is inert here — an embed never notifies anyone — which
// is exactly why these replies carry it and match-embeds.ts does not.

import type { DiscordEmbed } from "./discord-api";

// Mirrors the palette in match-embeds.ts. Kept local so this leaf stays
// standalone; they are brand constants, not behaviour.
const BRAND_ORANGE = 0xe88a24;
const BRAND_BLUE = 0x3736ac;
const OK_GREEN = 0x22c55e;
const WARN_AMBER = 0xd97706;
const BAD_RED = 0xdc2626;

const TITLE_LIMIT = 256;
const FIELD_LIMIT = 1024;

const clamp = (s: string, limit: number): string =>
  s.length <= limit ? s : `${s.slice(0, limit - 1)}…`;

/**
 * An unset figure reads as an em dash, never 0. Registered MMR is stored as text
 * defaulting to "0", and a player who never registered a rank would otherwise be
 * shown a confident zero instead of nothing.
 */
const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : Math.round(v).toLocaleString();

const dec = (v: number, places: number): string =>
  v.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places });

/** Discord renders an avatar hash through this path; null falls back to no thumbnail. */
export function avatarUrl(discordId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  const ext = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.${ext}?size=128`;
}

const nameHeading = (username: string, displayName: string | null): string =>
  clamp(displayName && displayName !== username ? `${displayName} (${username})` : username, TITLE_LIMIT);

export type ProfileEmbedArgs = {
  username: string;
  displayName: string | null;
  discordId: string;
  avatar: string | null;
  teamName: string | null;
  isCaptain: boolean;
  careerPoints: number;
  rankValue: number | null;
  seasonPeak2v2: number | null;
  allTimePeak2v2: number | null;
  seasonPeak3v3: number | null;
  allTimePeak3v3: number | null;
};

export function profileEmbed(a: ProfileEmbedArgs): DiscordEmbed {
  const thumb = avatarUrl(a.discordId, a.avatar);
  const embed: DiscordEmbed = {
    title: nameHeading(a.username, a.displayName),
    color: BRAND_ORANGE,
    description: a.teamName
      ? `${a.isCaptain ? "🧢 Captain of" : "Playing for"} **${clamp(a.teamName, 200)}**`
      : "_Not currently on a team_",
    fields: [
      { name: "Career Points", value: num(a.careerPoints), inline: true },
      { name: "Rank Value", value: num(a.rankValue), inline: true },
      {
        name: "2v2",
        value: `Season Peak: **${num(a.seasonPeak2v2)}**\nAll-Time Peak: **${num(a.allTimePeak2v2)}**`,
        inline: true,
      },
      {
        name: "3v3",
        value: `Season Peak: **${num(a.seasonPeak3v3)}**\nAll-Time Peak: **${num(a.allTimePeak3v3)}**`,
        inline: true,
      },
    ],
  };
  if (thumb) embed.thumbnail = { url: thumb };
  return embed;
}

export type StatsEmbedArgs = {
  username: string;
  displayName: string | null;
  discordId: string;
  avatar: string | null;
  teamName: string | null;
  games: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  score: number;
  demos: number;
  demoed: number;
  mvp: number;
  shootingPct: number;
};

export function statsEmbed(a: StatsEmbedArgs): DiscordEmbed {
  const thumb = avatarUrl(a.discordId, a.avatar);

  // A player with no recorded games gets a short embed rather than a table of
  // zeroes, which would read as a measured performance instead of no data.
  if (a.games === 0) {
    const empty: DiscordEmbed = {
      title: clamp(`${nameHeading(a.username, a.displayName)} — Career Stats`, TITLE_LIMIT),
      color: BRAND_BLUE,
      description: "No recorded games yet. Stats appear once a series with replays is finalised.",
    };
    if (thumb) empty.thumbnail = { url: thumb };
    return empty;
  }

  const per = (total: number) => dec(total / a.games, 2);
  const embed: DiscordEmbed = {
    title: clamp(`${nameHeading(a.username, a.displayName)} — Career Stats`, TITLE_LIMIT),
    color: BRAND_ORANGE,
    description:
      `**${a.games.toLocaleString()}** games played` +
      (a.teamName ? ` · **${clamp(a.teamName, 200)}**` : ""),
    fields: [
      { name: "MVP Score", value: dec(a.mvp, 3), inline: true },
      { name: "Shooting %", value: `${dec(a.shootingPct, 1)}%`, inline: true },
      {
        name: "Per Game",
        value: clamp(
          `Goals: **${per(a.goals)}**\nAssists: **${per(a.assists)}**\n` +
            `Saves: **${per(a.saves)}**\nShots: **${per(a.shots)}**\nScore: **${per(a.score)}**`,
          FIELD_LIMIT,
        ),
        inline: true,
      },
      {
        name: "Totals",
        value: clamp(
          `Goals: **${a.goals.toLocaleString()}**\nAssists: **${a.assists.toLocaleString()}**\n` +
            `Saves: **${a.saves.toLocaleString()}**\nShots: **${a.shots.toLocaleString()}**\n` +
            `Score: **${a.score.toLocaleString()}**`,
          FIELD_LIMIT,
        ),
        inline: true,
      },
      {
        name: "Demos",
        value: `Dealt: **${a.demos.toLocaleString()}**\nTaken: **${a.demoed.toLocaleString()}**`,
        inline: true,
      },
    ],
  };
  if (thumb) embed.thumbnail = { url: thumb };
  return embed;
}

export type CoinsEmbedArgs = {
  username: string;
  displayName: string | null;
  discordId: string;
  avatar: string | null;
  coins: number;
  /** Null for an account the standings exclude — a rejected or seeded test one. */
  rank: number | null;
  totalRanked: number | null;
};

/**
 * The currency is "Westside Wages" everywhere on the site, so it is here too.
 * 🪙 is deliberate even though the website replaced it with an image: that swap
 * was for browsers whose font stack carries no emoji, and Discord's own emoji
 * font draws it the same way on every client.
 */
export function coinsEmbed(a: CoinsEmbedArgs): DiscordEmbed {
  const thumb = avatarUrl(a.discordId, a.avatar);
  const embed: DiscordEmbed = {
    title: clamp(`${nameHeading(a.username, a.displayName)} — Westside Wages`, TITLE_LIMIT),
    color: BRAND_ORANGE,
    description: `🪙 **${a.coins.toLocaleString()}**`,
  };
  if (a.rank !== null && a.totalRanked !== null) {
    embed.fields = [
      { name: "Leaderboard", value: `#**${a.rank.toLocaleString()}** of ${a.totalRanked.toLocaleString()}`, inline: true },
    ];
  }
  if (thumb) embed.thumbnail = { url: thumb };
  return embed;
}

export type SubAckEmbedArgs = {
  teamName: string;
  playerOut: string;
  subIn: string;
  oppName: string | null;
  reason: string | null;
};

export function subAckEmbed(a: SubAckEmbedArgs): DiscordEmbed {
  return {
    title: "Substitution requested",
    color: OK_GREEN,
    description:
      `**${clamp(a.playerOut, 200)}** out, **${clamp(a.subIn, 200)}** in for ` +
      `**${clamp(a.teamName, 200)}**.` +
      (a.oppName ? `\n\n${clamp(a.oppName, 200)} has been notified and must accept it.` : ""),
    fields: a.reason
      ? [{ name: "Reason given", value: clamp(a.reason, FIELD_LIMIT) }]
      : undefined,
    footer: { text: "Track it on the website under My Team." },
  };
}

/** What `/approve` and `/reject` acted on, for the private confirmation. */
export type DecisionTarget = "sub" | "series";

export function decisionAckEmbed(args: {
  target: DecisionTarget;
  approved: boolean;
  detail: string;
}): DiscordEmbed {
  const noun = args.target === "sub" ? "Substitution" : "Series result";
  return {
    title: `${noun} ${args.approved ? "approved" : "rejected"}`,
    color: args.approved ? OK_GREEN : BAD_RED,
    description: clamp(args.detail, 4096),
  };
}

/**
 * What `/dispute` escalated. Amber rather than red: nothing has gone wrong and
 * nobody has been refused — the same colour the draft's auto-pick uses for "a
 * clock ran out and the system stepped in".
 */
export function disputeAckEmbed(args: { target: DecisionTarget; detail: string }): DiscordEmbed {
  const noun = args.target === "sub" ? "Substitution" : "Series result";
  return {
    title: `${noun} sent to staff`,
    color: WARN_AMBER,
    description: clamp(args.detail, 4096),
    footer: { text: "Staff will settle it. Nothing more to do from here." },
  };
}
