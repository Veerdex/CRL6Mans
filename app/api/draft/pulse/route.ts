import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";

// Polled by every open draft page instead of calling router.refresh() on a
// timer. A refresh re-runs six Supabase queries plus a full RSC render and
// re-serializes the payload, per client, so with a full pool that was the
// single largest source of Active CPU in the app. This is the smallest query
// that can answer "has anything moved" - the client only pays for a refresh
// when current_pick or pick_deadline actually changes.
export async function GET() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("draft_active, current_pick, pick_deadline")
    .single();

  return NextResponse.json(
    {
      draftActive: data?.draft_active ?? false,
      currentPick: data?.current_pick ?? 0,
      pickDeadline: (data?.pick_deadline as string | null) ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
