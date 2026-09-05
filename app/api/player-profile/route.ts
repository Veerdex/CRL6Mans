import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
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

  const profile = await loadPlayerProfile(
    discordId ? { discordId } : { username: username! },
  );
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(profile);
}
