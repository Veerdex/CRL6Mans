"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isAdmin } from "@/app/lib/players";
import { execReportMatchResult } from "@/app/lib/discord-bot";

async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !isAdmin(session.userId)) redirect("/dashboard");
}

export async function reportMatchResult(matchId: string, homeScore: number, awayScore: number) {
  await verifyAdmin();
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore))
    return { ok: false, message: "Scores must be finite numbers." };
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore))
    return { ok: false, message: "Scores must be whole numbers." };
  if (homeScore < 0 || awayScore < 0)
    return { ok: false, message: "Scores cannot be negative." };
  if (homeScore === awayScore)
    return { ok: false, message: "Scores cannot be equal — ties are not allowed." };
  if (homeScore > 10 || awayScore > 10)
    return { ok: false, message: "Scores cannot exceed 10." };
  const result = await execReportMatchResult(matchId, homeScore, awayScore);
  if (result.ok) {
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/season");
    revalidatePath("/dashboard/my-team");
  }
  return result;
}
