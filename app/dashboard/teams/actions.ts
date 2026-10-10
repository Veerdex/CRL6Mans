"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified, isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { editRole, addRole, addRoleById, removeRoleById, removeRole, ensureRoles } from "@/app/lib/discord-api";
import { validateImageUpload } from "@/app/lib/uploads";
import { applyPlayerRVChangeToTeamRating, execDisqualifyTeam } from "@/app/lib/discord-bot";
import { playerRatingFromRow } from "@/app/lib/rating";
import { resolveTeamSize } from "@/app/lib/team-size";
import { resolveTournamentRole, tournamentRoleIdsToStrip, syncSoloTeamIdentity } from "@/app/lib/solo-team";

async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get("session")?.value);
}

// A tournament_entries row (or draft_entered, for a season) is what the rest of
// the app reads as "in this event": it decides whether a team is listed at all
// (teams/page.tsx allowedTeamIds, layout-data.ts hasTeams), whether the 24h
// reminder reaches someone (pushToTournamentRoster), and whether a captain may
// request them as a sub (subs/actions.ts). A player can be put on a roster
// without ever having signed up, so enrolment has to follow them in or they end
// up rostered and invisible to all of it.
//
// in_active_draft is deliberately untouched: it means "inside the current
// draft's cutoff pool", and writing it would drop a mid-event addition into a
// live draft's pick list.
async function enrollInEvent(playerId: string) {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("active_tournament_id").single();
  const tournamentId = (settings?.active_tournament_id as string | null) ?? null;

  let isNewEntry: boolean;
  if (tournamentId) {
    const { error } = await supabaseAdmin
      .from("tournament_entries").insert({ tournament_id: tournamentId, player_id: playerId });
    if (error && !error.message.toLowerCase().includes("duplicate")) return { error: error.message };
    isNewEntry = !error;
  } else {
    const { data: p } = await supabaseAdmin
      .from("players").select("draft_entered").eq("id", playerId).single();
    isNewEntry = !p?.draft_entered;
  }

  // Both formation paths order the pool by draft_entered_at and cut the tail, so
  // a genuinely new entry has to be stamped now. A timestamp left over from an
  // earlier event would seat them ahead of people who signed up on time — and
  // send one of those the "yours came in after the last spot was taken" notice,
  // which would be false. Someone already entered keeps their real place.
  await supabaseAdmin
    .from("players")
    .update(isNewEntry
      ? { draft_entered: true, draft_entered_at: new Date().toISOString() }
      : { draft_entered: true })
    .eq("id", playerId);

  // Own statement: pre-migration this column doesn't exist, and folding it in
  // would take draft_entered down with it.
  await supabaseAdmin.from("players").update({ draft_not_selected_reason: null }).eq("id", playerId);
  return {};
}

// The window the admin asked for: sign-ups closed, event not yet over. While
// sign-ups are open there is nothing to fix — the player can enter themselves.
async function eventAcceptsLateEntries(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("active_tournament_id, draft_open, draft_active, season_active").single();
  const tournamentId = (settings?.active_tournament_id as string | null) ?? null;

  // Every teardown path runs resetSeason, which clears draft_entered for
  // everyone and also drops active_tournament_id — so a finished tournament
  // lands in this branch too, and a non-empty pool is what distinguishes "an
  // event is in flight" from "between events".
  if (!tournamentId) {
    if (settings?.draft_open)
      return { ok: false, error: "Draft sign-ups are still open — the player can enter from their dashboard." };
    if (settings?.draft_active || settings?.season_active) return { ok: true };
    const { count } = await supabaseAdmin
      .from("players").select("*", { count: "exact", head: true })
      .eq("status", "approved").eq("draft_entered", true);
    return (count ?? 0) > 0
      ? { ok: true }
      : { ok: false, error: "No event is in progress." };
  }

  const { data: t } = await supabaseAdmin
    .from("tournaments").select("status, signups_closed").eq("id", tournamentId).single();
  if (!t) return { ok: false, error: "Active tournament not found." };
  if (!t.signups_closed)
    return { ok: false, error: "Sign-ups are still open — the player can enter from their dashboard." };
  if (t.status !== "scheduled" && t.status !== "active")
    return { ok: false, error: "This tournament has already ended." };
  return { ok: true };
}

