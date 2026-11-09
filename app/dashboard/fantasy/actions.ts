"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { recordNotification } from "@/app/lib/notifications";
import {
  accountName,
  fantasyAccessOpen,
  fantasyOpenToAll,
  getCurrentFantasySeason,
  getFantasyViewer,
  getLeague,
  getManagerCap,
  isActiveManager,
  orphanedManagers,
  ownsLeague,
  type LeagueRow,
} from "@/app/lib/fantasy-leagues";
import { dropBeforeDraft, orphanTeam } from "@/app/lib/fantasy-departure-server";
import { isClosedLeague, normalizeLeagueName } from "@/app/lib/fantasy-rules";
import { getStaffRole, isDirectorVerified } from "@/app/lib/players";
import { autopickIfDue, startFantasyDrafts, submitPick } from "@/app/lib/fantasy-draft-server";
import { openFantasySeason } from "@/app/lib/fantasy-season-end";
import { moveLineupPlayer } from "@/app/lib/fantasy-lineup-server";
import { addFreeAgent, cancelClaim, fileClaim, rankClaims } from "@/app/lib/fantasy-waivers-server";
import {
  acceptTrade,
  cancelTrade,
  dismissTrade,
  proposeTrade,
  rejectTrade,
  setFantasyTradesEnabledCore,
  voteOnTrade,
} from "@/app/lib/fantasy-trades-server";

type Result = { error?: string };

// Every export here is a callable endpoint, so each one re-derives who is
// calling and what they may do rather than trusting what the page drew.

async function requireManager(): Promise<{ accountId: string; discordId: string } | { error: string }> {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) return { error: "You need to be signed in." };
  const viewer = await getFantasyViewer(session.userId);
  if (!(await fantasyAccessOpen(viewer))) return { error: "Fantasy isn't open yet." };
  if (!viewer.approved || !viewer.accountId) return { error: "Only approved players can manage a fantasy team." };
  return { accountId: viewer.accountId, discordId: viewer.discordId };
}

async function requirePreDraftLeague(leagueId: string): Promise<LeagueRow | { error: string }> {
  const league = await getLeague(leagueId);
  if (!league) return { error: "That league doesn't exist." };
  if (league.status !== "pre_draft") return { error: "The draft has started, so this can't be changed any more." };
  return league;
}

// A manager whose team is orphaned (§11) has left, so they count as gone.
const isMember = isActiveManager;

function refresh(leagueId?: string) {
  revalidatePath("/dashboard/fantasy");
  if (leagueId) revalidatePath(`/dashboard/fantasy/${leagueId}`);
}

export async function createLeague(rawName: string, visibility: "public" | "private"): Promise<Result & { leagueId?: string }> {
  const me = await requireManager();
  if ("error" in me) return me;
  const name = normalizeLeagueName(rawName);
  if (typeof name !== "string") return name;
  if (visibility !== "public" && visibility !== "private") return { error: "Pick public or private." };

  const season = await getCurrentFantasySeason();
  if (!season || season.status !== "open") return { error: "Leagues can't be created right now." };
  // The one-league rule is on owning, not creating: a creator who left passed
  // their league on, and someone who inherited one has a league to run.
  if (await ownsLeague(season.id, me.accountId)) return { error: "You already own a league this season." };

  const { data: league, error } = await supabaseAdmin
    .from("fantasy_leagues")
    .insert({
      fantasy_season_id: season.id,
      name,
      visibility,
      created_by: me.accountId,
      commissioner_id: me.accountId,
    })
    .select("id")
    .single();
  if (error || !league) return { error: "Couldn't create the league." };

  const { error: memberError } = await supabaseAdmin
    .from("fantasy_league_members")
    .insert({ league_id: league.id, account_id: me.accountId });
  if (memberError) {
    await supabaseAdmin.from("fantasy_leagues").delete().eq("id", league.id);
    return { error: "Couldn't create the league." };
  }

  refresh();
  return { leagueId: league.id as string };
}

