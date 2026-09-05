import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase";
import {
  enabledBenefitsForAccount,
  getAccountBenefits,
  getBenefitsByTier,
  type BenefitAccountRow,
} from "@/app/lib/patreon-entitlements";

export const EARLY_SIGNUP_BENEFIT = "early-signup-access";

// "One week before sign-ups open to everyone" is what the benefit catalog
// promises, so the offset lives here rather than becoming a per-tournament
// setting nobody asked for.
const EARLY_SIGNUP_MS = 7 * 24 * 60 * 60 * 1000;

// draft_open_at is when sign-ups open to everyone despite the name — the
// tournament-scheduler cron is what flips signups_open once it passes.
export type SignupWindowRow = {
  status?: string | null;
  signups_open?: boolean | null;
  signups_closed?: boolean | null;
  draft_open_at?: string | null;
  draft_close_at?: string | null;
};

// The single place the sign-up window is decided, so a server action and the
// UI that renders its button can never disagree about who may sign up when.
// `early` moves the opening edge only: a tournament an admin closed by hand
// stays closed, one they opened by hand is already open to everyone, and the
// close time is the same for patrons as for anyone else.
export function signupWindowOpen(t: SignupWindowRow, early = false, now = Date.now()): boolean {
  if (t.status !== "scheduled") return false;
  if (t.signups_closed) return false;
  if (t.signups_open) return true;
  if (!t.draft_open_at) return false;
  if (now < new Date(t.draft_open_at).getTime() - (early ? EARLY_SIGNUP_MS : 0)) return false;
  return !t.draft_close_at || now < new Date(t.draft_close_at).getTime();
}

/** Open to patrons but not yet to everyone — for labelling, not for gating. */
export function inEarlySignupWindow(t: SignupWindowRow, now = Date.now()): boolean {
  return signupWindowOpen(t, true, now) && !signupWindowOpen(t, false, now);
}

export async function hasEarlySignupAccess(discordId: string | null | undefined): Promise<boolean> {
  if (!discordId) return false;
  return (await getAccountBenefits(discordId)).has(EARLY_SIGNUP_BENEFIT);
}

// Bulk form for the team paths, which resolve several team creators at once:
// two queries total rather than two per player. Entitlement lives on the
// account (Tier 1), so player ids have to be mapped through discord_id.
export async function earlySignupAccessByPlayerId(playerIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(playerIds)];
  if (!ids.length) return new Set();

  const { data: players } = await supabaseAdmin
    .from("players")
    .select("id, discord_id")
    .in("id", ids);
  const rows = (players ?? []) as { id: string; discord_id: string | null }[];
  const discordIds = rows.map((p) => p.discord_id).filter((d): d is string => !!d);
  if (!discordIds.length) return new Set();

  const [{ data: accounts }, byTier] = await Promise.all([
    supabaseAdmin
      .from("accounts")
      .select(
        "discord_id, status, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public, patreon_benefit_prefs"
      )
      .in("discord_id", discordIds),
    getBenefitsByTier(),
  ]);

  const entitled = new Set<string>();
  for (const a of (accounts ?? []) as (BenefitAccountRow & { discord_id: string; status: string | null })[]) {
    if (a.status === "banned") continue;
    if (enabledBenefitsForAccount(byTier, a).has(EARLY_SIGNUP_BENEFIT)) entitled.add(a.discord_id);
  }
  return new Set(rows.filter((p) => p.discord_id && entitled.has(p.discord_id)).map((p) => p.id));
}

export async function playerHasEarlySignupAccess(playerId: string | null | undefined): Promise<boolean> {
  if (!playerId) return false;
  return (await earlySignupAccessByPlayerId([playerId])).has(playerId);
}