export async function addPlayerToEvent(playerId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };

  const window = await eventAcceptsLateEntries();
  if (!window.ok) return { error: window.error };

  const { data: player } = await supabaseAdmin
    .from("players").select("id, status").eq("id", playerId).single();
  if (player?.status !== "approved") return { error: "Only approved players can be added." };

  const result = await enrollInEvent(playerId);
  if (result.error) return { error: result.error };

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/subs");
  return { success: true };
}

export async function removePlayerFromEvent(playerId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };

  const window = await eventAcceptsLateEntries();
  if (!window.ok) return { error: window.error };

  const { data: player } = await supabaseAdmin
    .from("players").select("id, team_id").eq("id", playerId).single();
  // Dropping the entry row of a rostered player is how a team vanishes from the
  // Teams page — allowedTeamIds keeps a team only while someone on it is entered.
  if (player?.team_id) return { error: "Take them off their team first." };

  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("active_tournament_id").single();
  const tournamentId = (settings?.active_tournament_id as string | null) ?? null;
  if (tournamentId) {
    await supabaseAdmin.from("tournament_entries").delete()
      .eq("tournament_id", tournamentId).eq("player_id", playerId);
  }
  await supabaseAdmin.from("players").update({ draft_entered: false }).eq("id", playerId);

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/subs");
  return { success: true };
}