export async function joinLeague(leagueId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const league = await requirePreDraftLeague(leagueId);
  if ("error" in league) return league;

  const [{ data: invite }, { data: removal }] = await Promise.all([
    supabaseAdmin.from("fantasy_league_invites").select("account_id").eq("league_id", leagueId).eq("account_id", me.accountId).maybeSingle(),
    supabaseAdmin.from("fantasy_league_removals").select("account_id").eq("league_id", leagueId).eq("account_id", me.accountId).maybeSingle(),
  ]);
  if (league.visibility === "private" && !invite) return { error: "This league is invite only." };
  if (removal && !invite) return { error: "The owner removed you from this league." };

  const { data: outcome, error } = await supabaseAdmin.rpc("fantasy_join_league", {
    p_league: leagueId,
    p_account: me.accountId,
    p_cap: await getManagerCap(),
  });
  if (error) return { error: "Couldn't join the league." };
  if (outcome === "full") return { error: "This league is full." };
  if (outcome === "closed") return { error: "This league is no longer taking managers." };

  refresh(leagueId);
  return {};
}

export async function leaveLeague(leagueId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const current = await getLeague(leagueId);
  if (!current) return { error: "That league doesn't exist." };
  if (!(await isMember(leagueId, me.accountId))) return { error: "You're not in this league." };
  if (current.status === "drafting") return { error: "You can't leave while the draft is running." };
  // §11: after the draft the team stays in the league without a manager.
  if (current.status === "active") {
    const res = await orphanTeam(current, me.accountId, "left");
    if (res.error) return res;
    refresh(leagueId);
    return {};
  }
  const league = await requirePreDraftLeague(leagueId);
  if ("error" in league) return league;

  // An owner passes the league on rather than disbanding it.
  const res = await dropBeforeDraft(league, me.accountId, "left");
  if (res.error) return res;
  refresh(leagueId);
  return {};
}

async function requireCommissioner(leagueId: string, preDraft: boolean) {
  const me = await requireManager();
  if ("error" in me) return me;
  const league = preDraft ? await requirePreDraftLeague(leagueId) : await getLeague(leagueId);
  if (!league) return { error: "That league doesn't exist." };
  if ("error" in league) return league;
  if (league.commissioner_id !== me.accountId) return { error: "Only the league owner can do that." };
  // An owner who left after the draft stays on record but can't run the
  // league (§11). Before the draft nobody is ever orphaned.
  if (league.status !== "pre_draft" && !(await isMember(leagueId, me.accountId))) return { error: "You've left this league." };
  return { me, league };
}

export async function renameLeague(leagueId: string, rawName: string): Promise<Result> {
  const ctx = await requireCommissioner(leagueId, false);
  if ("error" in ctx) return ctx;
  if (isClosedLeague(ctx.league.status)) return { error: "This league is closed." };
  const name = normalizeLeagueName(rawName);
  if (typeof name !== "string") return name;
  await supabaseAdmin.from("fantasy_leagues").update({ name }).eq("id", leagueId);
  refresh(leagueId);
  return {};
}

export async function setLeagueVisibility(leagueId: string, visibility: "public" | "private"): Promise<Result> {
  const ctx = await requireCommissioner(leagueId, false);
  if ("error" in ctx) return ctx;
  if (isClosedLeague(ctx.league.status)) return { error: "This league is closed." };
  if (visibility !== "public" && visibility !== "private") return { error: "Pick public or private." };
  await supabaseAdmin.from("fantasy_leagues").update({ visibility }).eq("id", leagueId);
  refresh(leagueId);
  return {};
}

