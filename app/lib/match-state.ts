// "This match is under way, leave it alone."
//
// A non-null discord_channel_id used to prove it, because a tournament match's
// channel only opened once both teams had checked in. The channel now opens with
// the check-in window instead — teams need somewhere to coordinate before they
// check in, not after — so it proves only that the matchup is decided. Anything
// that gates on a match having started has to read the check-in flags.
//
// Manual and standalone seasons have no check-in at all and never write those
// columns, so there the channel is still the only signal there is.
//
// A pure leaf: no Supabase import, so a page can read it without pulling in
// discord-bot.ts.
export function matchHasBegun(
  m: { discord_channel_id?: string | null; home_checked_in?: boolean | null; away_checked_in?: boolean | null },
  isTournament: boolean,
): boolean {
  return isTournament ? !!(m.home_checked_in && m.away_checked_in) : !!m.discord_channel_id;
}
