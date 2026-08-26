import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { logTabVisit, pruneOldTabVisits } from "@/app/lib/analytics";
import { TAB_LABELS } from "@/app/lib/tab-labels";

// Fired by TabVisitTracker on every dashboard route change. Requires a valid
// session so the metric can't be inflated by anonymous/external POSTs.
export async function POST(request: Request) {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) return NextResponse.json({ logged: false });

  const { tab } = await request.json().catch(() => ({ tab: null }));
  if (typeof tab !== "string" || !(tab in TAB_LABELS)) return NextResponse.json({ logged: false });

  await logTabVisit(tab);
  if (Math.random() < 0.02) pruneOldTabVisits().catch(() => {});

  return NextResponse.json({ logged: true });
}