export async function removeManager(leagueId: string, accountId: string): Promise<Result> {
  const ctx = await requireCommissioner(leagueId, false);
  if ("error" in ctx) return ctx;
  if (accountId === ctx.me.accountId) return { error: "Use Leave league to leave your own league." };
  if (!(await isMember(leagueId, accountId))) return { error: "That player isn't in this league." };
  const { league } = ctx;
  if (league.status === "drafting") return { error: "Managers can't be removed while the draft is running." };
  if (league.status === "active") {
    // §11: the team stays, without the manager, until the owner hands it over.
    const res = await orphanTeam(league, accountId, "removed", ctx.me.accountId);
    if (res.error) return res;
  } else if (league.status === "pre_draft") {
    const res = await dropBeforeDraft(league, accountId, "removed", ctx.me.accountId);
    if (res.error) return res;
  } else {
    return { error: "This league is closed." };
  }
  await supabaseAdmin.from("fantasy_league_removals").upsert({ league_id: leagueId, account_id: accountId });
  refresh(leagueId);
  return {};
}

export async function invitePlayer(leagueId: string, accountId: string): Promise<Result> {
  const ctx = await requireCommissioner(leagueId, true);
  if ("error" in ctx) return ctx;
  if (ctx.league.visibility !== "private") return { error: "Public leagues don't take invites. Anyone can join." };

  const { data: target } = await supabaseAdmin
    .from("accounts")
    .select("id, discord_id, status")
    .eq("id", accountId)
    .maybeSingle();
  if (!target || target.status !== "approved") return { error: "Only approved players can be invited." };
  // While the feature is staff-only, an invite would land in a player's feed and
  // link to a page they can't open.
  if (!(await fantasyOpenToAll()) && (await getStaffRole(target.discord_id as string)) === null) {
    return { error: "Until fantasy opens to everyone, only staff can be invited." };
  }
  if (await isMember(leagueId, accountId)) return { error: "That player is already in this league." };

  const { error } = await supabaseAdmin
    .from("fantasy_league_invites")
    .upsert({ league_id: leagueId, account_id: accountId, invited_by: ctx.me.accountId });
  if (error) return { error: "Couldn't send the invite." };
  // An invite is the commissioner taking them back, so it lifts a removal.
  await supabaseAdmin.from("fantasy_league_removals").delete().eq("league_id", leagueId).eq("account_id", accountId);

  const { data: inviter } = await supabaseAdmin
    .from("accounts")
    .select("username, display_name")
    .eq("id", ctx.me.accountId)
    .maybeSingle();
  await recordNotification(
    { kind: "users", discordIds: [target.discord_id as string] },
    {
      title: "Fantasy league invite",
      body: `${accountName(inviter)} invited you to join ${ctx.league.name}.`,
      url: `/dashboard/fantasy/${leagueId}`,
    },
  );

  refresh(leagueId);
  return {};
}

export async function cancelInvite(leagueId: string, accountId: string): Promise<Result> {
  const ctx = await requireCommissioner(leagueId, false);
  if ("error" in ctx) return ctx;
  // After the draft the only invites left worth withdrawing are team offers.
  if (ctx.league.status !== "pre_draft" && ctx.league.status !== "active") return { error: "This can't be changed right now." };
  await supabaseAdmin.from("fantasy_league_invites").delete().eq("league_id", leagueId).eq("account_id", accountId);
  refresh(leagueId);
  return {};
}

