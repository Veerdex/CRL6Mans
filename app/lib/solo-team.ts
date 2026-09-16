import { supabaseAdmin } from "@/app/lib/supabase";
import { avatarSrc } from "@/app/lib/avatar-url";
import { resolveTeamSize } from "@/app/lib/team-size";

// In a 1v1 tournament every participant would otherwise need their own Discord
// role, which means one role per player created and torn down per event. They
// all get this one instead — it says nothing more than "in the current event".
export const TOURNAMENT_ROLE_NAME = "Tournament";

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
