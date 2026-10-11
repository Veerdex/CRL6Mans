// Every message the bot posts into a match channel. Pure formatting with no
// Supabase import, so it stays out of discord-bot.ts's orbit and can be read and
// tested on its own — same convention as draft-embeds.ts and clip-embeds.ts.
//
// A mention inside an embed notifies nobody. So every ping lives in the message
// `content` above the embed, and the embed itself only ever carries names already
// rendered as plain text. `channelPost` builds `content` and `allowed_mentions`
// from the same ping list, which is what keeps the two from drifting: a ping that
// isn't in the content can't notify, and one that isn't in allowed_mentions is
// stripped by Discord. Everything player-supplied (team names, sub reasons, an
// admin's rejection note) therefore lands in the embed, where a team called
// "@everyone" is inert text instead of a server-wide ping.

import type { AllowedMentions, DiscordEmbed } from "./discord-api";
import { playerRatingFromRow } from "./rating";

const BRAND_ORANGE = 0xe88a24;
const BRAND_BLUE = 0x3736ac;
const OK_GREEN = 0x22c55e;
const WARN_AMBER = 0xd97706;
const BAD_RED = 0xdc2626;

// Discord 400s the whole message on an over-long part rather than truncating it,
// and free text reaches these builders from players and admins.
const TITLE_LIMIT = 256;
const DESC_LIMIT = 4096;
const FIELD_LIMIT = 1024;

const clamp = (s: string, limit: number): string =>
  s.length <= limit ? s : `${s.slice(0, limit - 1)}…`;

/** A role ping: the text that goes in `content`, and the ID that whitelists it. */
export type Ping = { text: string; id: string };

/**
 * A ping for the guild role matching a team name, or null when no such role
 * exists. Null means no ping rather than a bolded fallback name — the name is
 * already in the embed, so a fallback would only duplicate it in the content.
 *
 * `GET /guilds/{id}/roles` includes the `@everyone` role by that literal name,
 * so a team called "@everyone" would otherwise match it by name and get the
 * whole server pinged through the bot. Team names are player-supplied, so that
 * role is excluded here, where every match-channel ping is resolved.
 */
export function teamPing(
  teamName: string,
  roles: Array<{ id: string; name: string }>,
): Ping | null {
  if (teamName === "@everyone" || teamName === "@here") return null;
  const role = roles.find((r) => r.name === teamName && r.name !== "@everyone");
  return role ? { text: `<@&${role.id}>`, id: role.id } : null;
}

/** A ping for a role already known by ID (the moderator role, for escalations). */
export function rolePing(roleId: string | null | undefined): Ping | null {
  return roleId ? { text: `<@&${roleId}>`, id: roleId } : null;
}

export type ChannelPost = {
  content: string;
  embeds: DiscordEmbed[];
  allowed_mentions: AllowedMentions;
};

function channelPost(pings: Array<Ping | null>, embed: DiscordEmbed): ChannelPost {
  const live = pings.filter((p): p is Ping => !!p);
  return {
    content: live.map((p) => p.text).join(" "),
    embeds: [embed],
    allowed_mentions: { parse: [], roles: [...new Set(live.map((p) => p.id))] },
  };
}

const vs = (homeName: string, awayName: string): string =>
  `**${homeName}** 🏠 Home  vs  **${awayName}** ✈️ Away`;

// ─── Channel intro ──────────────────────────────────────────────────────────────

export type IntroTeams = {
  homeName: string;
  awayName: string;
  homePing: Ping | null;
  awayPing: Ping | null;
  bestOf: number;
};

export function tournamentIntroPost(
  teams: IntroTeams,
  lobby: { name: string; password: string },
  needsCheckIn: boolean,
): ChannelPost {
  const fields: DiscordEmbed["fields"] = [
    { name: "Format", value: `Best of ${teams.bestOf}`, inline: true },
  ];
  // The channel opens with the check-in window rather than after it, so the first
  // thing in it has to be the thing that forfeits you if you skip it. A bracket
  // reset has no check-in at all and must not be told it does.
  if (needsCheckIn) {
    fields.push({
      name: "⚠️ Check in first",
      value:
        "Run `/checkin` right here, or use the button on the website under My Team.\n" +
        "Both teams have **10 minutes** from when check-in opens, or the match is forfeited.",
    });
  }
  fields.push({
    name: clamp(`Private Match Lobby — ${teams.awayName} (Away) creates it`, TITLE_LIMIT),
    value: `Room Name: \`${lobby.name}\`\nPassword: \`${lobby.password}\``,
  });
  return channelPost([teams.homePing, teams.awayPing], {
    title: "Match Ready",
    color: BRAND_BLUE,
    description: vs(teams.homeName, teams.awayName),
    fields,
    footer: { text: "Report your result on the website under My Team." },
  });
}

/**
 * The standalone-season intro. `scheduleLines` and `coordinateLine` are resolved
 * from the round's schedule by the caller, which is where the DB lives.
 */
