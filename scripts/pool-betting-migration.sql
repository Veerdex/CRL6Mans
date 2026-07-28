-- Pari-mutuel ("pool") betting mode alongside the existing fixed-odds mode.
-- Directors toggle the league-wide default here; each match locks in whichever
-- mode was live at the moment its first bet lands (see placeBets in
-- app/dashboard/wagers/actions.ts), so in-flight matches never change mode
-- retroactively when the toggle is flipped later.
alter table league_settings add column if not exists betting_mode text not null default 'fixed';
alter table matches add column if not exists betting_mode text;

-- Pool-mode wagers have no fixed multiplier at placement time — payout is
-- only known once the match resolves and the final pool split is known.
alter table wagers alter column odds_multiplier drop not null;

-- Pool-mode wagers never get an odds_multiplier, so the realized payout
-- (or refund, for voided one-sided pools) is stored directly instead once
-- resolveMatchWagers settles the match — otherwise "My Bets" would have no
-- way to show what a settled pool bet actually paid out.
alter table wagers add column if not exists payout_amount integer;
