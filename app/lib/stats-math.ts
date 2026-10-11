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

/** MVP = ((G+A+Sv+Sh÷10)÷(GP×4)) + Sc÷GP÷1000 */
export function mvpScore(row: StatTotals): number {
  const { games, totalGoals, totalAssists, totalSaves, totalShots, totalScore } = row;
  if (games === 0) return 0;
  return (
    (totalGoals + totalAssists + totalSaves + totalShots / 10) / (games * 4) +
    totalScore / games / 1000
  );
}

export function shootingPct(row: Pick<StatTotals, "totalGoals" | "totalShots">): number {
  if (row.totalShots === 0) return 0;
  return (row.totalGoals / row.totalShots) * 100;
}