export async function updateTeamInfo(formData: FormData) {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const teamId = formData.get("teamId") as string;
  // A 1v1 "team" is a player: its name and logo are their name and avatar, and
  // are rewritten on every formation run, so there is nothing to customize.
  if ((await resolveTeamSize()) === 1)
    return { error: "Teams can't be customized in a 1v1 event." };

  const name = (formData.get("name") as string)?.trim();
  if (name && name.length > 30) return { error: "Team name must be 30 characters or fewer." };
  if (name && /@everyone|@here|<@/i.test(name)) return { error: "Team name cannot contain Discord mentions." };
  if (name && !/^[a-zA-Z0-9 ]+$/.test(name)) return { error: "Team name can only contain letters, numbers, and spaces." };
  const offsetX = Math.max(0, Math.min(100, parseInt(formData.get("offsetX") as string) || 50));
  const offsetY = Math.max(0, Math.min(100, parseInt(formData.get("offsetY") as string) || 50));
  const logoFile = formData.get("logo") as File | null;

  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("is_locked, discord_role_id")
    .eq("id", teamId)
    .single();

  const userIsAdmin = await isModeratorVerified(session.userId);
  if (team?.is_locked && !userIsAdmin) return { error: "Team info is locked by an admin." };

  if (!userIsAdmin) {
    const { data: player } = await supabaseAdmin
      .from("players")
      .select("team_id")
      .eq("discord_id", session.userId)
      .eq("status", "approved")
      .single();
    if (player?.team_id !== teamId) return { error: "You are not on this team." };
  }

  const updates: Record<string, unknown> = {
    logo_offset_x: offsetX,
    logo_offset_y: offsetY,
  };

  if (name) updates.name = name;

  if (logoFile && logoFile.size > 0) {
    const validated = await validateImageUpload(logoFile);
    if ("error" in validated) return { error: validated.error };

    const fileName = `${teamId}-${Date.now()}.${validated.ext}`;

    // Ensure the bucket exists; ignore "already exists" to handle race conditions
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    if (!buckets?.find((b) => b.name === "team-logos")) {
      const { error: bucketError } = await supabaseAdmin.storage.createBucket("team-logos", { public: true });
      if (bucketError && !bucketError.message.toLowerCase().includes("already exists")) {
        return { error: "Could not initialize storage. Please try again." };
      }
    }

    const { error: uploadError } = await supabaseAdmin.storage
      .from("team-logos")
      .upload(fileName, validated.bytes, { contentType: validated.contentType, upsert: true });

    if (uploadError) return { error: "Logo upload failed. Please try again." };

    const { data: urlData } = supabaseAdmin.storage.from("team-logos").getPublicUrl(fileName);
    updates.logo_url = urlData.publicUrl;
  }

  const { error } = await supabaseAdmin.from("teams").update(updates).eq("id", teamId);
  if (error) return { error: "Failed to save changes. Please try again." };

  if (name && team?.discord_role_id) {
    await editRole(team.discord_role_id, { name });
  }

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

async function assignCaptainIfMissing(teamId: string): Promise<void> {
  const { data: members } = await supabaseAdmin
    .from("players")
    .select("id, discord_id, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1, is_captain")
    .eq("team_id", teamId);

  // A roster below full size isn't a team yet, so it has no captain.
  if (!members?.length || members.length < (await resolveTeamSize())) return;
  if (members.some((m) => m.is_captain)) return;

  const ratingOf = playerRatingFromRow;
  const best = members.reduce((a, b) => (ratingOf(a) >= ratingOf(b) ? a : b));

  await supabaseAdmin.from("players").update({ is_captain: true }).eq("id", best.id);
  if (best.discord_id) addRole(best.discord_id, "Captain").catch(() => {});
}

type PlayerRow = {
  id: string;
  discord_id: string | null;
  team_id: string | null;
  is_captain: boolean | null;
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string;
  peak_1v1: string | null;
  current_1v1: string | null;
};

const PLAYER_RV_SELECT = "id, discord_id, team_id, is_captain, peak_2v2, current_2v2, peak_3v3, current_3v3, peak_1v1, current_1v1";

export async function swapPlayersBetweenTeams(playerAId: string, playerBId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };
  if (playerAId === playerBId) return { error: "Cannot swap a player with themself." };

  const [{ data: playerA }, { data: playerB }] = await Promise.all([
    supabaseAdmin.from("players").select(PLAYER_RV_SELECT).eq("id", playerAId).single(),
    supabaseAdmin.from("players").select(PLAYER_RV_SELECT).eq("id", playerBId).single(),
  ]);
  if (!playerA?.team_id || !playerB?.team_id) return { error: "Both players must be on a team to swap." };
  if (playerA.team_id === playerB.team_id) return { error: "Players are already on the same team." };

  const a = playerA as PlayerRow;
  const b = playerB as PlayerRow;
  const teamAId = a.team_id as string;
  const teamBId = b.team_id as string;
  const rvFields = (p: PlayerRow) => ({
    peak_2v2: p.peak_2v2, current_2v2: p.current_2v2, peak_3v3: p.peak_3v3, current_3v3: p.current_3v3,
    peak_1v1: p.peak_1v1, current_1v1: p.current_1v1,
  });

  await Promise.all([
    applyPlayerRVChangeToTeamRating(a.id, teamAId, rvFields(a), rvFields(b)).catch(() => {}),
    applyPlayerRVChangeToTeamRating(b.id, teamBId, rvFields(b), rvFields(a)).catch(() => {}),
  ]);

  const [{ error: errA }, { error: errB }] = await Promise.all([
    supabaseAdmin.from("players").update({ team_id: teamBId, is_captain: false }).eq("id", a.id),
    supabaseAdmin.from("players").update({ team_id: teamAId, is_captain: false }).eq("id", b.id),
  ]);
  if (errA || errB) return { error: "Failed to swap players. Please try again." };

  const [{ data: teamA }, { data: teamB }] = await Promise.all([
    supabaseAdmin.from("teams").select("discord_role_id").eq("id", teamAId).single(),
    supabaseAdmin.from("teams").select("discord_role_id").eq("id", teamBId).single(),
  ]);

  // Both players stay in the event, so the shared tournament role is untouched
  // either way. At 1v1 there is no per-team role either, leaving only the teams'
  // derived identities to follow them.
  const teamSize = await resolveTeamSize();

  if (a.discord_id) {
    if (teamSize > 1 && teamA?.discord_role_id) removeRoleById(a.discord_id, teamA.discord_role_id).catch(() => {});
    if (a.is_captain) removeRole(a.discord_id, "Captain").catch(() => {});
    if (teamSize > 1 && teamB?.discord_role_id) addRoleById(a.discord_id, teamB.discord_role_id).catch(() => {});
  }
  if (b.discord_id) {
    if (teamSize > 1 && teamB?.discord_role_id) removeRoleById(b.discord_id, teamB.discord_role_id).catch(() => {});
    if (b.is_captain) removeRole(b.discord_id, "Captain").catch(() => {});
    if (teamSize > 1 && teamA?.discord_role_id) addRoleById(b.discord_id, teamA.discord_role_id).catch(() => {});
  }

  await Promise.all([
    syncSoloTeamIdentity(teamAId, teamSize),
    syncSoloTeamIdentity(teamBId, teamSize),
  ]);

  await Promise.all([assignCaptainIfMissing(teamAId), assignCaptainIfMissing(teamBId)]);

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

export async function swapRosterPlayerWithBenchPlayer(rosterPlayerId: string, benchPlayerId: string, teamId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };
  if (rosterPlayerId === benchPlayerId) return { error: "Cannot swap a player with themself." };

  const [{ data: rosterPlayer }, { data: benchPlayer }] = await Promise.all([
    supabaseAdmin.from("players").select(PLAYER_RV_SELECT).eq("id", rosterPlayerId).single(),
    supabaseAdmin.from("players").select(PLAYER_RV_SELECT).eq("id", benchPlayerId).single(),
  ]);
  if (rosterPlayer?.team_id !== teamId) return { error: "Player is not on this team." };
  if (benchPlayer?.team_id !== null) return { error: "That player is already on a team." };

  const roster = rosterPlayer as PlayerRow;
  const bench = benchPlayer as PlayerRow;
  const rvFields = (p: PlayerRow) => ({
    peak_2v2: p.peak_2v2, current_2v2: p.current_2v2, peak_3v3: p.peak_3v3, current_3v3: p.current_3v3,
    peak_1v1: p.peak_1v1, current_1v1: p.current_1v1,
  });

  await applyPlayerRVChangeToTeamRating(roster.id, teamId, rvFields(roster), rvFields(bench)).catch(() => {});

  const [{ error: errOut }, { error: errIn }] = await Promise.all([
    supabaseAdmin.from("players").update({ team_id: null, is_captain: false }).eq("id", roster.id),
    supabaseAdmin.from("players").update({ team_id: teamId, is_captain: false }).eq("id", bench.id),
  ]);
  if (errOut || errIn) return { error: "Failed to swap players. Please try again." };

  const { data: team } = await supabaseAdmin.from("teams").select("discord_role_id").eq("id", teamId).single();

  // This one really does move somebody out of the event and somebody in, so the
  // shared tournament role has to follow them at every team size.
  const teamSize = await resolveTeamSize();
  const tournamentStripIds = roster.discord_id ? await tournamentRoleIdsToStrip() : [];
  const tournamentRole = bench.discord_id
    ? await resolveTournamentRole({ create: true })
    : null;

  if (roster.discord_id) {
    const out = roster.discord_id;
    if (teamSize > 1 && team?.discord_role_id) removeRoleById(out, team.discord_role_id).catch(() => {});
    if (roster.is_captain) removeRole(out, "Captain").catch(() => {});
    tournamentStripIds.forEach(id => removeRoleById(out, id).catch(() => {}));
  }
  if (bench.discord_id) {
    if (teamSize > 1 && team?.discord_role_id) addRoleById(bench.discord_id, team.discord_role_id).catch(() => {});
    if (tournamentRole) addRoleById(bench.discord_id, tournamentRole.id).catch(() => {});
  }

  await syncSoloTeamIdentity(teamId, teamSize);

  await assignCaptainIfMissing(teamId);

  // After the roster writes, never before: a swap that failed halfway shouldn't
  // leave someone enrolled in an event they aren't playing in. The player going
  // the other way keeps their entry — they signed up, they just lost the slot.
  await enrollInEvent(bench.id);

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

export async function disqualifyTeam(teamId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };

  const result = await execDisqualifyTeam(teamId);
  if (!result.ok) return { error: result.message };

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/season");
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}