/** §11: the owner offers an orphaned team to a player outside the league. */
export async function offerTeam(leagueId: string, teamId: string, accountId: string): Promise<Result> {
  const ctx = await requireCommissioner(leagueId, false);
  if ("error" in ctx) return ctx;
  if (ctx.league.status !== "active") return { error: "A team can be handed over once the draft is finished." };
  if (!(await orphanedManagers(leagueId)).has(teamId)) return { error: "That team already has a manager." };

  const { data: target } = await supabaseAdmin
    .from("accounts")
    .select("id, discord_id, status")
    .eq("id", accountId)
    .maybeSingle();
  if (!target || target.status !== "approved") return { error: "Only approved players can take over a team." };
  if (!(await fantasyOpenToAll()) && (await getStaffRole(target.discord_id as string)) === null) {
    return { error: "Until fantasy opens to everyone, only staff can take over a team." };
  }
  const [{ data: member }, { data: rostered }] = await Promise.all([
    supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", leagueId).eq("account_id", accountId).maybeSingle(),
    supabaseAdmin.from("fantasy_roster_slots").select("player_id").eq("league_id", leagueId).eq("player_id", accountId).maybeSingle(),
  ]);
  if (member) return { error: "That player is already in this league." };
  if (rostered) return { error: "That player is on a roster in this league, so they can't manage in it." };

  const { error } = await supabaseAdmin
    .from("fantasy_league_invites")
    .upsert({ league_id: leagueId, account_id: accountId, invited_by: ctx.me.accountId, takeover_of: teamId });
  if (error) return { error: "Couldn't send the offer. Has scripts/fantasy-manager-departure-migration.sql been run?" };
  await supabaseAdmin.from("fantasy_league_removals").delete().eq("league_id", leagueId).eq("account_id", accountId);

  const { data: names } = await supabaseAdmin
    .from("accounts")
    .select("id, username, display_name")
    .in("id", [ctx.me.accountId, teamId]);
  const nameOf = (id: string) => accountName(((names ?? []) as { id: string; username: string | null; display_name: string | null }[]).find((n) => n.id === id));
  await recordNotification(
    { kind: "users", discordIds: [target.discord_id as string] },
    {
      title: "Fantasy team offered",
      body: `${nameOf(ctx.me.accountId)} offered you ${nameOf(teamId)}'s old team in ${ctx.league.name}.`,
      url: `/dashboard/fantasy/${leagueId}`,
    },
  );
  refresh(leagueId);
  return {};
}

export async function acceptTakeover(leagueId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const { data: invite } = await supabaseAdmin
    .from("fantasy_league_invites")
    .select("takeover_of")
    .eq("league_id", leagueId)
    .eq("account_id", me.accountId)
    .maybeSingle();
  const teamId = (invite?.takeover_of as string | null | undefined) ?? null;
  if (!teamId) return { error: "That offer has been withdrawn." };

  const { data: outcome, error } = await supabaseAdmin.rpc("fantasy_hand_over_team", {
    p_league: leagueId,
    p_from: teamId,
    p_to: me.accountId,
  });
  if (error) return { error: "Couldn't take over the team." };
  if (outcome === "closed") return { error: "This league isn't taking new managers right now." };
  if (outcome === "taken") return { error: "Someone else has already taken over that team." };
  if (outcome === "no_invite") return { error: "That offer has been withdrawn." };
  if (outcome === "member") return { error: "You're already in this league." };
  if (outcome === "rostered") return { error: "You're on a roster in this league, so you can't manage in it." };

  revalidatePath("/dashboard/fantasy");
  revalidatePath(`/dashboard/fantasy/${leagueId}`, "layout");
  return {};
}

/** §11: until someone takes over, the owner keeps an orphaned team's lineup. */
export async function moveOrphanLineupSlot(leagueId: string, teamId: string, from: string, to: string): Promise<Result> {
  const ctx = await requireCommissioner(leagueId, false);
  if ("error" in ctx) return ctx;
  if (!(await orphanedManagers(leagueId)).has(teamId)) return { error: "That team has a manager, so only they can set its lineup." };
  const res = await moveLineupPlayer(leagueId, teamId, from, to);
  if (res.error) return res;
  revalidatePath(`/dashboard/fantasy/${leagueId}/roster`);
  return {};
}

export async function declineInvite(leagueId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  await supabaseAdmin.from("fantasy_league_invites").delete().eq("league_id", leagueId).eq("account_id", me.accountId);
  refresh(leagueId);
  return {};
}

export type InviteCandidate = { accountId: string; name: string; username: string | null; discordId: string; avatar: string | null };

export async function searchInvitablePlayers(leagueId: string, query: string): Promise<{ results: InviteCandidate[]; error?: string }> {
  const ctx = await requireCommissioner(leagueId, true);
  if ("error" in ctx) return { results: [], error: ctx.error };
  if (ctx.league.visibility !== "private") return { results: [], error: "Public leagues don't take invites. Anyone can join." };
  return { results: await searchOutsiders(leagueId, query, false) };
}

