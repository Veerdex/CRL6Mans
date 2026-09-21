// The Discord announcement for Clip of the Week. Pure formatting with no
// Supabase import, matching draft-embeds.ts, so it can be read on its own.
//
// Mentions inside an embed do not notify anyone, so the role ping is built
// separately by clipOfWeekPing() for the caller to put in the message
// `content`. The embed itself only ever carries plain text.

import type { DiscordEmbed } from "./discord-api";

const BRAND_ORANGE = 0xe88a24;

export type ClipOfWeekWinner = {
  weekNumber: number | null;
  title: string;
  url: string;
  likes: number;
  submitterName: string | null;
  imageUrl: string | null;
};

/**
 * The week heading is the embed's `title` rather than the clip's own title,
 * because the heading is what identifies the message and it is league-written:
 * a clip title is player-supplied, and Discord 400s the whole message on an
 * embed title over 256 characters instead of truncating it. The clip title goes
 * in the description, which allows 4096 — comfortably clear of the 150-character
 * cap createClip() already applies.
 *
 * `submitterName` is null when the submitter's player row was deleted
 * (clips.player_id is `on delete set null`), in which case the credit line is
 * dropped rather than reading "Submitted by null". `weekNumber` is null only
 * before the numbering migration has been run, and drops the week off the
 * heading rather than announcing a wrong one.
 */
export function clipOfWeekEmbed(winner: ClipOfWeekWinner): DiscordEmbed {
  const credit = winner.submitterName ? `Submitted by ${winner.submitterName} · ` : "";
  const likes = `${winner.likes} like${winner.likes === 1 ? "" : "s"}`;
  const week = winner.weekNumber === null ? "" : ` · Week ${winner.weekNumber}`;

  return {
    title: `🏆 Clip of the Week${week}`,
    url: winner.url,
    color: BRAND_ORANGE,
    description: `**${winner.title}**\n${credit}${likes}`,
    ...(winner.imageUrl ? { thumbnail: { url: winner.imageUrl } } : {}),
  };
}

/**
 * The message `content` that carries the ping, empty when no registered role is
 * configured — sendChannelMessage omits a falsy content entirely, so that
 * degrades to the embed-only message this announcement used to be.
 */
export function clipOfWeekPing(registeredRoleId: string | null): string {
  return registeredRoleId ? `<@&${registeredRoleId}>` : "";
}
