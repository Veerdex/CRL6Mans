import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { TeamSignupPanel } from "../team-signup-panel";
import { TournamentJoinCard } from "../tournament-join-card";
import { getTeamSignupView, type TeamSignupView } from "../team-signup-data";
import { LocalTime } from "../local-time";

export default async function TournamentPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const [{ data: player }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("players").select("id, status, team_id").eq("discord_id", session.userId).single(),
    supabaseAdmin.from("league_settings").select("active_tournament_id, draft_active, season_active").single(),
  ]);

  if (!player) redirect("/dashboard");

  // What has this player joined?
  const [{ data: entries }, { data: memberships }] = await Promise.all([
    supabaseAdmin.from("tournament_entries").select("tournament_id").eq("player_id", player.id),
    supabaseAdmin.from("team_signup_members").select("team_signup_id, status").eq("player_id", player.id).eq("status", "accepted"),
  ]);
  const entryTids = new Set((entries ?? []).map((e) => e.tournament_id as string));
  let teamTids = new Set<string>();
  if ((memberships ?? []).length) {
    const { data: sigs } = await supabaseAdmin
      .from("team_signups")
      .select("id, tournament_id")
      .in("id", (memberships ?? []).map((m) => m.team_signup_id));
    teamTids = new Set((sigs ?? []).map((s) => s.tournament_id as string));
  }
  const joinedTids = new Set<string>([...entryTids, ...teamTids]);

  const { data: tournaments } = await supabaseAdmin
    .from("tournaments")
    .select("id, name, status, signups_open, join_mode, team_assignment, draft_open_at, draft_close_at, draft_start_at, season_start_at")
    .in("status", ["scheduled", "active"])
    .order("created_at", { ascending: false });

  const active = (tournaments ?? []).find((t) => t.status === "active") ?? null;
  const activeId = settings?.active_tournament_id as string | null | undefined;
  const inActive = !!active && (joinedTids.has(active.id) || (!!player.team_id && active.id === activeId));

  // Upcoming tournaments the player has joined (scheduled only)
  const upcomingJoined = (tournaments ?? []).filter((t) => t.status === "scheduled" && joinedTids.has(t.id));

  // Pool counts for player-pool upcoming
  const poolCounts: Record<string, number> = {};
  const playerUpcoming = upcomingJoined.filter((t) => t.join_mode === "players");
  if (playerUpcoming.length) {
    const { data: allEntries } = await supabaseAdmin
      .from("tournament_entries").select("tournament_id").in("tournament_id", playerUpcoming.map((t) => t.id));
    for (const e of allEntries ?? []) poolCounts[e.tournament_id] = (poolCounts[e.tournament_id] ?? 0) + 1;
  }

  // Team-signup views for team upcoming
  const teamViews: Record<string, TeamSignupView> = {};
  for (const t of upcomingJoined.filter((t) => t.join_mode === "teams")) {
    const tsNow = Date.now();
    const withinWindow = t.draft_open_at && tsNow >= new Date(t.draft_open_at).getTime() && (!t.draft_close_at || tsNow < new Date(t.draft_close_at).getTime());
    teamViews[t.id] = await getTeamSignupView(player.id, t.id, !!t.signups_open || !!withinWindow);
  }

  const phase = active
    ? settings?.season_active ? "Season in progress"
    : settings?.draft_active ? "Draft in progress"
    : "Getting started"
    : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-white">Tournament</h1>

      {/* Active tournament you're in */}
      {inActive && active && (
        <div className="bg-gradient-to-br from-indigo-950/40 to-zinc-900 border border-indigo-800/40 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">{phase}</p>
          </div>
          <h2 className="text-xl font-bold text-white">{active.name}</h2>
          <div className="flex flex-wrap gap-2 pt-1">
            {settings?.draft_active && (
              <Link href="/dashboard/draft" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg">
                Go to Live Draft
              </Link>
            )}
            {settings?.season_active && (
              <Link href="/dashboard/season" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg">
                View Season
              </Link>
            )}
            {player.team_id && (
              <Link href="/dashboard/my-team" className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-lg">
                My Team
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Upcoming tournaments you've joined */}
      {upcomingJoined.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">Your Upcoming Tournaments</h2>
          {playerUpcoming.map((t) => (
            <div key={t.id} className="space-y-1">
              <TournamentJoinCard
                id={t.id}
                name={t.name}
                poolCount={poolCounts[t.id] ?? 0}
                joined={true}
                teamAssignment={t.team_assignment as "snake_draft" | "auto_balance" | null}
                minMmr2v2={(t as { min_mmr_2v2?: number | null }).min_mmr_2v2 ?? null}
                minMmr3v3={(t as { min_mmr_3v3?: number | null }).min_mmr_3v3 ?? null}
              />
              <p className="text-[11px] text-zinc-500 px-1">
                {(() => { const n = Date.now(); return t.signups_open || (t.draft_open_at && n >= new Date(t.draft_open_at).getTime() && (!t.draft_close_at || n < new Date(t.draft_close_at).getTime())); })() ? "Sign-ups open" : "Sign-ups closed"}{t.season_start_at && <> · Season <LocalTime iso={t.season_start_at} /></>}
              </p>
            </div>
          ))}
          {upcomingJoined.filter((t) => t.join_mode === "teams").map((t) =>
            teamViews[t.id] ? (
              <TeamSignupPanel key={t.id} view={teamViews[t.id]} tournamentId={t.id} tournamentName={t.name} />
            ) : null
          )}
        </div>
      )}

      {!inActive && upcomingJoined.length === 0 && (
        <p className="text-sm text-zinc-500">
          You haven&apos;t joined a tournament yet. Open tournaments appear on your{" "}
          <Link href="/dashboard" className="text-indigo-400 hover:underline">dashboard</Link>.
        </p>
      )}
    </div>
  );
}