export async function searchTakeoverCandidates(leagueId: string, query: string): Promise<{ results: InviteCandidate[]; error?: string }> {
  const ctx = await requireCommissioner(leagueId, false);
  if ("error" in ctx) return { results: [], error: ctx.error };
  if (ctx.league.status !== "active") return { results: [], error: "A team can be handed over once the draft is finished." };
  return { results: await searchOutsiders(leagueId, query, true) };
}

// Approved players not in the league and not already invited to it. A team's
// new manager also can't be one of the league's rostered players.
async function searchOutsiders(leagueId: string, query: string, excludeRostered: boolean): Promise<InviteCandidate[]> {
  // Stripped to characters a name can hold: the term is spliced into a
  // PostgREST or() filter, where a comma or parenthesis would change its meaning.
  const term = query.replace(/[^\p{L}\p{N} ._-]/gu, "").trim();
  if (term.length < 2) return [];

  const [{ data: accounts }, { data: members }, { data: invites }, { data: rostered }] = await Promise.all([
    supabaseAdmin
      .from("accounts")
      .select("id, discord_id, username, display_name, avatar")
      .eq("status", "approved")
      .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
      .limit(20),
    supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", leagueId),
    supabaseAdmin.from("fantasy_league_invites").select("account_id").eq("league_id", leagueId),
    excludeRostered
      ? supabaseAdmin.from("fantasy_roster_slots").select("player_id").eq("league_id", leagueId)
      : Promise.resolve({ data: [] }),
  ]);
  const taken = new Set([
    ...[...(members ?? []), ...(invites ?? [])].map((r) => r.account_id as string),
    ...((rostered ?? []) as { player_id: string }[]).map((r) => r.player_id),
  ]);
  let rows = ((accounts ?? []) as { id: string; discord_id: string; username: string | null; display_name: string | null; avatar: string | null }[])
    .filter((a) => !taken.has(a.id));
  if (!(await fantasyOpenToAll())) {
    const roles = await Promise.all(rows.map((a) => getStaffRole(a.discord_id)));
    rows = rows.filter((_, i) => roles[i] !== null);
  }

  return rows
    .slice(0, 8)
    .map((a) => ({ accountId: a.id, name: accountName(a), username: a.username, discordId: a.discord_id, avatar: a.avatar }));
}

function refreshDraft(leagueId: string) {
  revalidatePath("/dashboard/fantasy");
  revalidatePath(`/dashboard/fantasy/${leagueId}`, "layout");
}

export async function makeFantasyPick(leagueId: string, playerId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  if (!(await isMember(leagueId, me.accountId))) return { error: "You aren't a manager in this league." };
  const res = await submitPick({ leagueId, managerId: me.accountId, playerId, auto: false });
  if (res.error) return { error: res.error };
  refreshDraft(leagueId);
  return {};
}

export async function moveLineupSlot(leagueId: string, from: string, to: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  if (!(await isMember(leagueId, me.accountId))) return { error: "You aren't a manager in this league." };
  const res = await moveLineupPlayer(leagueId, me.accountId, from, to);
  if (res.error) return res;
  revalidatePath(`/dashboard/fantasy/${leagueId}/roster`);
  return {};
}

function refreshRosterMove(leagueId: string) {
  for (const tab of ["roster", "players", "matchup"]) revalidatePath(`/dashboard/fantasy/${leagueId}/${tab}`);
}

export async function addFantasyFreeAgent(leagueId: string, addId: string, dropId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const res = await addFreeAgent(leagueId, me.accountId, addId, dropId);
  if (res.error) return res;
  refreshRosterMove(leagueId);
  return {};
}

export async function claimFantasyPlayer(leagueId: string, playerId: string, dropId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const res = await fileClaim(leagueId, me.accountId, playerId, dropId);
  if (res.error) return res;
  refreshRosterMove(leagueId);
  return {};
}

