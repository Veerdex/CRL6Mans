/**
 * Whether a player has ever reported their ranks.
 *
 * Registration collects only a tracker URL — the MMR columns are
 * `not null default '0'`, so an approved player who has never been through a
 * join confirmation sits at zero, and `calculatePlayerRating` would read that
 * as the weakest player in the league rather than as an unknown. Every join
 * path therefore refuses until the numbers exist.
 *
 * The test is the two all-time peaks, and both must be zero to count as unset.
 * A player who has genuinely never placed in one playlist still has a peak in
 * the other, and a season peak of zero is ordinary a few days after a reset —
 * so either of those alone is a real value, not a missing one.
 */
export function hasMmrOnFile(row: { peak_2v2?: string | null; peak_3v3?: string | null }): boolean {
  return (Number(row.peak_2v2) || 0) > 0 || (Number(row.peak_3v3) || 0) > 0;
}

/** Surface-neutral: the website shows it in a popup, so it names no page. */
export const MMR_REQUIRED_MESSAGE =
  "Enter your ranks before joining — read them off your tracker and save them.";