// Same blue the admin panel paints team roles (league-actions.ts), so a slot
// minted from here is indistinguishable from one added there.
const TEAM_ROLE_COLOR = 0x3498db;

type ClaimedSlot = { id: string; num: number; roleId: string | null };

/**
 * A team is a pre-created numbered slot the formation paths map players onto —
 * execStartDraft refuses to run when there are fewer slots than teams rather
 * than inventing any. So this claims a free one first and only mints when there
 * is none, which keeps the slot numbering the draft and bracket read off
 * contiguous.
 *
 * "Free" means no roster and no match history: a disqualified team whose players
 * were pulled off still holds a bracket position, and handing that to a brand
 * new team would have it inherit the results.
 */
async function claimTeamSlot(actorDiscordId: string): Promise<ClaimedSlot | { error: string }> {
  const [{ data: slots }, { data: rostered }, { data: matches }] = await Promise.all([
    supabaseAdmin
      .from("teams").select("id, name, discord_role_id, slot_number")
      .not("slot_number", "is", null).order("slot_number"),
    supabaseAdmin.from("players").select("team_id").not("team_id", "is", null),
    supabaseAdmin.from("matches").select("home_team_id, away_team_id"),
  ]);

  const taken = new Set<string>();
  (rostered ?? []).forEach((p) => { if (p.team_id) taken.add(p.team_id as string); });
  (matches ?? []).forEach((m) => {
    if (m.home_team_id) taken.add(m.home_team_id as string);
    if (m.away_team_id) taken.add(m.away_team_id as string);
  });

  const numbered = (slots ?? [])
    .filter((t): t is typeof t & { slot_number: number } => typeof t.slot_number === "number")
    .sort((a, b) => a.slot_number - b.slot_number);
  const free = numbered.find((t) => !taken.has(t.id));

  if (free) {
    const canonicalName = `Team ${free.slot_number}`;
    // The same reset the formation paths apply when they reuse a slot, plus the
    // ratings resetSeason clears: whoever held this slot last may have renamed
    // it, uploaded a logo and banked a season rating, none of which belongs to
    // the roster about to move in.
    await supabaseAdmin
      .from("teams")
      .update({
        name: canonicalName, logo_url: null, logo_offset_x: 50, logo_offset_y: 50,
        wins: 0, losses: 0, is_locked: false, season_rating: null, initial_rating: null,
        is_disqualified: false, disqualified_at: null,
      })
      .eq("id", free.id);

    if (free.discord_role_id && free.name !== canonicalName) {
      editRole(free.discord_role_id, { name: canonicalName, color: TEAM_ROLE_COLOR }).catch(() => {});
    }
    return { id: free.id, num: free.slot_number, roleId: free.discord_role_id };
  }

  // Minting a slot is addTeamSlot's job in the admin panel, which is gated on
  // director. Letting a moderator reach it from here would route around that.
  if (!(await isDirectorVerified(actorDiscordId)))
    return { error: `All ${numbered.length} team slots are in use — a director can add another in Admin → Team Slots.` };

  const num = numbered.length ? numbered[numbered.length - 1].slot_number + 1 : 1;
  const name = `Team ${num}`;
  const roles = await ensureRoles([name]).catch(() => ({} as Record<string, string>));
  let roleId: string | null = roles[name] ?? null;
  if (roleId) {
    // A role named Team N can be left over from a deleted slot. Reusing it is
    // right; stealing one another team row still points at is not.
    const { data: holder } = await supabaseAdmin
      .from("teams").select("id").eq("discord_role_id", roleId).maybeSingle();
    if (holder) roleId = null;
    else editRole(roleId, { name, color: TEAM_ROLE_COLOR }).catch(() => {});
  }

  const { data: minted, error } = await supabaseAdmin
    .from("teams")
    .insert({ name, discord_role_id: roleId, is_locked: false, slot_number: num })
    .select("id")
    .single();
  if (error || !minted) return { error: error?.message ?? "Failed to create the team slot." };
  return { id: minted.id as string, num, roleId };
}

