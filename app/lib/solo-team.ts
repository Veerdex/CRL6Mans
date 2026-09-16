import { supabaseAdmin } from "@/app/lib/supabase";
import { avatarSrc } from "@/app/lib/avatar-url";
import { resolveTeamSize } from "@/app/lib/team-size";
import { getGuildRoles, ensureRoles } from "@/app/lib/discord-api";

// In a 1v1 tournament every participant would otherwise need their own Discord
// role, which means one role per player created and torn down per event. They
// all get this one instead — it says nothing more than "in the current event".
//
// This is only the name the bot falls back to before an admin has run
// /admin settournamentid. Once an ID is stored the role can be called anything.
export const TOURNAMENT_ROLE_NAME = "Tournament";

export type TournamentRole = { id: string; name: string };

async function storedTournamentRoleId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("tournament_role_id")
    .single();
  return (data?.tournament_role_id as string | null) ?? null;
}

/**
 * The role every 1v1 participant holds. Prefers the ID set by
 * /admin settournamentid; falls back to a role named TOURNAMENT_ROLE_NAME so the
 * feature works before an admin ever runs the command. Returns the role's *live*
 * name so callers label it with whatever it's actually called in Discord.
 *
 * `create` only applies to the fallback path: if an ID is stored and that role no
 * longer exists, this returns null rather than silently minting a second role —
 * the admin should hear about it instead of ending up with two.
 */
export async function resolveTournamentRole(opts?: { create?: boolean }): Promise<TournamentRole | null> {
  const stored = await storedTournamentRoleId();
  const guildRoles = await getGuildRoles();

  if (stored) return guildRoles.find(r => r.id === stored) ?? null;

  const byName = guildRoles.find(r => r.name === TOURNAMENT_ROLE_NAME);
  if (byName) return byName;
  if (!opts?.create) return null;

  const id = (await ensureRoles([TOURNAMENT_ROLE_NAME]))[TOURNAMENT_ROLE_NAME];
  return id ? { id, name: TOURNAMENT_ROLE_NAME } : null;
}

/**
 * Every role ID that counts as "the tournament role" for teardown purposes — the
 * configured one *and* anything still named TOURNAMENT_ROLE_NAME. Setting an ID
 * after a 1v1 has already run would otherwise orphan the auto-created role on
 * everyone holding it, since nothing else ever strips it. Over-inclusion is free
 * here: removeRoleById no-ops on a role the member doesn't have.
 */
export async function tournamentRoleIdsToStrip(
  knownGuildRoles?: Array<{ id: string; name: string }>,
): Promise<string[]> {
  const guildRoles = knownGuildRoles ?? (await getGuildRoles());
  const stored = await storedTournamentRoleId();
  const ids = new Set<string>();
  if (stored && guildRoles.some(r => r.id === stored)) ids.add(stored);
  guildRoles.forEach(r => { if (r.name === TOURNAMENT_ROLE_NAME) ids.add(r.id); });
  return [...ids];
}

// teams.name is interpolated into Discord channel messages, so a display name
// carrying a mention would become a mass ping. updateTeamInfo guards the names
// players type; this guards the ones we derive for them. Its alphanumeric rule
// is deliberately not carried over — real Discord names have punctuation.
function safeTeamName(raw: string): string {
  return raw.replace(/@everyone|@here|<@/gi, "").trim().slice(0, 30);
}

/**
 * A 1v1 team is one player, so it has no identity of its own: the team name is
 * the player's name and the logo is their avatar. Call after any write that
 * changes who is on the team. No-op at 2v2/3v3.
 */
export async function syncSoloTeamIdentity(teamId: string, knownTeamSize?: number): Promise<void> {
  const teamSize = knownTeamSize ?? (await resolveTeamSize());
  if (teamSize !== 1) return;

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("discord_id")
    .eq("team_id", teamId)
    .limit(1)
    .maybeSingle();
  if (!player?.discord_id) return;

  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("discord_id, username, display_name, avatar")
    .eq("discord_id", player.discord_id)
    .maybeSingle();
  if (!account) return;

  const name = safeTeamName(account.display_name || account.username || "");
  if (!name) return;

  await supabaseAdmin
    .from("teams")
    .update({
      name,
      logo_url: avatarSrc(account.discord_id, account.avatar, 128),
      logo_offset_x: 50,
      logo_offset_y: 50,
    })
    .eq("id", teamId);
}