export async function cancelFantasyClaim(leagueId: string, claimId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const res = await cancelClaim(leagueId, me.accountId, claimId);
  if (res.error) return res;
  refreshRosterMove(leagueId);
  return {};
}

export async function rankFantasyClaims(leagueId: string, claimIds: string[]): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const res = await rankClaims(leagueId, me.accountId, claimIds);
  if (res.error) return res;
  revalidatePath(`/dashboard/fantasy/${leagueId}/roster`);
  return {};
}

export async function proposeFantasyTrade(leagueId: string, receiverId: string, giveIds: string[], getIds: string[]): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  if (!Array.isArray(giveIds) || !Array.isArray(getIds)) return { error: "Pick the players to trade." };
  const res = await proposeTrade(leagueId, me.accountId, receiverId, giveIds, getIds);
  if (res.error) return res;
  revalidatePath(`/dashboard/fantasy/${leagueId}/players`);
  return {};
}

export async function acceptFantasyTrade(leagueId: string, tradeId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const res = await acceptTrade(leagueId, me.accountId, tradeId);
  if (res.error) {
    revalidatePath(`/dashboard/fantasy/${leagueId}/players`);
    return res;
  }
  refreshRosterMove(leagueId);
  return {};
}

export async function voteOnFantasyTrade(leagueId: string, tradeId: string, vote: "accept" | "reject"): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  if (vote !== "accept" && vote !== "reject") return { error: "Pick accept or reject." };
  const res = await voteOnTrade(leagueId, me.accountId, tradeId, vote);
  // A deciding vote may have moved players, so every roster view refreshes.
  refreshRosterMove(leagueId);
  return res;
}

export async function rejectFantasyTrade(leagueId: string, tradeId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const res = await rejectTrade(leagueId, me.accountId, tradeId);
  if (res.error) return res;
  revalidatePath(`/dashboard/fantasy/${leagueId}/players`);
  return {};
}

export async function cancelFantasyTrade(leagueId: string, tradeId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const res = await cancelTrade(leagueId, me.accountId, tradeId);
  if (res.error) return res;
  revalidatePath(`/dashboard/fantasy/${leagueId}/players`);
  return {};
}

export async function dismissFantasyTrade(leagueId: string, tradeId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
  const res = await dismissTrade(leagueId, me.accountId, tradeId);
  if (res.error) return res;
  revalidatePath(`/dashboard/fantasy/${leagueId}/players`);
  return {};
}

// Anyone with the draft room open may call this: it only ever picks for
// whoever's clock has run out, so it can't be used to pick early.
export async function triggerFantasyAutopick(leagueId: string): Promise<Result> {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) return { error: "You need to be signed in." };
  if (await autopickIfDue(leagueId)) refreshDraft(leagueId);
  return {};
}

export async function startAllFantasyDrafts(): Promise<Result & { message?: string }> {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) return { error: "You need to be signed in." };
  if (!(await isDirectorVerified(session.userId))) {
    return { error: "Only directors with Discord 2FA on can start the fantasy drafts." };
  }
  const res = await startFantasyDrafts();
  revalidatePath("/dashboard/fantasy", "layout");
  return res;
}

export async function openNextFantasySeason(name: string): Promise<Result & { message?: string }> {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) return { error: "You need to be signed in." };
  if (!(await isDirectorVerified(session.userId))) {
    return { error: "Only directors with Discord 2FA on can open a fantasy season." };
  }
  const res = await openFantasySeason(name);
  revalidatePath("/dashboard/fantasy", "layout");
  return res;
}

export async function setFantasyTradesEnabled(on: boolean): Promise<Result> {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) return { error: "You need to be signed in." };
  if (!(await isDirectorVerified(session.userId))) {
    return { error: "Only directors with Discord 2FA on can turn trades on or off." };
  }
  const res = await setFantasyTradesEnabledCore(on === true);
  revalidatePath("/dashboard/fantasy", "layout");
  revalidatePath("/dashboard/settings");
  return res;
}
