import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase";
import { addRoleById, getMemberRoleIds, removeRoleById } from "@/app/lib/discord-api";
import {
  DISCORD_ROLE_BENEFIT,
  effectiveTier,
  enabledBenefitsForAccount,
  getBenefitsByTier,
  getTierRoleIds,
  type BenefitAccountRow,
} from "@/app/lib/patreon-entitlements";

export { DISCORD_ROLE_BENEFIT };

// Brings a patron's Discord roles in line with what they're entitled to AND
// have switched on — the same enabledBenefitsForAccount every other benefit
// reads, so the switch in Settings is the single source of truth here too.
//
// Stateless by design: rather than remembering which role we granted, it diffs
// the member's current roles against the roles connected in patreon_tier_roles.
// That means a tier change, a lapsed pledge and a flipped switch all converge to
// the same correct state on the next call, with no per-account bookkeeping
// column to drift. Only connected roles are ever touched, which is what keeps a
// "remove the role they no longer qualify for" pass from stripping Captain,
// team, or staff roles.
//
// The role a patron lands in is their own effective tier's, not the tier the
// benefit was assigned at — assign it once at the cheapest supporter tier and
// every tier above inherits the benefit while keeping its own role.
//
// The state it cannot converge from is a role that stops being connected —
// pointing a tier at a different role, or renaming the tier on Patreon. The old
// role leaves the managed set, so current holders keep it; delete it by hand.
export async function syncDiscordSupporterRole(discordId: string): Promise<void> {
  if (!discordId || discordId.startsWith("test_")) return;

  const [{ data: account }, byTier, roleByTier] = await Promise.all([
    supabaseAdmin
      .from("accounts")
      .select("status, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public, patreon_benefit_prefs")
      .eq("discord_id", discordId)
      .maybeSingle(),
    getBenefitsByTier(),
    getTierRoleIds(),
  ]);

  // No tier has a role connected, so there is nothing to grant or revoke — skip
  // before spending any Discord calls.
  const managed = new Set(roleByTier.values());
  if (managed.size === 0) return;

  let targetId: string | null = null;
  if (account && account.status !== "banned") {
    const row = account as BenefitAccountRow;
    if (enabledBenefitsForAccount(byTier, row).has(DISCORD_ROLE_BENEFIT)) {
      const tier = effectiveTier(
        row.patreon_status ?? null,
        row.patreon_tier_title ?? null,
        row.patreon_tier_override ?? null,
      )?.trim();
      targetId = (tier && roleByTier.get(tier)) || null;
    }
  }

  const memberRoleIds = await getMemberRoleIds(discordId);
  // null means the member couldn't be read — they left the guild, the bot is
  // unconfigured, or Discord is rate limiting. With no roles to diff against,
  // doing nothing beats guessing.
  if (memberRoleIds === null) return;

  const held = new Set(memberRoleIds);

  // By id, not by tier, so two tiers pointed at the same role don't fight.
  const stale = [...managed].filter((id) => id !== targetId && held.has(id));
  await Promise.all(stale.map((id) => removeRoleById(discordId, id)));

  if (targetId && !held.has(targetId)) await addRoleById(discordId, targetId);
}
