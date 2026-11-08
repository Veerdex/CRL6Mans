// Every embed the bot posts during a draft. Pure formatting with no Supabase
// import, so it stays out of discord-bot.ts's orbit and can be read on its own.
//
// Mentions inside an embed do not notify anyone. Every ping therefore stays in
// the message `content`; these only ever carry names already rendered as plain
// text, never a <@id>.

import type { DiscordEmbed } from "./discord-api";
import type { ChannelPost } from "./match-embeds";
import { getTeamNumberForPick } from "./draft-order";

const BRAND_ORANGE = 0xe88a24;
const BRAND_BLUE = 0x3736ac;
const WARN_AMBER = 0xd97706;
const DONE_GREEN = 0x22c55e;

// Discord rejects a field value over 1024 characters, which a 32-team captain
// list clears on its own. Continuation fields use a zero-width space for their
// name so the list reads as one block.
const FIELD_LIMIT = 1024;

function lineFields(lines: string[], name: string): Array<{ name: string; value: string }> {
  const fields: Array<{ name: string; value: string }> = [];
  let buf: string[] = [];
  let len = 0;
  const flush = () => {
    if (buf.length) fields.push({ name: fields.length ? "​" : name, value: buf.join("\n") });
    buf = [];
    len = 0;
  };
  for (const line of lines) {
    if (len + line.length + 1 > FIELD_LIMIT) flush();
    buf.push(line);
    len += line.length + 1;
  }
  flush();
  return fields;
}

/** "Snake Draft" only once there are two rounds to snake between. */
export function draftLabel(teamSize: number): string {
  return teamSize - 1 > 1 ? "Snake Draft" : `${teamSize}v${teamSize} Draft`;
}

export type CaptainSeat = { teamNum: number; name: string; rv: number };

export function draftStartEmbed(opts: {
  teamSize: number;
  numTeams: number;
  entered: number;
  undrafted: number;
  captains: CaptainSeat[];
}): DiscordEmbed {
  const { teamSize, numTeams, entered, undrafted, captains } = opts;
  const pickRounds = teamSize - 1;

  // Generated from getTeamNumberForPick rather than rebuilt by hand, so the order
  // shown here cannot drift from the order actually enforced.
  const rounds = Array.from({ length: pickRounds }, (_, r) =>
    Array.from({ length: numTeams }, (_, i) =>
      getTeamNumberForPick(r * numTeams + i, numTeams)
    ).join(", ")
  );

  const orderField = pickRounds > 1
    ? {
        name: "Pick order (snake)",
        value: rounds.map((r, i) => `**Round ${i + 1}:** ${r}`).join("\n"),
      }
    : {
        name: "Pick order (lowest Rank Value first)",
        value: rounds[0],
      };

  return {
    color: BRAND_ORANGE,
    title: `🚀 ${draftLabel(teamSize)} has started!`,
    description:
      `**${numTeams}** teams · **${entered}** entered · ${teamSize} per team`
      + (undrafted > 0 ? ` · ${undrafted} not drafted` : ""),
    fields: [
      ...lineFields(
        captains.map(c => `**Team ${c.teamNum}** — ${c.name} · RV ${c.rv.toFixed(0)}`),
        "Captains (auto-assigned by Rank Value)",
      ),
      orderField,
    ],
    footer: { text: "Captains pick with /pick <player> · 45 seconds on the clock" },
  };
}

export function onTheClockEmbed(teamNum: number, captainName?: string): DiscordEmbed {
  return {
    color: BRAND_ORANGE,
    title: `⏭️ Team ${teamNum} is on the clock`,
    description: (captainName ? `Captain: **${captainName}**\n` : "")
      + "Use `/pick <player>` to take someone from the pool.",
    footer: { text: "45 seconds, then the highest Rank Value left is picked for you" },
  };
}

/**
 * The finished state of a pick. This replaces the on-the-clock message in place
 * rather than being posted under it, so one pick is one message that changes.
 *
 * A timed-out pick is the same message in amber instead of a separate "ran out
 * of time" post — the result and the reason for it belong together.
 */
export function pickEmbed(opts: {
  teamName: string;
  playerName: string;
  pickNumber: number;
  totalPicks: number;
  auto?: boolean;
}): DiscordEmbed {
  return opts.auto
    ? {
        color: WARN_AMBER,
        title: `⏰ ${opts.teamName} ran out of time — auto-picked ${opts.playerName}`,
        description: "The highest Rank Value left in the pool was picked for them.",
        footer: { text: `Pick ${opts.pickNumber} of ${opts.totalPicks}` },
      }
    : {
        color: BRAND_BLUE,
        title: `✅ ${opts.teamName} picks ${opts.playerName}`,
        footer: { text: `Pick ${opts.pickNumber} of ${opts.totalPicks}` },
      };
}

export function draftCompleteEmbed(opts: {
  teamSize: number;
  numTeams: number;
  totalPicks: number;
}): DiscordEmbed {
  return {
    color: DONE_GREEN,
    title: `🏁 ${draftLabel(opts.teamSize)} complete!`,
    description: "Rosters are locked. Check your team on the website.",
    footer: { text: `${opts.numTeams} teams · ${opts.totalPicks} picks` },
  };
}

// A test account's ID is "test_…", which Discord would print as raw <@test_…>
// text, so only a real snowflake becomes a ping.
const SNOWFLAKE = /^\d{17,20}$/;

/** The start announcement, pinging the event role so everyone entered hears it. */
export function draftStartPost(
  opts: Parameters<typeof draftStartEmbed>[0],
  roleId: string | null,
): ChannelPost {
  const role = roleId && SNOWFLAKE.test(roleId) ? roleId : null;
  return {
    content: role ? `<@&${role}>` : "",
    embeds: [draftStartEmbed(opts)],
    allowed_mentions: { parse: [], roles: role ? [role] : [] },
  };
}

/** The on-the-clock message: the captain is pinged in content, where it notifies. */
export function onTheClockPost(
  teamNum: number,
  captain: { discordId: string | null; name: string } | null,
): ChannelPost {
  const userId = captain?.discordId && SNOWFLAKE.test(captain.discordId) ? captain.discordId : null;
  return {
    content: userId ? `<@${userId}>` : "",
    embeds: [onTheClockEmbed(teamNum, captain?.name)],
    allowed_mentions: { parse: [], users: userId ? [userId] : [] },
  };
}
