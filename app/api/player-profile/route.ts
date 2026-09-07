import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { loadPlayerProfile } from "@/app/lib/player-profile";

// Profiles are fetched only when one is opened, never alongside the pages that
// link to them, so this is a route handler rather than data threaded through
// every server component that renders a name.
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const username = request.nextUrl.searchParams.get("username");
  const discordId = request.nextUrl.searchParams.get("discordId");
  if (!username && !discordId) {
    return NextResponse.json({ error: "Missing username or discordId" }, { status: 400 });
  }

  const [profile, canEditAccolades] = await Promise.all([
    loadPlayerProfile(discordId ? { discordId } : { username: username! }),
    isDirectorVerified(session.userId),
  ]);
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only decides whether the edit affordance renders — every accolade write is
  // gated again server-side in app/dashboard/accolade-actions.ts.
  return NextResponse.json({ ...profile, canEditAccolades });
}
