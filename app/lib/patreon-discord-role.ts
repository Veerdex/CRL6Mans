import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase";
import { addRoleById, getGuildRoles, getMemberRoleIds, removeRoleById } from "@/app/lib/discord-api";
import {
  effectiveTier,
  enabledBenefitsForAccount,
  getBenefitsByTier,
  type BenefitAccountRow,
  type ResolvedBenefits,
} from "@/app/lib/patreon-entitlements";

export const DISCORD_ROLE_BENEFIT = "discord-role";

// A tier's Discord role is the guild role named after the tier — nothing is
// typed in, so the set of tiers granting the benefit doubles as the set of role
// names this reconciler is allowed to touch. That bound matters: without it a
// "remove the role they no longer qualify for" pass would have to guess, and
// guessing wrong strips Captain, team, or staff roles.
function managedRoleNames(byTier: Map<string, ResolvedBenefits>): Set<string> {
  const names = new Set<string>();
  for (const [title, benefits] of byTier) {
    const name = title.trim();
    if (name && benefits.has(DISCORD_ROLE_BENEFIT)) names.add(name);
  }
  return names;
}

// Brings a patron's Discord roles in line with what they're entitled to AND
// have switched on — the same enabledBenefitsForAccount every other benefit
// reads, so the switch in Settings is the single source of truth here too.
//
// Stateless by design: rather than remembering which role we granted, it diffs
// the member's current roles against the managed set. That means a tier change,
// a rename of the configured role, a lapsed pledge and a flipped switch all
// converge to the same correct state on the next call, with no per-account
// bookkeeping column to drift.
//
// The role a patron lands in is their own effective tier's, not the tier the
// benefit was assigned at — assign it once at the cheapest supporter tier and
// every tier above inherits the benefit while keeping its own role.
//
// The one state it cannot converge from is a tier rename on Patreon: the old
// title drops out of the managed set, so current holders keep the old role.
// Delete the orphan by hand if a tier is ever renamed.
export async function syncDiscordSupporterRole(discordId: string): Promise<void> {
  if (!discordId || discordId.startsWith("test_")) return;

  const [{ data: account }, byTier] = await Promise.all([
    supabaseAdmin
      .from("accounts")
      .select("status, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public, patreon_benefit_prefs")
      .eq("discord_id", discordId)
      .maybeSingle(),
    getBenefitsByTier(),
  ]);

  // No tier grants the benefit, so there is nothing to grant or revoke — skip
  // before spending any Discord calls.
  const managed = managedRoleNames(byTier);
  if (managed.size === 0) return;

  let target: string | null = null;
  if (account && account.status !== "banned") {
    const row = account as BenefitAccountRow;
    if (enabledBenefitsForAccount(byTier, row).has(DISCORD_ROLE_BENEFIT))
      target =
        effectiveTier(
          row.patreon_status ?? null,
          row.patreon_tier_title ?? null,
          row.patreon_tier_override ?? null,
        )?.trim() || null;
  }

  const [guildRoles, memberRoleIds] = await Promise.all([getGuildRoles(), getMemberRoleIds(discordId)]);
  // null means the member couldn't be read — they left the guild, the bot is
  // unconfigured, or Discord is rate limiting. With no roles to diff against,
  // doing nothing beats guessing.
  if (memberRoleIds === null) return;

  const held = new Set(memberRoleIds);
  const idByName = new Map(guildRoles.map((r) => [r.name, r.id] as const));

  const stale = [...managed]
    .filter((name) => name !== target)
    .map((name) => idByName.get(name))
    .filter((id): id is string => !!id && held.has(id));
  await Promise.all(stale.map((id) => removeRoleById(discordId, id)));

  if (!target) return;

  // A missing role is left missing rather than created: the tier is meant to
  // map onto a role that already exists, so creating one here would only
  // manufacture a duplicate of it under the same name.
  const targetId = idByName.get(target);
  if (targetId && !held.has(targetId)) await addRoleById(discordId, targetId);
}
