"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { isDirectorVerified } from "@/app/lib/players";
import { getFantasyViewer, getLeague, ownsLeague, type LeagueRow } from "@/app/lib/fantasy-leagues";
import { dropBeforeDraft, orphanTeam } from "@/app/lib/fantasy-departure-server";
import { isClosedLeague, normalizeLeagueName } from "@/app/lib/fantasy-rules";
import { accountNames, notifyManagers } from "@/app/lib/fantasy-notify";

// A director's powers over any fantasy league (docs/fantasy-rl.md §2). They run
// the same rules as the owner's own controls, plus transfer and delete. Every
// export is a callable endpoint, so each re-checks the caller.

type Result = { error?: string };

async function requireDirector(leagueId: string): Promise<{ actorId: string; league: LeagueRow } | { error: string }> {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) return { error: "You need to be signed in." };
  if (!(await isDirectorVerified(session.userId))) return { error: "Only directors with Discord 2FA on can manage fantasy leagues." };
  const viewer = await getFantasyViewer(session.userId);
  if (!viewer.accountId) return { error: "You need an account to do that." };
  const league = await getLeague(leagueId);
  if (!league) return { error: "That league doesn't exist." };
  return { actorId: viewer.accountId, league };
}

function refresh(leagueId: string) {
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/fantasy");
  revalidatePath(`/dashboard/fantasy/${leagueId}`, "layout");
}

async function activeMember(leagueId: string, accountId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("fantasy_league_members")
    .select("account_id", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("account_id", accountId)
    .is("orphaned_at", null);
  return (count ?? 0) > 0;
}

export async function staffRenameLeague(leagueId: string, rawName: string): Promise<Result> {
  const ctx = await requireDirector(leagueId);
  if ("error" in ctx) return ctx;
  if (isClosedLeague(ctx.league.status)) return { error: "This league is closed." };
  const name = normalizeLeagueName(rawName);
  if (typeof name !== "string") return name;
  const { error } = await supabaseAdmin.from("fantasy_leagues").update({ name }).eq("id", leagueId);
  if (error) return { error: "Couldn't rename the league." };
  notifyManagers(await memberIds(leagueId), "fantasy_minor", {
    title: "Fantasy league renamed",
    body: `League staff renamed ${ctx.league.name} to ${name}.`,
    url: `/dashboard/fantasy/${leagueId}`,
  });
  refresh(leagueId);
  return {};
}

export async function staffRemoveManager(leagueId: string, accountId: string): Promise<Result> {
  const ctx = await requireDirector(leagueId);
  if ("error" in ctx) return ctx;
  const { league, actorId } = ctx;
  if (!(await activeMember(leagueId, accountId))) return { error: "That player isn't managing in this league." };
  if (league.status === "drafting") return { error: "Managers can't be removed while the draft is running." };
  if (league.status === "active") {
    const res = await orphanTeam(league, accountId, "staff_removed", actorId);
    if (res.error) return res;
  } else if (league.status === "pre_draft") {
    const res = await dropBeforeDraft(league, accountId, "staff_removed", actorId);
    if (res.error) return res;
  } else {
    return { error: "This league is closed." };
  }
  await supabaseAdmin.from("fantasy_league_removals").upsert({ league_id: leagueId, account_id: accountId });
  refresh(leagueId);
  return {};
}

export async function staffTransferOwnership(leagueId: string, accountId: string): Promise<Result> {
  const ctx = await requireDirector(leagueId);
  if ("error" in ctx) return ctx;
  const { league } = ctx;
  if (isClosedLeague(league.status)) return { error: "This league is closed." };
  if (league.commissioner_id === accountId) return { error: "They already own this league." };
  if (!(await activeMember(leagueId, accountId))) return { error: "Only a manager still in the league can own it." };
  if (await ownsLeague(league.fantasy_season_id, accountId)) return { error: "They already own another league this season." };

  // Pinned to the owner this was read with, so it can't overwrite an
  // ownership change that landed in between.
  const { data } = await supabaseAdmin
    .from("fantasy_leagues")
    .update({ commissioner_id: accountId })
    .eq("id", leagueId)
    .eq("commissioner_id", league.commissioner_id)
    .select("id");
  if (!data?.length) return { error: "The owner changed while you were looking. Refresh and try again." };

  const names = await accountNames([accountId]);
  const url = `/dashboard/fantasy/${leagueId}`;
  notifyManagers([accountId], "fantasy_major", {
    title: "You're now a fantasy league owner",
    body: `League staff made you the owner of ${league.name}.`,
    url,
  });
  notifyManagers([league.commissioner_id], "fantasy_major", {
    title: "Fantasy league owner changed",
    body: `League staff handed ${league.name} to ${names.get(accountId) ?? "another manager"}. You're still a manager in it.`,
    url,
  });
  refresh(leagueId);
  return {};
}

// Only before the draft: once a league has drafted, its results belong to the
// season-end snapshot, and deleting it would drop them without a trace.
export async function staffDeleteLeague(leagueId: string): Promise<Result> {
  const ctx = await requireDirector(leagueId);
  if ("error" in ctx) return ctx;
  if (ctx.league.status !== "pre_draft") return { error: "Only a league that hasn't drafted yet can be deleted." };
  const members = await memberIds(leagueId);
  // Pinned to pre_draft so it can't race the draft start claiming the league.
  const { data, error } = await supabaseAdmin
    .from("fantasy_leagues")
    .delete()
    .eq("id", leagueId)
    .eq("status", "pre_draft")
    .select("id");
  if (error) return { error: "Couldn't delete the league." };
  if (!data?.length) return { error: "The league's draft has started, so it can't be deleted any more." };
  notifyManagers(members, "fantasy_major", {
    title: "Fantasy league deleted",
    body: `League staff deleted ${ctx.league.name}. You can join or create another league before the drafts start.`,
    url: "/dashboard/fantasy",
  });
  refresh(leagueId);
  return {};
}

async function memberIds(leagueId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("fantasy_league_members")
    .select("account_id")
    .eq("league_id", leagueId)
    .is("orphaned_at", null);
  return ((data ?? []) as { account_id: string }[]).map((m) => m.account_id);
}
