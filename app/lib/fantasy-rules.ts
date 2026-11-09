// Pure fantasy rules shared by the server actions and the pages, so the number a
// page draws and the number an action enforces can't disagree. No Supabase
// import, so node --test can load it.

export const FANTASY_MIN_MANAGERS = 4;
export const FANTASY_LEAGUE_NAME_MAX = 30;
export const FANTASY_SEASON_NAME_MAX = 60;

// docs/fantasy-rl.md §10: trades are a director's switch,
// league_settings.fantasy_trades_enabled, read by fantasyTradesEnabled().
export const TRADES_DISABLED_NOTE = "Trades are turned off for fantasy leagues.";

// docs/fantasy-rl.md §2: 4–6 managers, but at most 4 when the real season has 21
// or fewer teams. num_teams is the admin's configured count, which can still
// change before the real draft — so a league filled to 6 early can end up over a
// cap that later drops to 4. Joins are refused past the cap; nobody is evicted.
export function fantasyManagerCap(numTeams: number | null | undefined): number {
  return numTeams != null && numTeams > 0 && numTeams <= 21 ? 4 : 6;
}

export function normalizeLeagueName(raw: string): string | { error: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { error: "Give the league a name." };
  if (name.length > FANTASY_LEAGUE_NAME_MAX) {
    return { error: `League names are at most ${FANTASY_LEAGUE_NAME_MAX} characters.` };
  }
  return name;
}

// ended → complete is docs/fantasy-rl.md §15: the real event is over, and then
// its archive has been exported.
export type FantasyLeagueStatus = "pre_draft" | "drafting" | "active" | "ended" | "complete" | "disbanded" | "cancelled";

export const LEAGUE_STATUS_LABEL: Record<FantasyLeagueStatus, string> = {
  pre_draft: "Pre-draft",
  drafting: "Drafting",
  active: "In season",
  ended: "Final",
  complete: "Complete",
  disbanded: "Disbanded",
  cancelled: "Cancelled",
};

/** A league whose season is over and is drawn from its stored summary. */
export const isFinalLeague = (status: FantasyLeagueStatus) => status === "ended" || status === "complete";

/** Nothing about the league can change any more, its name and visibility included. */
export const isClosedLeague = (status: FantasyLeagueStatus) => isFinalLeague(status) || status === "disbanded" || status === "cancelled";
