// How recently a player's tracker info must have been updated or confirmed before
// they can join a draft (tournament or season). When stale, they're prompted to
// update their tracker or confirm the details are unchanged.
export const TRACKER_FRESH_DAYS = 7;

export function isTrackerStale(confirmedAt: string | null | undefined): boolean {
  if (!confirmedAt) return true;
  const ageMs = Date.now() - new Date(confirmedAt).getTime();
  return ageMs > TRACKER_FRESH_DAYS * 24 * 60 * 60 * 1000;
}
