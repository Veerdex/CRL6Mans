import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isCurrentlyKicked, isDirectorVerified } from "@/app/lib/players";
import { loadPlayerProfile } from "@/app/lib/player-profile";
import { supabaseAdmin } from "@/app/lib/supabase";

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

  // Both flags only decide whether an edit affordance renders — accolade writes
  // are gated again in app/dashboard/accolade-actions.ts, and the MMR write in
  // saveOwnMmr resolves the player from the session rather than from the client.
  //
  // The MMR flag mirrors saveOwnMmr's own gate rather than just "is this me":
  // loadPlayerProfile treats Tier 3 as optional, so a pending or kicked account
  // has a viewable profile and would otherwise get a button that always refuses.
  const canEditMmr =
    profile.identity.discordId === session.userId && (await selfCanEditMmr(session.userId));

  return NextResponse.json({ ...profile, canEditAccolades, canEditMmr });
}

/** Only called for a viewer looking at their own profile, so other viewers pay nothing. */
async function selfCanEditMmr(discordId: string): Promise<boolean> {
  const { data: account } = await supabaseAdmin
    .from("accounts")
    .select("status, kick_reason, kicked_until")
    .eq("discord_id", discordId)
    .single();

  return (
    account?.status === "approved" &&
    !isCurrentlyKicked(account.kick_reason ?? null, account.kicked_until ?? null)
  );
}
