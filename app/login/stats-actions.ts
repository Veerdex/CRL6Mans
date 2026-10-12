"use server";

import { getPublicLeagueStats, type PublicLeagueStats } from "@/app/lib/public-league-stats";

// Called when the panel opens rather than rendered with the page, so /login
// stays at zero queries for the visitors who only ever click Login with
// Discord. The compute behind it is memoised for ten minutes.
export async function loadPublicLeagueStats(): Promise<PublicLeagueStats> {
  return getPublicLeagueStats();
}
