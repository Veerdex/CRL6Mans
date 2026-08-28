"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { syncSupporterLinks, getFreshCampaignAccessToken } from "@/app/lib/patreon-sync";

async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");
  return session;
}

// Reuses the same helpers the nightly cron uses — this just runs them on
// demand instead of waiting for the next scheduled run.
export async function syncPatreonNow() {
  await verifyAdmin();
  const supporters = await syncSupporterLinks();
  const campaign = await getFreshCampaignAccessToken();
  revalidatePath("/dashboard/admin");
  return { ok: true, supporters, campaignConnected: campaign !== null };
}