export async function createTeam(playerIds: string[]) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };

  const ids = [...new Set(playerIds)];
  const teamSize = await resolveTeamSize();
  if (ids.length !== teamSize)
    return { error: `Pick exactly ${teamSize} player${teamSize === 1 ? "" : "s"}.` };

  // Captains are seated by slot number before pick 0 and getTeamNumberForPick is
  // fixed snake math off the team count — a slot appearing mid-draft would move
  // the picks already made onto different teams.
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("draft_active").single();
  if (settings?.draft_active) return { error: "Finish or end the draft before adding a team." };

  const slot = await claimTeamSlot(session.userId);
  if ("error" in slot) return { error: slot.error };

  // Conditioned on team_id being null rather than read-then-write: two admins
  // picking the same bench player would otherwise both "succeed" and the second
  // would quietly move them off the first's team.
  const { data: claimed } = await supabaseAdmin
    .from("players")
    .update({ team_id: slot.id, is_captain: false, updated_at: new Date().toISOString() })
    .in("id", ids)
    .is("team_id", null)
    .eq("status", "approved")
    .select("id, discord_id");

  if ((claimed?.length ?? 0) !== ids.length) {
    if (claimed?.length)
      await supabaseAdmin.from("players").update({ team_id: null, is_captain: false }).in("id", claimed.map((p) => p.id));
    return { error: "One of those players is no longer available. Refresh and try again." };
  }

  const tournamentRole = await resolveTournamentRole({ create: true });
  for (const p of claimed ?? []) {
    if (!p.discord_id) continue;
    if (teamSize > 1 && slot.roleId) addRoleById(p.discord_id, slot.roleId).catch(() => {});
    if (tournamentRole) addRoleById(p.discord_id, tournamentRole.id).catch(() => {});
  }

  await syncSoloTeamIdentity(slot.id, teamSize);
  await assignCaptainIfMissing(slot.id);

  // Last, same as the bench swap: a roster write that failed shouldn't leave
  // anyone enrolled in an event they aren't playing in. Without this the team is
  // created and then filtered straight back out — allowedTeamIds in page.tsx
  // keeps a team only while someone on it has an entry row.
  for (const id of ids) await enrollInEvent(id);

  // num_teams is what the later stage builders size their brackets off, and
  // between events it is 0. Realigning it to the rostered-team count is only
  // safe while no bracket exists — once one does, the admin has to regenerate it
  // for the new team to get a seed anyway.
  const { count: bracketMatches } = await supabaseAdmin
    .from("matches").select("*", { count: "exact", head: true }).not("stage", "is", null);
  if (!bracketMatches) {
    const { data: rosters } = await supabaseAdmin.from("players").select("team_id").not("team_id", "is", null);
    const rosteredTeams = new Set((rosters ?? []).map((r) => r.team_id as string)).size;
    await supabaseAdmin.from("league_settings")
      .update({ num_teams: rosteredTeams, updated_at: new Date().toISOString() }).not("id", "is", null);
  }

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/subs");
  revalidatePath("/dashboard/season");
  revalidatePath("/dashboard/admin");
  return {
    success: true,
    message: bracketMatches
      ? `Team ${slot.num} created. Regenerate the bracket to give it a seed.`
      : `Team ${slot.num} created.`,
  };
}

export async function toggleTeamLock(teamId: string) {
  const session = await getSession();
  if (!session?.userId || !(await isModeratorVerified(session.userId))) return { error: "Not authorized." };

  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("is_locked")
    .eq("id", teamId)
    .single();

  await supabaseAdmin
    .from("teams")
    .update({ is_locked: !team?.is_locked })
    .eq("id", teamId);

  revalidatePath("/dashboard/teams");
  revalidatePath("/dashboard/my-team");
  return { success: true };
}
