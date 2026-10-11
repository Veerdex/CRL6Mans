import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "./session";
import { supabaseAdmin } from "./supabase";
import { isModerator } from "./players";

// A test tournament is staff-only while it runs: players can't see it on the
// dashboard, its event tabs are hidden from them, and its pushes are rerouted
// away from the league to the staff who opted into test-tournament
// notifications — off by default, so a test run is silent for everyone until
// someone turns it on (see testTournament on PushPayload and
// pushToTestTournamentAdmins).

export async function isTestTournament(tournamentId: string | null | undefined): Promise<boolean> {
  if (!tournamentId) return false;
  const { data } = await supabaseAdmin.from("tournaments").select("is_test").eq("id", tournamentId).maybeSingle();
  return !!data?.is_test;
}

// Whether the event currently running is staff scaffolding of either kind. The
// two flags are set by different flows and live in different tables —
// tournaments.is_test on the tournament row, league_settings.is_test_season on a
// manual season — but anything that must not outlive the event has to honour
// both, and completeSeason's "Test season discarded" promise is as load-bearing
// as completeTournament's.
export async function isTestEventActive(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("active_tournament_id, is_test_season")
    .maybeSingle();
  if (data?.is_test_season) return true;
  return isTestTournament(data?.active_tournament_id as string | null | undefined);
}

export const isActiveTournamentTest = cache(async (): Promise<boolean> => {
  const { data } = await supabaseAdmin.from("league_settings").select("active_tournament_id").maybeSingle();
  return isTestTournament(data?.active_tournament_id as string | null | undefined);
});

// For a page that only shows the running event: true when that event is a test
// tournament and the viewer isn't staff.
export async function hidesActiveTestTournament(discordId: string): Promise<boolean> {
  return (await isActiveTournamentTest()) && !(await isModerator(discordId));
}

// First line of every page that only shows the running event, so a direct link
// can't reach what the hidden nav tab would have.
export async function redirectIfTestTournamentHidden(): Promise<void> {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (session?.userId && !(await hidesActiveTestTournament(session.userId))) return;
  redirect("/dashboard");
}
