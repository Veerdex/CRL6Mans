import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { getDailySeed } from "@/app/lib/daily-seed";
import {
  MAX_PLAUSIBLE_METRES,
  fetchSendItBoard,
  saveSendItScore,
} from "@/app/lib/game-scores";

// A route rather than a server action, because the caller is not a React component: Send It
// is a plain document in an iframe (see app/dashboard/game/send-it.tsx), so it has no way to
// invoke an action. Same origin, so the session cookie rides along on its own.
//
// Every failure answers non-OK with no body worth reading. The game's rule is that anything
// but a 200 means "no board to show" — which covers running standalone out of Vite, and the
// gap between this deploying and the game_scores migration being run.

// The seed range getDailySeed draws from. A seed outside it is not one of ours, so there is
// nothing to look up and no point asking Postgres.
const SEED_MIN = 1000;
const SEED_MAX = 9_999_999_999;

function seedOf(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= SEED_MIN && n <= SEED_MAX ? n : null;
}

/**
 * The board for a seed.
 *
 * Takes the seed the caller is on rather than today's, so a tab left open across midnight
 * still shows the field for the hills it is actually driving. Serving an old seed costs
 * nothing — unlike POST, which pins the current one.
 *
 * Answers with today's seed alongside the rows, which is how a tab finds out it has sat
 * through midnight. Without it the only thing that ever noticed was a POST being refused,
 * and by then the run that discovered it is already gone.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const seed = seedOf(request.nextUrl.searchParams.get("seed"));
  if (seed === null) return NextResponse.json({ error: "Bad seed" }, { status: 400 });

  const rows = await fetchSendItBoard(seed, session.userId);
  if (rows === null) return NextResponse.json({ error: "No board" }, { status: 503 });
  return NextResponse.json({ rows, currentSeed: await getDailySeed() });
}

/**
 * Records a finished run, and answers with the board it lands on.
 *
 * The seed must be today's. A client can put anything in `?seed=`, and accepting a seed
 * that is merely well-formed would let a player drive a set of hills they had already
 * learned and post the distance to that day's board. There is no record of which seeds were
 * current on which day, so the only seed that can be checked is the one in play.
 *
 * The cost is a run that straddles midnight: it was honestly driven, on hills that are no
 * longer today's, and it is refused. That answers `saved: false` with a reason rather than a
 * failure, because the board has to be able to say so — a tab that silently stopped saving
 * is the bug this whole route exists to fix, and it would be back in a narrower form.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    seed?: unknown;
    metres?: unknown;
    car?: unknown;
    hue?: unknown;
  };
  const seed = seedOf(String(body.seed));
  const metres = Number(body.metres);
  if (seed === null) return NextResponse.json({ error: "Bad seed" }, { status: 400 });
  if (!Number.isInteger(metres) || metres < 0 || metres > MAX_PLAUSIBLE_METRES) {
    return NextResponse.json({ error: "Bad distance" }, { status: 400 });
  }

  // Bounds rather than a car list, because the server has no business knowing how many cars
  // the game ships. An index past the end is dropped by the game, which does know.
  const car = Number.isInteger(Number(body.car)) ? Number(body.car) : null;
  const hue = Number.isInteger(Number(body.hue)) ? Number(body.hue) : null;
  const livery =
    car !== null && hue !== null && car >= 0 && car < 256 && hue >= 0 && hue < 360
      ? { car, hue }
      : { car: null, hue: null };

  // Carries today's seed with the refusal, so the game can take the tab to the hills it
  // names rather than leave the player to work out that a reload is what was being asked
  // of them.
  const today = await getDailySeed();
  if (seed !== today) {
    return NextResponse.json({ saved: false, reason: "stale-seed", currentSeed: today });
  }

  const saved = await saveSendItScore({
    discordId: session.userId,
    username: session.username ?? "Unknown",
    seed,
    metres,
    ...livery,
  });
  if (!saved) return NextResponse.json({ error: "Not saved" }, { status: 503 });

  const rows = await fetchSendItBoard(seed, session.userId);
  if (rows === null) return NextResponse.json({ error: "No board" }, { status: 503 });
  return NextResponse.json({ saved: true, rows });
}
