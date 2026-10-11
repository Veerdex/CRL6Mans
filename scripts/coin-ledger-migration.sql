-- ─────────────────────────────────────────────
-- CRL COIN LEDGER
--
-- Every coin movement gets a row. Before this, increment_crl_coins was a bare
-- `update accounts set crl_coins = crl_coins + n` returning void, so a failed
-- wager settlement left no way to answer "was this player actually paid?" —
-- and when the event reset deleted the wager rows, the question became
-- permanently unanswerable. See the post-mortem in
-- scripts/diagnose-wager-settlement.mjs.
--
-- Three things change:
--   1. crl_coin_transactions records every credit and debit with the balance
--      that resulted, so a balance can always be reconciled against its history.
--   2. The mutators return the number of rows they touched, so the app can tell
--      "credited" from "no account matched that discord_id" — the old function
--      returned void, making a silent no-op indistinguishable from success.
--   3. debit_crl_coins decrements conditionally (`crl_coins >= coin_amount`),
--      which is what makes bet placement safe against a concurrent payout. The
--      app used to read the balance and write back `read - cost`, erasing any
--      credit that landed in between.
--
-- RUN THIS BEFORE DEPLOYING THE CODE THAT GOES WITH IT, not after. The new
-- settlement path marks each wager settled and *then* credits it, so deployed
-- without these functions it would flip every bet to won/void, fail the credit
-- because credit_crl_coins does not exist, and fail to record the failure
-- because wager_settlement_failures does not exist either — settled-but-unpaid
-- with no record, on every match. That is the incident above, on repeat. Bet
-- placement and the dashboard grants break in the same window.
--
-- The other direction is safe: increment_crl_coins keeps its exact signature and
-- behaviour, and now writes a ledger row too, so currently deployed code starts
-- producing ledger rows the moment this lands.
--
-- plpgsql resolves column names on first call, not at create time, so a clean
-- run does not prove the bodies work. Smoke-test both shapes afterwards — a
-- zero amount moves no coins and leaves one ledger row each:
--
--   select credit_crl_coins('<your discord snowflake>', 0, 'migration smoke test');
--   select * from adjust_crl_coins('<your accounts.id>', 0, 'migration smoke test');
--
-- Expect 1 from the first and one row with applied = 0 from the second. If
-- either errors, do not deploy.
-- ─────────────────────────────────────────────

create table if not exists crl_coin_transactions (
  id            uuid        primary key default gen_random_uuid(),
  -- Keyed on the raw snowflake, like wagers/parlays/game_scores: a guest can
  -- hold coins before any players row exists, so an FK into players(id) would
  -- reject exactly the rows most worth recording.
  discord_id    text        not null,
  amount        integer     not null,
  balance_after integer     not null,
  reason        text        not null,
  -- What caused it: 'wager'/'parlay'/'match' plus the row id, so a settlement
  -- can be traced back to the bet it paid.
  ref_type      text,
  ref_id        text,
  created_at    timestamptz not null default now()
);

create index if not exists crl_coin_transactions_discord_id_idx on crl_coin_transactions(discord_id, created_at desc);
create index if not exists crl_coin_transactions_ref_idx        on crl_coin_transactions(ref_type, ref_id);

