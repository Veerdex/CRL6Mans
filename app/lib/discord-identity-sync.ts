import { supabaseAdmin } from "./supabase";
import { fetchDiscordUser } from "./discord-api";

// Discord's global ceiling is 50 requests/second. A league is dozens to low
// hundreds of accounts, so this is nowhere near it — the pause just keeps the
// sequential sweep from arriving as one burst.
const REQUEST_SPACING_MS = 60;

export type IdentitySyncResult = {
  scanned: number;
  updated: number;
  unreachable: number;
};

/**
 * Refreshes the Discord username and avatar hash the site stores for every
 * account.
 *
 * The OAuth callback already does this for whoever just signed in, but only on
 * `accounts` (Tier 1). Two gaps follow from that: a player who changes their
 * avatar and doesn't log in again goes stale everywhere, and the Tier 3 mirror
 * on `players` — which teams, my-team, the players list, podium and the admin
 * draft pool all read — has no writer at all, so it has been frozen at its
 * migration-time value. This closes both.
 *
 * `display_name` is deliberately not synced. It is a nickname the player sets
 * in Settings, not Discord's `global_name`, so copying Discord over it would
 * silently wipe everyone's choice on the first run.
 */
export async function syncDiscordIdentities(): Promise<IdentitySyncResult> {
  const [{ data: accounts }, { data: mirrors }] = await Promise.all([
    supabaseAdmin.from("accounts").select("id, discord_id, username, avatar"),
    supabaseAdmin.from("players").select("account_id, username, avatar"),
  ]);

  const mirrorByAccount = new Map(
    (mirrors ?? []).map((p) => [p.account_id as string, p as { username: string | null; avatar: string | null }]),
  );

  // Seeded test accounts have no Discord user behind them and would 404 on every
  // run; `test_` is the prefix the rest of the Discord layer already skips on.
  const rows = (accounts ?? []).filter(
    (a) => a.discord_id && !(a.discord_id as string).startsWith("test_"),
  );

  let updated = 0;
  let unreachable = 0;

  for (const [i, account] of rows.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS));

    const fresh = await fetchDiscordUser(account.discord_id as string);
    if (!fresh) {
      unreachable++;
      continue;
    }

    // The two tiers are checked separately on purpose: `accounts` is current for
    // anyone who logged in recently, so comparing only against it would leave
    // the mirror — the half that is actually stale — untouched forever.
    const mirror = mirrorByAccount.get(account.id as string);
    const accountStale = fresh.username !== account.username || fresh.avatar !== account.avatar;
    const mirrorStale = !!mirror && (fresh.username !== mirror.username || fresh.avatar !== mirror.avatar);
    if (!accountStale && !mirrorStale) continue;

    const patch = {
      username: fresh.username,
      avatar: fresh.avatar,
      updated_at: new Date().toISOString(),
    };
    if (accountStale) {
      await supabaseAdmin.from("accounts").update(patch).eq("id", account.id);
    }
    if (mirrorStale) {
      await supabaseAdmin.from("players").update(patch).eq("account_id", account.id);
    }
    updated++;
  }

  return { scanned: rows.length, updated, unreachable };
}
