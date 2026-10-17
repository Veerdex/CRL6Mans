import { supabaseAdmin } from "@/app/lib/supabase";

// `game_scores` holds both of the Game tab's leaderboards, so every query has to say
// which one it means. Flappy is scored all-time and has no seed; its rows sit on seed 0,
// which getDailySeed never draws, so the two games cannot collide on a key.
export const FLAPPY_GAME = "flappy";
export const FLAPPY_SEED = 0;
export const SEND_IT_GAME = "send_it";

/**
 * The widest distance worth storing, in metres.
 *
 * A sanity bound, not an anti-cheat: the game is client-side, so a determined player can
 * post whatever they like and the only real defence is that the league is small enough to
 * notice. The sim has no speed ceiling to derive an exact bound from — the car starts at
 * 13 m/s and the rest is terrain — so this is set where no run can reach it: 60 seconds
 * at an average of 420 m/s, which is two orders of magnitude above a good run.
 */
export const MAX_PLAUSIBLE_METRES = 25_000;

type AccountBits = { username: string; display_name: string | null; avatar: string | null };

/**
 * Names and avatars for a set of Discord IDs, from `accounts` (Tier 1).
 *
 * Tier 1 because it exists for every Discord login — reading them off `players` left
 * anyone without a roster row (guests, unapproved players) showing their raw username and
 * no picture.
 *
 * The username comes from here too. `game_scores.username` is a snapshot from whenever the
 * score was set, so a player who has renamed on Discord since was listed under a name the
 * site no longer knows them by — and their profile, which resolves by username, could not
 * be opened at all. The snapshot only stands in for a score whose account is gone.
 */
export async function accountsFor(discordIds: string[]): Promise<Map<string, AccountBits>> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("discord_id, username, display_name, avatar")
    .in("discord_id", discordIds);
  return new Map(
    (data ?? []).map((a: { discord_id: string } & AccountBits) => [
      a.discord_id,
      { username: a.username, display_name: a.display_name, avatar: a.avatar },
    ]),
  );
}

export type SendItBoardRow = {
  name: string;
  metres: number;
  /** The livery the distance was driven in, or null for a row written before the columns. */
  car: number | null;
  hue: number | null;
  /** The viewer's own row, which the game draws as "You" and reads its stored best from. */
  you: boolean;
};

/**
 * Every run posted on one seed, best first.
 *
 * The whole field rather than a top ten, because the game ranks the rows itself: it drops
 * the viewer's stored row and puts their live one back in its place, so a server that had
 * already sliced would hand an eleventh-place player a row numbered 11 when they are 148th.
 * One row per player per seed, so the field is the size of the league.
 *
 * Returns null on any failure — including the columns not existing yet, between this
 * deploying and the migration being run. The game treats null as "no board to show" and
 * keeps its own session-only row, which is what it did before any of this was wired.
 */
export async function fetchSendItBoard(
  seed: number,
  viewerDiscordId: string,
): Promise<SendItBoardRow[] | null> {
  const { data, error } = await supabaseAdmin
    .from("game_scores")
    .select("discord_id, username, score, car, hue")
    .eq("game", SEND_IT_GAME)
    .eq("seed", seed)
    .order("score", { ascending: false });
  if (error) return null;
  if (!data?.length) return [];

  type Row = {
    discord_id: string;
    username: string;
    score: number;
    car: number | null;
    hue: number | null;
  };
  const accountById = await accountsFor((data as Row[]).map((r) => r.discord_id));
  return (data as Row[]).map((r) => {
    const account = accountById.get(r.discord_id);
    return {
      name: account?.display_name ?? account?.username ?? r.username,
      metres: r.score,
      car: r.car,
      hue: r.hue,
      you: r.discord_id === viewerDiscordId,
    };
  });
}

/**
 * Records a run, if it beats what this player already has on this seed.
 *
 * Read-then-write rather than an upsert with a `score > excluded.score` condition, which
 * PostgREST has no way to express. Two tabs finishing at once can therefore both read the
 * old best and the later write wins on a lower distance — a player racing themselves out
 * of one metre, which is not worth a stored procedure.
 */
export async function saveSendItScore(args: {
  discordId: string;
  username: string;
  seed: number;
  metres: number;
  car: number | null;
  hue: number | null;
}): Promise<boolean> {
  const { data: existing, error: readError } = await supabaseAdmin
    .from("game_scores")
    .select("score")
    .eq("discord_id", args.discordId)
    .eq("game", SEND_IT_GAME)
    .eq("seed", args.seed)
    .maybeSingle();
  if (readError) return false;
  if (existing && (existing.score ?? 0) >= args.metres) return true;

  const { error } = await supabaseAdmin.from("game_scores").upsert(
    {
      discord_id: args.discordId,
      username: args.username,
      game: SEND_IT_GAME,
      seed: args.seed,
      score: args.metres,
      car: args.car,
      hue: args.hue,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "discord_id,game,seed" },
  );
  return !error;
}
