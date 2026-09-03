"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PATREON_SIM_COOKIE, patreonSimEnabled, topPaidTier } from "@/app/lib/patreon-sim";

// The purchase half of the simulation. It only records intent in a cookie —
// nothing is written to the account until the patron actually links, which is
// what the real flow does too and what keeps "Connect Patreon" a step the
// tester has to take.
export async function simulatePatreonPurchase() {
  if (!patreonSimEnabled()) return;

  const tier = await topPaidTier();
  if (!tier) return;

  const cookieStore = await cookies();
  cookieStore.set(PATREON_SIM_COOKIE, tier.title, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });

  redirect("/dashboard/settings");
}