-- ─────────────────────────────────────────────
-- Durable record of a settlement escalation.
--
-- settleMatchWagers pushes to admins when it gives up, but a push is not a
-- record: by the time anyone investigated match 94ab64c4 the runtime log had
-- expired and the wager rows had been deleted by the event reset. This table
-- outlives both.
-- ─────────────────────────────────────────────
create table if not exists wager_settlement_failures (
  id          uuid        primary key default gen_random_uuid(),
  -- Null for voidAllPendingWagers, which refunds league-wide rather than for
  -- one match.
  match_id    uuid,
  mode        text        not null check (mode in ('void', 'resolve')),
  step        text,
  error       text        not null,
  -- The affected wagers/parlays as they stood at failure, so the reset that
  -- deletes those rows cannot take the evidence with it.
  snapshot    jsonb,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists wager_settlement_failures_match_idx on wager_settlement_failures(match_id);

-- ─────────────────────────────────────────────
-- credit_crl_coins — add coins and record why.
-- Returns 1 when an account was updated, 0 when no account matched.
-- ─────────────────────────────────────────────
create or replace function credit_crl_coins(
  player_discord_id text,
  coin_amount       integer,
  change_reason     text,
  ref_type          text default null,
  ref_id            text default null
) returns integer as $$
declare
  new_balance integer;
begin
  update accounts
  set crl_coins = crl_coins + coin_amount, updated_at = now()
  where discord_id = player_discord_id
  returning crl_coins into new_balance;

  if new_balance is null then
    return 0;
  end if;

  insert into crl_coin_transactions (discord_id, amount, balance_after, reason, ref_type, ref_id)
  values (player_discord_id, coin_amount, new_balance, change_reason, ref_type, ref_id);

  return 1;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────
-- debit_crl_coins — take coins, but only if they are there.
--
-- The `crl_coins >= coin_amount` predicate is the whole point: it makes the
-- balance check and the deduction one atomic statement. Two bets submitted at
-- once can no longer both pass a separate "can they afford it?" read and spend
-- the same coins, and a payout landing mid-placement is no longer overwritten.
-- Returns 1 on success, 0 when the account is missing or short.
-- ─────────────────────────────────────────────
create or replace function debit_crl_coins(
  player_discord_id text,
  coin_amount       integer,
  change_reason     text,
  ref_type          text default null,
  ref_id            text default null
) returns integer as $$
declare
  new_balance integer;
begin
  update accounts
  set crl_coins = crl_coins - coin_amount, updated_at = now()
  where discord_id = player_discord_id and crl_coins >= coin_amount
  returning crl_coins into new_balance;

  if new_balance is null then
    return 0;
  end if;

  insert into crl_coin_transactions (discord_id, amount, balance_after, reason, ref_type, ref_id)
  values (player_discord_id, -coin_amount, new_balance, change_reason, ref_type, ref_id);

  return 1;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────
-- adjust_crl_coins — the admin adjustment tool's signed delta, clamped at 0.
--
-- Keyed on accounts.id because that is what the admin UI and
-- wager_balance_adjustments carry, not the snowflake. Can't be debit_crl_coins:
-- an adjustment clamps to 0 rather than refusing when the player is short, and
-- the caller needs the amount that actually landed for its own audit row.
--
-- `for update` is what makes the clamp safe. The app used to read the balance,
-- compute max(0, read + delta) in JS, and write that absolute value back —
-- erasing any bet or payout that settled in between.
-- ─────────────────────────────────────────────
create or replace function adjust_crl_coins(
  account_id    uuid,
  delta         integer,
  change_reason text
) returns table (applied integer, balance_after integer) as $$
declare
  snowflake      text;
  before_balance integer;
  after_balance  integer;
begin
  select a.discord_id, coalesce(a.crl_coins, 0)
  into snowflake, before_balance
  from accounts a where a.id = account_id
  for update;

  if snowflake is null then
    return;
  end if;

  after_balance := greatest(0, before_balance + delta);

  update accounts set crl_coins = after_balance, updated_at = now() where id = account_id;

  insert into crl_coin_transactions (discord_id, amount, balance_after, reason, ref_type, ref_id)
  values (snowflake, after_balance - before_balance, after_balance, change_reason, 'admin_adjustment', account_id::text);

  return query select after_balance - before_balance, after_balance;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────
-- set_crl_coins — absolute set, for resetAllBalancesToStart.
-- Returns the delta it applied so the audit row can record it.
-- ─────────────────────────────────────────────
create or replace function set_crl_coins(
  account_id    uuid,
  new_amount    integer,
  change_reason text
) returns table (applied integer, balance_after integer) as $$
declare
  snowflake      text;
  before_balance integer;
begin
  select a.discord_id, coalesce(a.crl_coins, 0)
  into snowflake, before_balance
  from accounts a where a.id = account_id
  for update;

  if snowflake is null then
    return;
  end if;

  update accounts set crl_coins = new_amount, updated_at = now() where id = account_id;

  insert into crl_coin_transactions (discord_id, amount, balance_after, reason, ref_type, ref_id)
  values (snowflake, new_amount - before_balance, new_amount, change_reason, 'admin_adjustment', account_id::text);

  return query select new_amount - before_balance, new_amount;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────
-- increment_crl_coins — kept at its exact old signature so a deploy can land
-- either side of this migration, and so any caller missed in the sweep still
-- produces a ledger row instead of an untraceable balance change.
-- ─────────────────────────────────────────────
create or replace function increment_crl_coins(player_discord_id text, coin_amount integer)
returns void as $$
  select credit_crl_coins(player_discord_id, coin_amount, 'legacy increment_crl_coins');
$$ language sql;

-- ─────────────────────────────────────────────
-- bump_team_record — atomic win/loss increment.
--
-- execReportMatchResult used to read wins/losses and write back read+1. Two
-- matches for the same team completing at once silently lost one increment.
-- ─────────────────────────────────────────────
create or replace function bump_team_record(team uuid, won boolean)
returns void as $$
  update teams
  set wins   = coalesce(wins, 0)   + (case when won then 1 else 0 end),
      losses = coalesce(losses, 0) + (case when won then 0 else 1 end)
  where id = team;
$$ language sql;

revoke execute on function bump_team_record(uuid, boolean) from public, anon, authenticated;
grant execute on function bump_team_record(uuid, boolean) to service_role;

-- ─────────────────────────────────────────────
-- Lock the coin mutators down to the service role.
--
-- Postgres grants EXECUTE to PUBLIC by default and Supabase exposes every
-- public function at /rest/v1/rpc/, so these were callable with the anon key
-- that ships in the browser bundle. They are SECURITY INVOKER, so RLS on
-- `accounts` was the only thing in the way — verify RLS is enabled on that
-- table too; this migration does not assume it.
-- ─────────────────────────────────────────────
revoke execute on function increment_crl_coins(text, integer) from public, anon, authenticated;
revoke execute on function credit_crl_coins(text, integer, text, text, text) from public, anon, authenticated;
revoke execute on function debit_crl_coins(text, integer, text, text, text) from public, anon, authenticated;
revoke execute on function adjust_crl_coins(uuid, integer, text) from public, anon, authenticated;
revoke execute on function set_crl_coins(uuid, integer, text) from public, anon, authenticated;

grant execute on function increment_crl_coins(text, integer) to service_role;
grant execute on function credit_crl_coins(text, integer, text, text, text) to service_role;
grant execute on function debit_crl_coins(text, integer, text, text, text) to service_role;
grant execute on function adjust_crl_coins(uuid, integer, text) to service_role;
grant execute on function set_crl_coins(uuid, integer, text) to service_role;
