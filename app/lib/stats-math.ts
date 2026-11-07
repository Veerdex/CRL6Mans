// The derived figures the stats table sorts by. A pure leaf with no imports, so
// the "use client" stats table and the Discord bot can share one definition —
// a second copy of mvpScore would let /stats and the website disagree about who
// the best player is.

/** The totals both formulas need. Any row carrying these fields satisfies it. */
export type StatTotals = {
  games: number;
  totalGoals: number;
  totalAssists: number;
  totalSaves: number;
  totalShots: number;
  totalScore: number;
};

type MvpFormula = {
  compute: (row: StatTotals) => number;
  /** Shown under the Stats table. */
  equation: string;
  /** The Help page's plain-language answer. */
  explanation: string;
};

const MVP_FORMULAS = {
  // The original. Goals, assists and saves count equally, which made saves
  // the biggest share of an average player's MVP.
  v1: {
    compute: (r) =>
      (r.totalGoals + r.totalAssists + r.totalSaves + r.totalShots / 10) / (r.games * 4) +
      r.totalScore / r.games / 1000,
    equation: "MVP = ((G+A+Sv+Sh÷10)÷(GP×4)) + Sc÷GP÷1000",
    explanation:
      "Your goals, assists and saves per game count equally, shots count a tenth as much, and your in-game score per game adds a small bonus on top.",
  },
  // In-game score plus bonuses that halve from goal to assist to save.
  // Tracks RV more closely than v1 and weights finishing over shot-stopping.
  v2: {
    compute: (r) =>
      (r.totalScore + 500 * r.totalGoals + 250 * r.totalAssists + 125 * r.totalSaves + 25 * r.totalShots) /
      (1000 * r.games),
    equation: "MVP = (Sc + 500G + 250A + 125Sv + 25Sh) ÷ (1000×GP)",
    explanation:
      "Your average in-game score per game, plus bonuses — +500 per goal, +250 per assist, +125 per save and +25 per shot — divided by 1000. A typical player lands around 1.0.",
  },
} satisfies Record<string, MvpFormula>;

/** Switch back to the original formula by setting this to "v1". */
const ACTIVE_MVP_FORMULA: keyof typeof MVP_FORMULAS = "v2";

const active: MvpFormula = MVP_FORMULAS[ACTIVE_MVP_FORMULA];

export const MVP_EQUATION = active.equation;
export const MVP_EXPLANATION = active.explanation;

export function mvpScore(row: StatTotals): number {
  if (row.games === 0) return 0;
  return active.compute(row);
}

export function shootingPct(row: Pick<StatTotals, "totalGoals" | "totalShots">): number {
  if (row.totalShots === 0) return 0;
  return (row.totalGoals / row.totalShots) * 100;
}