export function seasonIntroPost(
  teams: IntroTeams,
  roundNum: number,
  schedule: { lines: string; coordinate: string },
  rulesRef: string,
): ChannelPost {
  return channelPost([teams.homePing, teams.awayPing], {
    title: clamp(`Welcome to Round ${roundNum}!`, TITLE_LIMIT),
    color: BRAND_BLUE,
    description: vs(teams.homeName, teams.awayName),
    fields: [
      { name: "Format", value: `Best of ${teams.bestOf}`, inline: true },
      { name: "When", value: clamp(schedule.lines, FIELD_LIMIT) },
      {
        name: "Before you play",
        value: clamp(
          `${schedule.coordinate}\n` +
            `• Need a sub? Follow the procedure in the rulebook (${rulesRef}). ` +
            `A match played with an illegal sub is forfeited.\n` +
            `• Report your result on the website under My Team.`,
          FIELD_LIMIT,
        ),
      },
    ],
  });
}

// ─── Check-in ───────────────────────────────────────────────────────────────────

export function checkInPost(args: {
  teamName: string;
  oppName: string;
  teamPing: Ping | null;
  oppPing: Ping | null;
  bothIn: boolean;
  deadlineTs: number;
}): ChannelPost {
  return args.bothIn
    ? channelPost([args.teamPing, args.oppPing], {
        title: "Both teams checked in",
        color: OK_GREEN,
        description:
          `**${args.teamName}** checked in — both teams are in.\n` +
          `You're clear to play. Good luck!`,
      })
    : channelPost([args.oppPing], {
        title: "Checked in",
        color: OK_GREEN,
        description:
          `**${args.teamName}** checked in.\n` +
          `**${args.oppName}** — you have until <t:${args.deadlineTs}:R> to check in ` +
          `(\`/checkin\` here, or on the website) or the match is forfeited.`,
      });
}

// ─── Match result ───────────────────────────────────────────────────────────────

export function matchResultPost(args: {
  homeName: string;
  awayName: string;
  homePing: Ping | null;
  awayPing: Ping | null;
  homeScore: number;
  awayScore: number;
  winnerName: string | null;
}): ChannelPost {
  return channelPost([args.homePing, args.awayPing], {
    title: "Match result",
    color: args.winnerName ? OK_GREEN : BRAND_BLUE,
    description:
      `**${args.homeName}** ${args.homeScore}–${args.awayScore} **${args.awayName}**\n` +
      (args.winnerName ? `🏆 **${args.winnerName}** wins!` : "🤝 **Draw**"),
  });
}

// ─── Score reporting ────────────────────────────────────────────────────────────

export function seriesSubmittedPost(args: {
  teamName: string;
  oppPing: Ping | null;
  homeWins: number;
  awayWins: number;
}): ChannelPost {
  return channelPost([args.oppPing], {
    title: "Series result submitted",
    color: BRAND_ORANGE,
    description: `**${args.teamName}** submitted the series result: **${args.homeWins}–${args.awayWins}**.`,
    footer: { text: "Run /approve series or /reject series right here, or use the website under My Team." },
  });
}

export function seriesDisputedPost(args: { teamName: string; oppPing: Ping | null }): ChannelPost {
  return channelPost([args.oppPing], {
    title: "Result disputed",
    color: WARN_AMBER,
    description: `**${args.teamName}** disputed the submitted result. Please resubmit when ready.`,
  });
}

export function replayReviewPost(homeScore: number, awayScore: number): ChannelPost {
  return channelPost([], {
    title: "Replay review required",
    color: WARN_AMBER,
    description:
      `Both teams accepted the **${homeScore}–${awayScore}** result, but some players in the ` +
      `replays weren't recognised. An admin will review the replays and finalise the match.`,
  });
}

export function replayRejectedPost(reason: string): ChannelPost {
  return channelPost([], {
    title: "Replay submission rejected",
    color: BAD_RED,
    description: clamp(
      `An admin rejected this series' replay submission.\n\n` +
        `**Reason:** ${reason}\n\n` +
        `Please upload the correct replays and resubmit.`,
      DESC_LIMIT,
    ),
  });
}

// ─── Scheduling ─────────────────────────────────────────────────────────────────

export function timeProposedPost(args: {
  teamName: string;
  oppPing: Ping | null;
  ts: number;
  isNewTime: boolean;
  note: string;
}): ChannelPost {
  return channelPost([args.oppPing], {
    title: args.isNewTime ? "New match time proposed" : "Match time proposed",
    color: BRAND_ORANGE,
    description: clamp(
      `**${args.teamName}** proposed <t:${args.ts}:F> (<t:${args.ts}:R>).\n\n${args.note}`,
      DESC_LIMIT,
    ),
  });
}

