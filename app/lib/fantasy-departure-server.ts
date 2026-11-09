import "server-only";
import { supabaseAdmin } from "./supabase";
import { autopickIfDue } from "./fantasy-draft-server";
import { accountName } from "./fantasy-leagues";
import { recordNotification } from "./notifications";

// A manager leaving (docs/fantasy-rl.md §11). Before the draft they simply drop
// out. After it their team stays: it keeps its roster, seat and schedule, and
// scores with the lineup it has until the owner hands it to someone new.

const LEFT_NOTE = "The manager left the league.";

type LeagueLite = { id: string; status: string; commissioner_id: string };

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

// Before the draft an owner who leaves passes the league on, since invites and
// settings still need someone. With nobody left the league is deleted anyway.
async function passOwnership(league: LeagueLite, accountId: string) {
  if (league.commissioner_id !== accountId) return;
  const heir = await nextOwner(league.id, accountId);
  if (heir) await supabaseAdmin.from("fantasy_leagues").update({ commissioner_id: heir }).eq("id", league.id);
}

/** §11 after the draft: the team is orphaned, and nothing it had pending goes through. */
export async function orphanTeam(league: LeagueLite, accountId: string): Promise<{ error?: string }> {
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
      .eq("status", "pending")
      .or(`proposer_id.eq.${accountId},receiver_id.eq.${accountId}`),
  ]);
  // An owner's team is orphaned like anyone else's and nobody inherits the
  // league: after the draft only its name is left to change.
  await tellOwner(league.id, accountId);
  if (league.status === "drafting") await autopickIfDue(league.id);
  return {};
}

async function tellOwner(leagueId: string, departed: string) {
  const { data: league } = await supabaseAdmin.from("fantasy_leagues").select("name, status, commissioner_id").eq("id", leagueId).maybeSingle();
  const ownerId = league?.commissioner_id as string | undefined;
  if (!league || !ownerId || ownerId === departed) return;
  const { data: ownerSeat } = await supabaseAdmin
    .from("fantasy_league_members")
    .select("orphaned_at")
    .eq("league_id", leagueId)
    .eq("account_id", ownerId)
    .maybeSingle();
  if (!ownerSeat || ownerSeat.orphaned_at) return;
  const { data: rows } = await supabaseAdmin.from("accounts").select("id, discord_id, username, display_name").in("id", [ownerId, departed]);
  const accounts = (rows ?? []) as { id: string; discord_id: string; username: string | null; display_name: string | null }[];
  const owner = accounts.find((a) => a.id === ownerId);
  if (!owner) return;
  await recordNotification(
    { kind: "users", discordIds: [owner.discord_id] },
    {
      title: "A fantasy team has no manager",
      body: `${accountName(accounts.find((a) => a.id === departed))} left ${league.name}. Their team plays on, and you can hand it to someone new${league.status === "drafting" ? " once the draft is finished" : ""}.`,
      url: `/dashboard/fantasy/${leagueId}`,
    },
  );
}

/** Before the draft: the manager is just gone, and an owner passes the league on. */
export async function dropBeforeDraft(league: LeagueLite, accountId: string) {
  await passOwnership(league, accountId);
  await supabaseAdmin.from("fantasy_league_members").delete().eq("league_id", league.id).eq("account_id", accountId);
  const { count } = await supabaseAdmin
    .from("fantasy_league_members")
    .select("account_id", { count: "exact", head: true })
    .eq("league_id", league.id);
  // Nobody left to own it: the league is empty, so it goes.
  if (count === 0) await supabaseAdmin.from("fantasy_leagues").delete().eq("id", league.id).eq("status", "pre_draft");
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
    if (league.status === "pre_draft") await dropBeforeDraft(league, accountId);
    else if (league.status === "drafting" || league.status === "active") await orphanTeam(league, accountId);
  }
}
