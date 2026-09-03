import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase";
import { addRole, addRoleById, getGuildRoles, getMemberRoleIds, removeRoleById } from "@/app/lib/discord-api";
import {
  enabledBenefitsForAccount,
  getBenefitsByTier,
  type BenefitAccountRow,
} from "@/app/lib/patreon-entitlements";

export const DISCORD_ROLE_BENEFIT = "discord-role";

// Every role name any tier configures for the benefit — the only names this
// reconciler is allowed to touch. Without it a "remove the role they no longer
// qualify for" pass would have to guess, and guessing wrong strips Captain,
// team, or staff roles. Anything outside this set is invisible to us.
async function managedRoleNames(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("patreon_tier_benefits")
    .select("value")
    .eq("benefit_id", DISCORD_ROLE_BENEFIT)
    .not("value", "is", null);

  const names = new Set<string>();
  for (const row of data ?? []) {
    const name = (row.value as string).trim();
    if (name) names.add(name);
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
// Tier inheritance already resolves the benefit to a single value (highest-
// priced source tier wins), so a patron ends up in exactly one supporter role.
//
// The one state it cannot converge from is a rename. setTierBenefits is
// delete-all-then-insert, so changing the configured name drops the old one out
// of the managed set and current holders keep it forever; renaming the role in
// Discord instead makes the lookup miss and creates a duplicate. Set the name
// once, and delete the orphan by hand if it has to change.
export async function syncDiscordSupporterRole(discordId: string): Promise<void> {
  if (!discordId || discordId.startsWith("test_")) return;

  const [{ data: account }, managed] = await Promise.all([
    supabaseAdmin
      .from("accounts")
      .select("status, patreon_status, patreon_tier_title, patreon_tier_override, patreon_public, patreon_benefit_prefs")
      .eq("discord_id", discordId)
      .maybeSingle(),
    managedRoleNames(),
  ]);

  // No tier names a role yet, so there is nothing this benefit could grant or
  // revoke — skip before spending any Discord calls.
  if (managed.size === 0) return;

  let target: string | null = null;
  if (account && account.status !== "banned") {
    const enabled = enabledBenefitsForAccount(await getBenefitsByTier(), account as BenefitAccountRow);
    target = enabled.get(DISCORD_ROLE_BENEFIT)?.trim() || null;
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

  const targetId = idByName.get(target);
  if (targetId) {
    if (!held.has(targetId)) await addRoleById(discordId, targetId);
    return;
  }
  // First grant of a role a director named but never created in Discord.
  // addRole creates it, which also lands it at the bottom of the hierarchy —
  // below the bot's own role, so the bot can keep assigning it.
  await addRole(discordId, target);
}
