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
  type LeagueRow,
} from "@/app/lib/fantasy-leagues";
import { normalizeLeagueName } from "@/app/lib/fantasy-rules";
import { getStaffRole, isDirectorVerified } from "@/app/lib/players";
import { autopickIfDue, startFantasyDrafts, submitPick } from "@/app/lib/fantasy-draft-server";
import { moveLineupPlayer } from "@/app/lib/fantasy-lineup-server";

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

async function isMember(leagueId: string, accountId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("fantasy_league_members")
    .select("account_id")
    .eq("league_id", leagueId)
    .eq("account_id", accountId)
    .maybeSingle();
  return !!data;
}

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
  if (error || !league) {
    // 23505 is the (season, created_by) unique key: the one-league rule.
    if (error?.code === "23505") return { error: "You've already created a league this season." };
    return { error: "Couldn't create the league." };
  }

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

export async function leaveLeague(leagueId: string): Promise<Result & { deleted?: boolean }> {
  const me = await requireManager();
  if ("error" in me) return me;
  const league = await requirePreDraftLeague(leagueId);
  if ("error" in league) return league;
  if (!(await isMember(leagueId, me.accountId))) return { error: "You're not in this league." };

  if (league.created_by === me.accountId) {
    // The creator leaving disbands the league: it's deleted outright (members and
    // invites cascade), which also frees the creator to create another.
    const [{ data: others }, { data: creator }] = await Promise.all([
      supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", leagueId).neq("account_id", me.accountId),
      supabaseAdmin.from("accounts").select("username, display_name").eq("id", me.accountId).maybeSingle(),
    ]);
    // Pinned to pre_draft so a draft starting since the check above keeps its league.
    const { data: deleted, error } = await supabaseAdmin
      .from("fantasy_leagues")
      .delete()
      .eq("id", leagueId)
      .eq("status", "pre_draft")
      .select("id");
    if (error) return { error: "Couldn't disband the league." };
    if (!deleted?.length) return { error: "The draft has started, so you can't leave this league now." };

    const otherIds = ((others ?? []) as { account_id: string }[]).map((m) => m.account_id);
    if (otherIds.length) {
      const { data: rows } = await supabaseAdmin.from("accounts").select("discord_id").in("id", otherIds);
      const discordIds = ((rows ?? []) as { discord_id: string }[]).map((r) => r.discord_id);
      if (discordIds.length) {
        await recordNotification(
          { kind: "users", discordIds },
          {
            title: "Fantasy league disbanded",
            body: `${accountName(creator)} left ${league.name}, so the league was disbanded.`,
            url: "/dashboard/fantasy",
          },
        );
      }
    }
    refresh();
    return { deleted: true };
  }

  await supabaseAdmin.from("fantasy_league_members").delete().eq("league_id", leagueId).eq("account_id", me.accountId);
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
  return { me, league };
}

export async function renameLeague(leagueId: string, rawName: string): Promise<Result> {
  const ctx = await requireCommissioner(leagueId, false);
  if ("error" in ctx) return ctx;
  if (ctx.league.status === "complete" || ctx.league.status === "disbanded") return { error: "This league is closed." };
  const name = normalizeLeagueName(rawName);
  if (typeof name !== "string") return name;
  await supabaseAdmin.from("fantasy_leagues").update({ name }).eq("id", leagueId);
  refresh(leagueId);
  return {};
}

export async function setLeagueVisibility(leagueId: string, visibility: "public" | "private"): Promise<Result> {
  const ctx = await requireCommissioner(leagueId, false);
  if ("error" in ctx) return ctx;
  if (ctx.league.status === "complete" || ctx.league.status === "disbanded") return { error: "This league is closed." };
  if (visibility !== "public" && visibility !== "private") return { error: "Pick public or private." };
  await supabaseAdmin.from("fantasy_leagues").update({ visibility }).eq("id", leagueId);
  refresh(leagueId);
  return {};
}

export async function removeManager(leagueId: string, accountId: string): Promise<Result> {
  const ctx = await requireCommissioner(leagueId, true);
  if ("error" in ctx) return ctx;
  if (accountId === ctx.me.accountId) return { error: "Use Leave league to leave your own league." };
  if (!(await isMember(leagueId, accountId))) return { error: "That player isn't in this league." };
  await supabaseAdmin.from("fantasy_league_members").delete().eq("league_id", leagueId).eq("account_id", accountId);
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
  const ctx = await requireCommissioner(leagueId, true);
  if ("error" in ctx) return ctx;
  await supabaseAdmin.from("fantasy_league_invites").delete().eq("league_id", leagueId).eq("account_id", accountId);
  refresh(leagueId);
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

  // Stripped to characters a name can hold: the term is spliced into a
  // PostgREST or() filter, where a comma or parenthesis would change its meaning.
  const term = query.replace(/[^\p{L}\p{N} ._-]/gu, "").trim();
  if (term.length < 2) return { results: [] };

  const [{ data: accounts }, { data: members }, { data: invites }] = await Promise.all([
    supabaseAdmin
      .from("accounts")
      .select("id, discord_id, username, display_name, avatar")
      .eq("status", "approved")
      .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
      .limit(20),
    supabaseAdmin.from("fantasy_league_members").select("account_id").eq("league_id", leagueId),
    supabaseAdmin.from("fantasy_league_invites").select("account_id").eq("league_id", leagueId),
  ]);
  const taken = new Set([...(members ?? []), ...(invites ?? [])].map((r) => r.account_id as string));
  let rows = ((accounts ?? []) as { id: string; discord_id: string; username: string | null; display_name: string | null; avatar: string | null }[])
    .filter((a) => !taken.has(a.id));
  if (!(await fantasyOpenToAll())) {
    const roles = await Promise.all(rows.map((a) => getStaffRole(a.discord_id)));
    rows = rows.filter((_, i) => roles[i] !== null);
  }

  return {
    results: rows
      .slice(0, 8)
      .map((a) => ({ accountId: a.id, name: accountName(a), username: a.username, discordId: a.discord_id, avatar: a.avatar })),
  };
}

function refreshDraft(leagueId: string) {
  revalidatePath("/dashboard/fantasy");
  revalidatePath(`/dashboard/fantasy/${leagueId}`, "layout");
}

export async function makeFantasyPick(leagueId: string, playerId: string): Promise<Result> {
  const me = await requireManager();
  if ("error" in me) return me;
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
