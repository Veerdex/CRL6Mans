import { randomInt } from "crypto";
import { supabaseAdmin } from "@/app/lib/supabase";

// The day's hills, as a number every player on that day shares.
//
// Random rather than derived from the date, so tomorrow's terrain cannot be computed and
// practised ahead of time. Stored rather than generated per request for the same reason a
// shared board needs it: two players have to get the same hills.
//
// Rotated lazily — the first page load of a new day writes the new seed — rather than on a
// schedule. A cron on this plan only runs daily anyway, so it could not hit the boundary any
// more precisely than the first visit after it does; and a seed nobody has asked for yet
// does not need to exist.
//
// PostgREST's code for a table that is not in its schema cache. The one error that means
// "the migration has not been run", and so the only one this falls back on.
const MISSING_TABLE = "PGRST205";

// Range asked for by the user. The low end keeps the seed from reading as a counter; the
// high end is the top of what every consumer handles exactly — sim.ts and rock.ts fold the
// seed through `^` (int32), and cars/daylight/paint through `%`, both exact well past this.
// Two seeds exactly 2^32 apart draw identical terrain through the int32 fold; at one draw
// a day that is a coincidence, not a mechanism.
const SEED_MIN = 1000;
const SEED_MAX = 9_999_999_999;

// Midnight Pacific, the boundary clip-of-the-week already uses, so the league has one day
// and not two. en-CA formats as YYYY-MM-DD, which is also what Postgres wants for a date.
function pacificDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function drawSeed(): number {
  // Exclusive upper bound, hence the +1: without it the top of the range never comes up.
  return randomInt(SEED_MIN, SEED_MAX + 1);
}

/**
 * The seed for today, rotating it first if the stored one belongs to an earlier day.
 *
 * The rotation is the conditional update itself, not a read followed by a write. Postgres
 * locks the row, so when two players open the game at the same moment on a new day the
 * second update re-tests `day <> today` against the committed row, matches nothing, and
 * falls through to the read — one seed, decided once, however many tabs raced for it.
 *
 * Falls back to a date-derived seed only while the table does not exist yet, so the game is
 * playable before the migration is run, and visibly so: a fallback seed reads as `2026MMDD`
 * on the board's Seed line where a real one does not.
 *
 * Any other failure raises instead of falling back. A fallback dressed as a success is the
 * worse outcome of the two — it hands one player a different day's hills from everyone
 * else's, on a distance that then gets posted — where a raised error is a tab that reloads.
 */
export async function getDailySeed(now: Date = new Date()): Promise<number> {
  const day = pacificDay(now);

  const { data: rotated, error: rotateError } = await supabaseAdmin
    .from("game_daily_seed")
    .update({ seed: drawSeed(), day })
    .neq("day", day)
    .select("seed")
    .maybeSingle();
  if (rotated?.seed) return Number(rotated.seed);
  if (rotateError?.code === MISSING_TABLE) return fallbackSeed(now);
  if (rotateError) throw new Error(`daily seed rotate failed: ${rotateError.message}`);

  // Matched nothing, so today's seed is already stored and somebody else drew it.
  const { data: current, error: readError } = await supabaseAdmin
    .from("game_daily_seed")
    .select("seed")
    .maybeSingle();
  if (current?.seed) return Number(current.seed);
  throw new Error(`daily seed read failed: ${readError?.message ?? "no row"}`);
}

// The old date seed, kept only for the pre-migration case. Pacific for the same reason the
// rotation is, so the fallback at least changes on the same boundary.
function fallbackSeed(now: Date): number {
  return Number(pacificDay(now).replace(/-/g, ""));
}
