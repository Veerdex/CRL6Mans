// Made-up scoreboard lines for a simulated series in a test event, so a test
// with nobody to play it still has stats for fantasy and the Stats page to
// read. Pure: the caller supplies the rosters and the final series score.

export type FakeStatLine = {
  playerId: string;
  gameNumber: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  score: number;
  demos: number;
  demoed: number;
};

type Rand = () => number;

function int(rand: Rand, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function pick<T>(rand: Rand, xs: T[]): T {
  return xs[Math.floor(rand() * xs.length)];
}

/**
 * The order games were won in: the series winner takes the last game, since a
 * series ends the moment one side reaches its total.
 */
export function gameWinners(homeScore: number, awayScore: number, rand: Rand = Math.random): ("home" | "away")[] {
  if (homeScore === awayScore) return [];
  const winner = homeScore > awayScore ? "home" : "away";
  const early: ("home" | "away")[] = [
    ...Array<"home">(winner === "home" ? homeScore - 1 : homeScore).fill("home"),
    ...Array<"away">(winner === "away" ? awayScore - 1 : awayScore).fill("away"),
  ];
  for (let i = early.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [early[i], early[j]] = [early[j], early[i]];
  }
  return [...early, winner];
}

function teamGame(players: string[], goals: number, rand: Rand) {
  const line = new Map(players.map((id) => [id, { goals: 0, assists: 0, shots: 0, saves: 0, demos: 0, demoed: 0 }]));
  for (let g = 0; g < goals; g++) {
    const scorer = pick(rand, players);
    line.get(scorer)!.goals++;
    const mates = players.filter((p) => p !== scorer);
    if (mates.length && rand() < 0.6) line.get(pick(rand, mates))!.assists++;
  }
  for (const s of line.values()) s.shots = s.goals + int(rand, 0, 3);
  return line;
}

export function fakeSeriesStats(
  { home, away, homeScore, awayScore }: { home: string[]; away: string[]; homeScore: number; awayScore: number },
  rand: Rand = Math.random,
): FakeStatLine[] {
  if (!home.length || !away.length) return [];
  const out: FakeStatLine[] = [];
  gameWinners(homeScore, awayScore, rand).forEach((winner, i) => {
    const winGoals = int(rand, 1, 5);
    const loseGoals = int(rand, 0, winGoals - 1);
    const h = teamGame(home, winner === "home" ? winGoals : loseGoals, rand);
    const a = teamGame(away, winner === "away" ? winGoals : loseGoals, rand);

    // Saves come out of the other side's missed shots; a demo lands on someone
    // from the other team.
    for (const [mine, theirs] of [[h, a], [a, h]] as const) {
      const ids = [...mine.keys()];
      const missed = [...theirs.values()].reduce((n, s) => n + s.shots - s.goals, 0);
      for (let k = int(rand, 0, missed); k > 0; k--) mine.get(pick(rand, ids))!.saves++;
      const theirIds = [...theirs.keys()];
      for (let k = int(rand, 0, ids.length); k > 0; k--) {
        mine.get(pick(rand, ids))!.demos++;
        theirs.get(pick(rand, theirIds))!.demoed++;
      }
    }

    for (const line of [h, a]) {
      for (const [playerId, s] of line) {
        const score = 100 * s.goals + 50 * s.assists + 50 * s.saves + 10 * s.shots + 15 * s.demos + int(rand, 40, 200);
        out.push({ playerId, gameNumber: i + 1, ...s, score });
      }
    }
  });
  return out;
}
