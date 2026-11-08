import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { fantasyAccessOpen, getFantasyViewer, getLeagueView } from "@/app/lib/fantasy-leagues";

// The guard every league tab shares. cache() lets the layout and the page
// both call it while the request runs it once.
export const loadLeague = cache(async (leagueId: string) => {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) redirect("/login");
  const viewer = await getFantasyViewer(session.userId);
  if (viewer.isGuest) redirect("/dashboard");
  if (!(await fantasyAccessOpen(viewer))) redirect("/dashboard/fantasy");

  const view = await getLeagueView(leagueId, viewer);
  if (!view || view.league.status === "disbanded") notFound();
  return { viewer, view };
});

export type LeagueAccess = Awaited<ReturnType<typeof loadLeague>>;

// Started without awaiting, so a tab can send its frame first and stream the league in.
// Only await it on the server: its redirect/notFound must throw there, not in a client use().
export const leagueFromParams = (params: Promise<{ league: string }>) => params.then((p) => loadLeague(p.league));
