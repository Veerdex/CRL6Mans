// Who picks when. Pure arithmetic with no Supabase import, so `node --test` can
// load it directly — the reason it lives here instead of in discord-bot.ts,
// which drags in supabaseAdmin and dies at module load outside Next.
//
// Covered by scripts/test-draft-order.ts (npm run test:draft-order).

// Snake draft: picks go N, N-1, ..., 1, 1, 2, ..., N, ...
export function getTeamNumberForPick(pickIndex: number, numTeams: number): number {
  const pickInRound = pickIndex % numTeams;
  const roundIndex = Math.floor(pickIndex / numTeams);
  return roundIndex % 2 === 0 ? numTeams - pickInRound : pickInRound + 1;
}

// Every captain is seated before pick 0, so a team only has team_size - 1 slots
// left to fill. 1v1 lands on 0, which is why it has no draft at all.
export function totalDraftPicks(numTeams: number, teamSize: number): number {
  return numTeams * (teamSize - 1);
}

/**
 * Maps RV rank onto team slots, deciding the whole pick order — getTeamNumberForPick
 * is fixed, so seating is the only lever. `teamsToUse` is ascending by slot number;
 * the returned array is indexed by RV rank, best first.
 *
 * Multi-round (3v3): reversed, so the highest-RV captain takes the highest team
 * number and picks first in round 1, last in round 2. That reversal is what
 * balances the snake.
 *
 * Single-round (2v2): there is no second round to balance against, so the order
 * runs the other way and the *worst* captain picks first — the best captain takes
 * Team 1, which the first round reaches last.
 */
export function captainSeatOrder<T>(teamsToUse: T[], pickRounds: number): T[] {
  return pickRounds > 1 ? [...teamsToUse].reverse() : [...teamsToUse];
}