export function timeAcceptedPost(args: {
  teamName: string;
  proposerPing: Ping | null;
  ts: number;
  needsAdmin: boolean;
}): ChannelPost {
  return channelPost([args.proposerPing], {
    title: args.needsAdmin ? "Time confirmed — awaiting admin" : "Match time locked in",
    color: args.needsAdmin ? WARN_AMBER : OK_GREEN,
    description: args.needsAdmin
      ? `**${args.teamName}** confirmed the out-of-window time <t:${args.ts}:F>. ` +
        `Awaiting admin approval before it's locked in.`
      : `**${args.teamName}** confirmed <t:${args.ts}:F>. See you then! 🎮`,
  });
}

export function timeWithdrawnPost(args: { teamName: string; oppPing: Ping | null }): ChannelPost {
  return channelPost([args.oppPing], {
    title: "Proposed time removed",
    color: BRAND_BLUE,
    description: `**${args.teamName}** removed the proposed match time.`,
  });
}

export function timeRejectedPost(args: {
  teamName: string;
  proposerPing: Ping | null;
  ts: number;
}): ChannelPost {
  return channelPost([args.proposerPing], {
    title: "Proposed time rejected",
    color: BAD_RED,
    description:
      `**${args.teamName}** rejected the proposed time (<t:${args.ts}:F>).\n` +
      `Please propose a new time.`,
  });
}

export function adminTimeApprovedPost(ts: number): ChannelPost {
  return channelPost([], {
    title: "Match time approved",
    color: OK_GREEN,
    description: `An admin approved <t:${ts}:F>. It's locked in — see you then! 🎮`,
  });
}

export function adminTimeDeclinedPost(): ChannelPost {
  return channelPost([], {
    title: "Match time declined",
    color: BAD_RED,
    description:
      "An admin declined the out-of-window time. " +
      "Please propose a new time within the scheduled window.",
  });
}

// ─── Substitutions ──────────────────────────────────────────────────────────────

export type SubPlayerRow = {
  username: string;
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string;
  peak_1v1: string | null;
  current_1v1: string | null;
};

function rankField(label: string, p: SubPlayerRow): { name: string; value: string; inline: true } {
  return {
    name: clamp(`${label}: ${p.username}`, TITLE_LIMIT),
    value:
      `• All Time Peak 2v2: ${Number(p.peak_2v2).toLocaleString()}\n` +
      `• Season Peak 2v2: ${Number(p.current_2v2).toLocaleString()}\n` +
      `• All Time Peak 3v3: ${Number(p.peak_3v3).toLocaleString()}\n` +
      `• Season Peak 3v3: ${Number(p.current_3v3).toLocaleString()}\n` +
      `• Rank Value: ${Math.round(playerRatingFromRow(p)).toLocaleString()}`,
    inline: true,
  };
}

export function subRequestedPost(args: {
  teamName: string;
  oppPing: Ping | null;
  playerOut: SubPlayerRow;
  sub: SubPlayerRow;
  reason?: string | null;
}): ChannelPost {
  return channelPost([args.oppPing], {
    title: "Substitution requested",
    color: BRAND_ORANGE,
    description: clamp(
      `**${args.teamName}** requested a substitution.` +
        (args.reason ? `\n\n**Reason:** ${args.reason}` : ""),
      DESC_LIMIT,
    ),
    fields: [rankField("Out", args.playerOut), rankField("Sub", args.sub)],
    footer: { text: "Run /approve sub or /reject sub right here, or use the website under My Team." },
  });
}

export function subAcceptedPost(args: { teamName: string; playerOut: string }): ChannelPost {
  return channelPost([], {
    title: "Substitution accepted",
    color: OK_GREEN,
    description:
      `The substitution for **${args.teamName}** (in place of **${args.playerOut}**) ` +
      `was accepted by the opposing team.`,
  });
}

export function subRejectedPost(teamName: string): ChannelPost {
  return channelPost([], {
    title: "Substitution rejected",
    color: BAD_RED,
    description: `The opposing team rejected the substitution requested by **${teamName}**.`,
  });
}

export function subEscalatedPost(args: { teamName: string; modPing: Ping | null }): ChannelPost {
  return channelPost([args.modPing], {
    title: "Substitution escalated to staff",
    color: WARN_AMBER,
    description: `**${args.teamName}** reported their rejected substitution for staff review.`,
  });
}

export function subAdminApprovedPost(args: { teamName: string; playerOut: string }): ChannelPost {
  return channelPost([], {
    title: "Substitution approved by staff",
    color: OK_GREEN,
    description: `Staff approved the substitution for **${args.teamName}** in place of **${args.playerOut}**.`,
  });
}

export function subCancelledPost(args: {
  teamName: string;
  playerOut: string;
  oppPing: Ping | null;
}): ChannelPost {
  return channelPost([args.oppPing], {
    title: "Substitution cancelled",
    color: BRAND_BLUE,
    description:
      `The substitution for **${args.teamName}** has been cancelled — ` +
      `**${args.playerOut}** will play as originally scheduled.`,
  });
}
