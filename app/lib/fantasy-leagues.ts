import { supabaseAdmin } from "./supabase";
import { getStaffRole } from "./players";
import { fantasyManagerCap, type FantasyLeagueStatus } from "./fantasy-rules";

// Server-side reads for the fantasy pages and the access checks the actions
// share. Every read here tolerates the tables not existing yet (a deploy that
// lands before scripts/fantasy-leagues-migration.sql is run reads as "no
// fantasy season") rather than throwing.

export type FantasyViewer = {
  accountId: string | null;
  discordId: string;
  approved: boolean;
  isGuest: boolean;
  isStaff: boolean;
};

export type FantasySeason = { id: string; name: string; status: string };

export type LeagueRow = {
  id: string;
  fantasy_season_id: string;
  name: string;
  visibility: "public" | "private";
  status: FantasyLeagueStatus;
  created_by: string;
  commissioner_id: string;
  created_at: string;
};

export type LeagueCard = {
  id: string;
  name: string;
  visibility: "public" | "private";
  status: FantasyLeagueStatus;
  memberCount: number;
  cap: number;
  commissionerName: string;
  isMember: boolean;
  isOwner: boolean;
  isInvited: boolean;
  isRemoved: boolean;
};

export type MemberView = {
  accountId: string;
  discordId: string;
  name: string;
  username: string | null;
  avatar: string | null;
  isCommissioner: boolean;
};

type AccountLite = { id: string; discord_id: string; username: string | null; display_name: string | null; avatar: string | null };

const LEAGUE_COLS = "id, fantasy_season_id, name, visibility, status, created_by, commissioner_id, created_at";

export const accountName = (a: Pick<AccountLite, "display_name" | "username"> | undefined | null) =>
  a?.display_name || a?.username || "Unknown";

export async function getFantasyViewer(discordId: string): Promise<FantasyViewer> {
  const [{ data: account }, role] = await Promise.all([
    supabaseAdmin.from("accounts").select("id, status, is_guest").eq("discord_id", discordId).maybeSingle(),
    getStaffRole(discordId),
  ]);
  return {
    accountId: (account?.id as string | undefined) ?? null,
    discordId,
    approved: account?.status === "approved",
    isGuest: !!account?.is_guest,
    isStaff: role !== null,
  };
}

// The tab is hidden until an admin forces it on through the nav tab overrides,
// and the pages and actions honour the same switch — pushing main deploys, so
// this is what keeps a half-built feature from being usable in production by
// anyone who guesses the URL. Staff always get in, so it can be reviewed first.
export async function fantasyAccessOpen(viewer: FantasyViewer): Promise<boolean> {
  return viewer.isStaff || (await fantasyOpenToAll());
}

export async function fantasyOpenToAll(): Promise<boolean> {
  const { data } = await supabaseAdmin.from("league_settings").select("nav_tab_overrides").maybeSingle();
  const overrides = (data?.nav_tab_overrides as Record<string, string> | null) ?? {};
  return overrides.fantasy === "shown";
}

export async function getCurrentFantasySeason(): Promise<FantasySeason | null> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_seasons")
    .select("id, name, status")
    .neq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as FantasySeason;
}

export async function getManagerCap(): Promise<number> {
  const { data } = await supabaseAdmin.from("league_settings").select("num_teams").maybeSingle();
  return fantasyManagerCap((data?.num_teams as number | null) ?? null);
}

export async function getLeague(leagueId: string): Promise<LeagueRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(leagueId)) return null;
  const { data, error } = await supabaseAdmin.from("fantasy_leagues").select(LEAGUE_COLS).eq("id", leagueId).maybeSingle();
  if (error || !data) return null;
  return data as LeagueRow;
}

async function fetchAccounts(ids: string[]): Promise<Map<string, AccountLite>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("id, discord_id, username, display_name, avatar")
    .in("id", unique);
  return new Map(((data ?? []) as AccountLite[]).map((a) => [a.id, a]));
}

export type HubData = {
  season: FantasySeason | null;
  cap: number;
  myLeagues: LeagueCard[];
  invitedLeagues: LeagueCard[];
  otherLeagues: LeagueCard[];
  hasCreated: boolean;
};

