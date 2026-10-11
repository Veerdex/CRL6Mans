import { supabaseAdmin } from "./supabase";

/** One-time bonus for submitting a registration, on top of the signup balance. */
export const REGISTRATION_BONUS = 500;

/** Recurring grant during a manual season, credited on the player's next visit. */
export const WEEKLY_GRANT = 250;

/**
 * The only two ways coins move. Both go through the ledger (see
 * scripts/coin-ledger-migration.sql), so every balance can be reconciled
 * against its own history.
 *
 * Nothing here is allowed to fail quietly. The incident these replace —
 * match 94ab64c4, where bets were marked settled and the coins may never have
 * arrived — was unanswerable precisely because the old RPC returned void: a
 * write that matched no account looked exactly like a write that worked, and no
 * record of either survived.
 */

export type CoinRef = { refType: string; refId: string };

/**
 * Supabase reports a failed RPC as an error field rather than an exception, and
 * the function returns 0 when no account matched that snowflake. Both are real
 * failures to pay someone, so both throw.
 */
async function moveCoins(
  fn: "credit_crl_coins" | "debit_crl_coins",
  discordId: string,
  amount: number,
  reason: string,
  ref?: CoinRef,
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(fn, {
    player_discord_id: discordId,
    coin_amount: amount,
    change_reason: reason,
    ref_type: ref?.refType ?? null,
    ref_id: ref?.refId ?? null,
  });
  if (error) throw new Error(`${fn} for ${discordId}: ${error.message}`);
  if (data !== 1) {
    throw new Error(
      `${fn} for ${discordId} matched no account (or insufficient balance): ${amount} — ${reason}`,
    );
  }
}

export async function creditCoins(
  discordId: string,
  amount: number,
  reason: string,
  ref?: CoinRef,
): Promise<void> {
  await moveCoins("credit_crl_coins", discordId, amount, reason, ref);
}

/**
 * Debits conditionally: the balance check and the deduction are one statement in
 * the DB, so this is also the affordability check. A `false` return means the
 * player could not pay — callers treat it as a validation failure, not an error,
 * which is why this one reports rather than throws.
 */
export async function debitCoins(
  discordId: string,
  amount: number,
  reason: string,
  ref?: CoinRef,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("debit_crl_coins", {
    player_discord_id: discordId,
    coin_amount: amount,
    change_reason: reason,
    ref_type: ref?.refType ?? null,
    ref_id: ref?.refId ?? null,
  });
  if (error) throw new Error(`debit_crl_coins for ${discordId}: ${error.message}`);
  return data === 1;
}

export type CoinAdjustment = { applied: number; balanceAfter: number };

/**
 * The admin adjustment tool's two writes, keyed on accounts.id (what the admin UI
 * and wager_balance_adjustments carry) rather than the snowflake. The clamp and
 * the absolute set both happen inside the DB under a row lock, and both return
 * the delta that actually landed so the caller's audit row stays honest.
 * `null` means no account with that id.
 */
async function adjustByAccount(
  fn: "adjust_crl_coins" | "set_crl_coins",
  arg: "delta" | "new_amount",
  accountId: string,
  amount: number,
  reason: string,
): Promise<CoinAdjustment | null> {
  const { data, error } = await supabaseAdmin.rpc(fn, {
    account_id: accountId,
    [arg]: amount,
    change_reason: reason,
  });
  if (error) throw new Error(`${fn} for ${accountId}: ${error.message}`);
  const row = (data as { applied: number; balance_after: number }[] | null)?.[0];
  return row ? { applied: row.applied, balanceAfter: row.balance_after } : null;
}

export function adjustCoinsByAccount(accountId: string, delta: number, reason: string) {
  return adjustByAccount("adjust_crl_coins", "delta", accountId, delta, reason);
}

export function setCoinsByAccount(accountId: string, amount: number, reason: string) {
  return adjustByAccount("set_crl_coins", "new_amount", accountId, amount, reason);
}

/**
 * Credits a batch and reports which ones failed instead of throwing on the first.
 * A settlement paying N players should pay every one it can — stopping at the
 * first failure is what left the rest of a match's bets uncredited.
 */
export async function creditManyCoins(
  credits: { discordId: string; amount: number; ref?: CoinRef }[],
  reason: string,
): Promise<{ failures: { discordId: string; amount: number; message: string }[] }> {
  const results = await Promise.all(
    credits.map(async (c) => {
      try {
        await creditCoins(c.discordId, c.amount, reason, c.ref);
        return null;
      } catch (e) {
        return { discordId: c.discordId, amount: c.amount, message: (e as Error).message };
      }
    }),
  );
  return { failures: results.filter((r): r is NonNullable<typeof r> => r !== null) };
}
