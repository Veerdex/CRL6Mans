import "server-only";
import { supabaseAdmin } from "./supabase";
import { autopickIfDue } from "./fantasy-draft-server";
import { accountNames, notifyManagers } from "./fantasy-notify";

// A manager leaving (docs/fantasy-rl.md §11). Before the draft they simply drop
// out. After it their team stays: it keeps its roster, seat and schedule, and
// scores with the lineup it has until the owner hands it to someone new. An
// owner who goes always passes the league on, and everyone left is told.

const LEFT_NOTE = "The manager left the league.";

type LeagueLite = { id: string; status: string; commissioner_id: string };

/** How the manager went: on their own, or taken out by the owner or staff. */
export type Departure = "left" | "removed";

/** The earliest-joined manager still in the league, other than `except`. */
async function nextOwner(leagueId: string, except: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("fantasy_league_members")
    .select("account_id")
    .eq("league_id", leagueId)
    .neq("account_id", except)
    .is("orphaned_at", null)
    .order("joined_at")
    .limit(1)
    .maybeSingle();
  return (data?.account_id as string | undefined) ?? null;
}

/** Hands the league to the next manager if the one going owns it, returning the heir. */
async function passOwnership(league: LeagueLite, accountId: string): Promise<string | null> {
  if (league.commissioner_id !== accountId) return null;
  const heir = await nextOwner(league.id, accountId);
  if (!heir) return null;
  const { data } = await supabaseAdmin
    .from("fantasy_leagues")
    .update({ commissioner_id: heir })
    .eq("id", league.id)
    .eq("commissioner_id", accountId)
    .select("id");
  return data?.length ? heir : null;
}

/** §11 after the draft: the team is orphaned, and nothing it had pending goes through. */
export async function orphanTeam(
  league: LeagueLite,
  accountId: string,
  how: Departure,
  actorId?: string,
): Promise<{ error?: string }> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_league_members")
    .update({ orphaned_at: new Date().toISOString() })
    .eq("league_id", league.id)
    .eq("account_id", accountId)
    .is("orphaned_at", null)
    .select("account_id");
  if (error) return { error: "Couldn't update the league. Has scripts/fantasy-manager-departure-migration.sql been run?" };
  if (!data?.length) return {};

  const now = new Date().toISOString();
  await Promise.all([
    supabaseAdmin
      .from("fantasy_waiver_claims")
      .update({ status: "cancelled", note: LEFT_NOTE, resolved_at: now })
      .eq("league_id", league.id)
      .eq("manager_id", accountId)
      .eq("status", "pending"),
    supabaseAdmin
      .from("fantasy_trades")
      .update({ status: "cancelled", note: LEFT_NOTE, resolved_at: now })
      .eq("league_id", league.id)
      .in("status", ["pending", "review"])
      .or(`proposer_id.eq.${accountId},receiver_id.eq.${accountId}`),
  ]);
  const heir = await passOwnership(league, accountId);
  await tellManagers(league.id, accountId, how, heir, actorId);
  if (league.status === "drafting") await autopickIfDue(league.id);
  return {};
}

/**
 * Before the draft: the manager is just gone, and an owner passes the league on.
 * Done in one locked call so a draft starting at the same moment can't seat them.
 */
export async function dropBeforeDraft(
  league: LeagueLite,
  accountId: string,
  how: Departure,
  actorId?: string,
): Promise<{ error?: string }> {
  const { data, error } = await supabaseAdmin.rpc("fantasy_leave_pre_draft", { p_league: league.id, p_account: accountId });
  if (error) return { error: "Couldn't update the league. Has scripts/fantasy-leave-pre-draft-migration.sql been run?" };
  const res = data as { outcome: string; heir?: string | null };
  if (res.outcome === "closed") return { error: "The draft has started, so this can't be changed any more." };
  if (res.outcome === "ok") await tellManagers(league.id, accountId, how, res.heir ?? null, actorId);
  return {};
}

