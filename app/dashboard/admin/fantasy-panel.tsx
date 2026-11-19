import { supabaseAdmin } from "@/app/lib/supabase";
import { accountName, fantasyOpenToAll, getHubSeason, getManagerCap } from "@/app/lib/fantasy-leagues";
import { fantasyDraftGates, rosterShortfall, type DraftGate } from "@/app/lib/fantasy-draft-server";
import { fantasyTradesEnabled } from "@/app/lib/fantasy-trades-server";
import { FANTASY_MIN_MANAGERS, type FantasyLeagueStatus } from "@/app/lib/fantasy-rules";
import { FantasyAdminClient, type AdminLeague } from "./fantasy-admin-client";

type MemberRow = { league_id: string; account_id: string; orphaned_at: string | null; joined_at: string };
type AccountRow = { id: string; discord_id: string; username: string | null; display_name: string | null };

// Loaded on its own, inside a Suspense boundary, so the pool read behind the
// launch checklist never holds up the rest of the admin page.
export async function FantasyPanel() {
  const [season, openToAll, tradesOn, cap] = await Promise.all([
    getHubSeason(),
    fantasyOpenToAll(),
    fantasyTradesEnabled(),
    getManagerCap(),
  ]);
  const launch = season?.status === "open" ? await fantasyDraftGates() : null;

  const { data: leagueRows } = season
    ? await supabaseAdmin
        .from("fantasy_leagues")
        .select("id, name, status, visibility, commissioner_id, created_at")
        .eq("fantasy_season_id", season.id)
        .order("created_at")
    : { data: [] };
  const leagues = (leagueRows ?? []) as {
    id: string;
    name: string;
    status: FantasyLeagueStatus;
    visibility: "public" | "private";
    commissioner_id: string;
  }[];

  const { data: memberRows } = leagues.length
    ? await supabaseAdmin
        .from("fantasy_league_members")
        .select("league_id, account_id, orphaned_at, joined_at")
        .in("league_id", leagues.map((l) => l.id))
        .order("joined_at")
    : { data: [] };
  const members = (memberRows ?? []) as MemberRow[];
  const { data: accountRows } = members.length
    ? await supabaseAdmin
        .from("accounts")
        .select("id, discord_id, username, display_name")
        .in("id", [...new Set(members.map((m) => m.account_id))])
    : { data: [] };
  const accounts = new Map(((accountRows ?? []) as AccountRow[]).map((a) => [a.id, a]));

  const adminLeagues: AdminLeague[] = leagues.map((l) => {
    const own = members.filter((m) => m.league_id === l.id);
    const activeIds = own.filter((m) => !m.orphaned_at).map((m) => m.account_id);
    const warnings: string[] = [];
    if (l.status === "pre_draft" && launch) {
      if (activeIds.length < FANTASY_MIN_MANAGERS) {
        warnings.push(`Fewer than ${FANTASY_MIN_MANAGERS} managers: disbanded when the drafts start.`);
      } else {
        const missing = rosterShortfall(launch.tiers, activeIds);
        if (missing.length) warnings.push(`Not enough ${missing.join(", ")} players to fill every roster: blocks the drafts.`);
      }
    }
    return {
      id: l.id,
      name: l.name,
      status: l.status,
      visibility: l.visibility,
      warnings,
      managers: own.map((m) => {
        const a = accounts.get(m.account_id);
        return {
          accountId: m.account_id,
          name: accountName(a),
          username: a?.username ?? "",
          discordId: a?.discord_id ?? null,
          isOwner: m.account_id === l.commissioner_id,
          orphaned: !!m.orphaned_at,
        };
      }),
    };
  });

  return (
    <FantasyAdminClient
      season={season}
      openToAll={openToAll}
      tradesOn={tradesOn}
      cap={cap}
      gates={launch?.gates.map(({ label, ok }): Pick<DraftGate, "label" | "ok"> => ({ label, ok })) ?? null}
      testRun={launch?.testRun ?? false}
      leagues={adminLeagues}
    />
  );
}
