import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { loadTeamProfile } from "@/app/lib/team-profile";

// Same shape as /api/player-profile: a team is loaded only when its popup is
// opened, never alongside the brackets and tables that link to it.
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamId = request.nextUrl.searchParams.get("teamId");
  if (!teamId) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });

  const profile = await loadTeamProfile(teamId);
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(profile);
}