// Every manager still running a team hears about each departure, except the
// owner who did the removing. The new owner gets their own version, and a
// manager the owner removed is told too.
async function tellManagers(leagueId: string, departed: string, how: Departure, heir: string | null, actorId?: string) {
  const { data: league } = await supabaseAdmin.from("fantasy_leagues").select("name, status").eq("id", leagueId).maybeSingle();
  if (!league) return;
  const { data: memberRows } = await supabaseAdmin
    .from("fantasy_league_members")
    .select("account_id")
    .eq("league_id", leagueId)
    .is("orphaned_at", null);
  const recipients = ((memberRows ?? []) as { account_id: string }[])
    .map((m) => m.account_id)
    .filter((id) => id !== departed && id !== actorId);

  const names = await accountNames([...recipients, departed]);
  const name = names.get(departed) ?? "A manager";
  const what = how === "left" ? `${name} left ${league.name}.` : `${name} was removed from ${league.name}.`;
  const afterDraft = league.status !== "pre_draft";
  const later = league.status === "drafting" ? " once the draft is finished" : "";
  const url = `/dashboard/fantasy/${leagueId}`;

  const others = recipients.filter((id) => id !== heir);
  if (others.length) {
    const parts = [what];
    if (heir) parts.push(`${names.get(heir) ?? "Another manager"} is now the league owner.`);
    if (afterDraft) parts.push("Their team plays on with its current lineup until the owner hands it to someone new.");
    notifyManagers(others, "fantasy_league", {
      title: heir ? "Fantasy league owner changed" : how === "left" ? "A manager left your fantasy league" : "A manager was removed from your fantasy league",
      body: parts.join(" "),
      url,
    });
  }
  if (heir && recipients.includes(heir)) {
    const parts = [what, "You're now the league owner."];
    if (afterDraft) parts.push(`Their team plays on with its current lineup, and you can hand it to someone new${later}.`);
    notifyManagers([heir], "fantasy_league", { title: "You're now a fantasy league owner", body: parts.join(" "), url });
  }
  // A kick or ban has no actor here: the moderation itself is the notice.
  if (how === "removed" && actorId) {
    notifyManagers([departed], "fantasy_league", {
      title: "Removed from a fantasy league",
      body: `The owner removed you from ${league.name}.${
        afterDraft ? " Your team stays in the league with its current lineup until the owner hands it to someone new." : ""
      }`,
      url: "/dashboard/fantasy",
    });
  }
}

/**
 * A kick or ban takes the player out of every fantasy league they manage in,
 * on the same terms as leaving, and withdraws every invite and offer they hold.
 */
export async function orphanFantasyTeams(accountId: string): Promise<void> {
  const { data: rows, error } = await supabaseAdmin
    .from("fantasy_league_members")
    .select("league_id")
    .eq("account_id", accountId)
    .is("orphaned_at", null);
  if (error) return;
  const memberships = (rows ?? []) as { league_id: string }[];
  await supabaseAdmin.from("fantasy_league_invites").delete().eq("account_id", accountId);
  if (!memberships.length) return;

  const { data: leagueRows } = await supabaseAdmin
    .from("fantasy_leagues")
    .select("id, status, commissioner_id")
    .in("id", memberships.map((m) => m.league_id));
  for (const league of (leagueRows ?? []) as LeagueLite[]) {
    if (league.status === "pre_draft") {
      const res = await dropBeforeDraft(league, accountId, "removed");
      if (!res.error) continue;
      // The draft started between the read and the leave, so the seat is already
      // in the order: orphan it instead, which a kick may do mid-draft.
      const { data: now } = await supabaseAdmin.from("fantasy_leagues").select("id, status, commissioner_id").eq("id", league.id).maybeSingle();
      if (now?.status === "drafting" || now?.status === "active") await orphanTeam(now as LeagueLite, accountId, "removed");
    } else if (league.status === "drafting" || league.status === "active") {
      await orphanTeam(league, accountId, "removed");
    }
  }
}
