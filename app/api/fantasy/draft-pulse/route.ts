import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { fantasyAccessOpen, getFantasyViewer } from "@/app/lib/fantasy-leagues";
import { getDraftLeague } from "@/app/lib/fantasy-draft-server";

export const dynamic = "force-dynamic";

// The draft room polls this and only re-renders when the pick moves.
export async function GET(request: Request) {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await fantasyAccessOpen(await getFantasyViewer(session.userId)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const leagueId = new URL(request.url).searchParams.get("league") ?? "";
  const league = /^[0-9a-f-]{36}$/i.test(leagueId) ? await getDraftLeague(leagueId) : null;
  if (!league) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(
    { pick: league.current_pick, deadline: league.pick_deadline, status: league.status },
    { headers: { "Cache-Control": "no-store" } },
  );
}
