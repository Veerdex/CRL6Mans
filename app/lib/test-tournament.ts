import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "./session";
import { supabaseAdmin } from "./supabase";
import { isModerator } from "./players";

// A test tournament is staff-only while it runs: players can't see it on the
// dashboard, its event tabs are hidden from them, and its pushes reach
// developers instead of the league (see testTournament on PushPayload).

export async function isTestTournament(tournamentId: string | null | undefined): Promise<boolean> {
  if (!tournamentId) return false;
  const { data } = await supabaseAdmin.from("tournaments").select("is_test").eq("id", tournamentId).maybeSingle();
  return !!data?.is_test;
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
