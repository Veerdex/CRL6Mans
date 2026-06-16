import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { logAnalyticsEvent, pruneOldAnalyticsEvents } from "@/app/lib/analytics";

// Fired by VisitTracker to count app opens. Requires a valid session so the
// metric can't be inflated by anonymous/external POSTs. Returns { logged } so
// the client only marks the session as counted once it actually recorded.
export async function POST() {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) return NextResponse.json({ logged: false });

  await logAnalyticsEvent("visit");
  if (Math.random() < 0.02) pruneOldAnalyticsEvents().catch(() => {});

  return NextResponse.json({ logged: true });
}