export async function getHubData(viewer: FantasyViewer): Promise<HubData> {
  const season = await getCurrentFantasySeason();
  const cap = await getManagerCap();
  if (!season) return { season, cap, myLeagues: [], invitedLeagues: [], otherLeagues: [], hasCreated: false };

  const { data: leagueRows } = await supabaseAdmin
    .from("fantasy_leagues")
    .select(LEAGUE_COLS)
    .eq("fantasy_season_id", season.id)
    .neq("status", "disbanded")
    .order("created_at", { ascending: true });
  const leagues = (leagueRows ?? []) as LeagueRow[];
  const ids = leagues.map((l) => l.id);

  const [{ data: memberRows }, { data: inviteRows }, { data: removalRows }] = ids.length
    ? await Promise.all([
        supabaseAdmin.from("fantasy_league_members").select("league_id, account_id").in("league_id", ids),
        viewer.accountId
          ? supabaseAdmin.from("fantasy_league_invites").select("league_id").eq("account_id", viewer.accountId).in("league_id", ids)
          : Promise.resolve({ data: [] }),
        viewer.accountId
          ? supabaseAdmin.from("fantasy_league_removals").select("league_id").eq("account_id", viewer.accountId).in("league_id", ids)
          : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const members = (memberRows ?? []) as { league_id: string; account_id: string }[];
  const invited = new Set(((inviteRows ?? []) as { league_id: string }[]).map((r) => r.league_id));
  const removed = new Set(((removalRows ?? []) as { league_id: string }[]).map((r) => r.league_id));
  const accounts = await fetchAccounts(leagues.map((l) => l.commissioner_id));

  const cards: LeagueCard[] = leagues.map((l) => {
    const roster = members.filter((m) => m.league_id === l.id);
    return {
      id: l.id,
      name: l.name,
      visibility: l.visibility,
      status: l.status,
      memberCount: roster.length,
      cap,
      commissionerName: accountName(accounts.get(l.commissioner_id)),
      isMember: !!viewer.accountId && roster.some((m) => m.account_id === viewer.accountId),
      isOwner: !!viewer.accountId && l.created_by === viewer.accountId,
      isInvited: invited.has(l.id),
      isRemoved: removed.has(l.id),
    };
  });

  return {
    season,
    cap,
    myLeagues: cards.filter((c) => c.isMember),
    invitedLeagues: cards.filter((c) => !c.isMember && c.isInvited),
    otherLeagues: cards.filter((c) => !c.isMember && !c.isInvited),
    hasCreated: !!viewer.accountId && leagues.some((l) => l.created_by === viewer.accountId),
  };
}

export type LeagueView = {
  league: LeagueRow;
  season: FantasySeason | null;
  cap: number;
  members: MemberView[];
  invites: MemberView[];
  isMember: boolean;
  isCommissioner: boolean;
  isInvited: boolean;
  isRemoved: boolean;
  myLeagues: { id: string; name: string }[];
};

export async function getLeagueView(leagueId: string, viewer: FantasyViewer): Promise<LeagueView | null> {
  const league = await getLeague(leagueId);
  if (!league) return null;

  const [{ data: season }, cap, { data: memberRows }, { data: inviteRows }, { data: removalRows }, { data: myRows }] =
    await Promise.all([
      supabaseAdmin.from("fantasy_seasons").select("id, name, status").eq("id", league.fantasy_season_id).maybeSingle(),
      getManagerCap(),
      supabaseAdmin.from("fantasy_league_members").select("account_id, joined_at").eq("league_id", league.id).order("joined_at"),
      supabaseAdmin.from("fantasy_league_invites").select("account_id, created_at").eq("league_id", league.id).order("created_at"),
      viewer.accountId
        ? supabaseAdmin.from("fantasy_league_removals").select("account_id").eq("league_id", league.id).eq("account_id", viewer.accountId)
        : Promise.resolve({ data: [] }),
      viewer.accountId
        ? supabaseAdmin.from("fantasy_league_members").select("league_id").eq("account_id", viewer.accountId)
        : Promise.resolve({ data: [] }),
    ]);

  const memberIds = ((memberRows ?? []) as { account_id: string }[]).map((m) => m.account_id);
  const inviteIds = ((inviteRows ?? []) as { account_id: string }[]).map((m) => m.account_id);
  const accounts = await fetchAccounts([...memberIds, ...inviteIds]);
  const toView = (id: string): MemberView => {
    const a = accounts.get(id);
    return {
      accountId: id,
      discordId: a?.discord_id ?? "",
      name: accountName(a),
      username: a?.username ?? null,
      avatar: a?.avatar ?? null,
      isCommissioner: id === league.commissioner_id,
    };
  };

  const myLeagueIds = ((myRows ?? []) as { league_id: string }[]).map((r) => r.league_id);
  const { data: myLeagueRows } = myLeagueIds.length
    ? await supabaseAdmin
        .from("fantasy_leagues")
        .select("id, name")
        .in("id", myLeagueIds)
        .eq("fantasy_season_id", league.fantasy_season_id)
        .neq("status", "disbanded")
        .order("created_at")
    : { data: [] };

  return {
    league,
    season: (season as FantasySeason | null) ?? null,
    cap,
    members: memberIds.map(toView),
    invites: inviteIds.map(toView),
    isMember: !!viewer.accountId && memberIds.includes(viewer.accountId),
    isCommissioner: !!viewer.accountId && viewer.accountId === league.commissioner_id,
    isInvited: !!viewer.accountId && inviteIds.includes(viewer.accountId),
    isRemoved: ((removalRows ?? []) as unknown[]).length > 0,
    myLeagues: (myLeagueRows ?? []) as { id: string; name: string }[],
  };
}
