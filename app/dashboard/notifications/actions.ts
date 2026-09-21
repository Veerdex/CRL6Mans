"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { markNotificationsRead } from "@/app/lib/notifications";

// revalidatePath("/dashboard", "layout") rather than the page: the bell's unread
// count is rendered by the dashboard layout, which survives client-side
// navigation, so refreshing only this page would leave a stale number in the nav.
export async function markAllRead() {
  const session = await decrypt((await cookies()).get("session")?.value);
  if (!session?.userId) return;
  await markNotificationsRead(session.userId);
  revalidatePath("/dashboard", "layout");
}
