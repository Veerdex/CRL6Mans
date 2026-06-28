import webpush from "web-push";
import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase";

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL ?? "admin@crl6mans.com"}`,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export type NotificationCategory = "tournament" | "draft" | "season";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  category?: NotificationCategory;
};

// Returns false when an admin has disabled notifications via the Admin panel.
// Falls back to true if no cookie context is available (e.g., cron jobs).
async function notificationsEnabled(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get("notifications_disabled")?.value !== "1";
  } catch {
    return true;
  }
}

async function sendToSubscriptions(
  subs: { endpoint: string; p256dh: string; auth: string }[],
  payload: PushPayload
) {
  await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        )
        .catch(() => null)
    )
  );
}

export async function pushToUser(discordId: string, payload: PushPayload) {
  if (!(await notificationsEnabled())) return;
  const { data } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("discord_id", discordId);
  if (data?.length) await sendToSubscriptions(data, payload);
}

export type AdminNotificationCategory =
  | "match_reporting"
  | "sub_requests"
  | "registrations"
  | "profile_changes"
  | "schedule_approvals";

export async function pushToAdmins(payload: PushPayload, adminCategory?: AdminNotificationCategory) {
  if (!(await notificationsEnabled())) return;
  // Respect per-category admin notification toggles (default on when unset).
  if (adminCategory) {
    const { data: settings } = await supabaseAdmin
      .from("league_settings")
      .select("admin_notification_prefs")
      .maybeSingle();
    const prefs = settings?.admin_notification_prefs as Record<string, boolean> | null | undefined;
    if (prefs && prefs[adminCategory] === false) return;
  }
  const { data: staff } = await supabaseAdmin
    .from("staff_roles")
    .select("discord_id");
  const ids = (staff ?? []).map((s) => s.discord_id as string).filter(Boolean);
  if (!ids.length) return;
  const { data } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("discord_id", ids);
  if (data?.length) await sendToSubscriptions(data, payload);
}

function filterByCategory(
  players: { discord_id: string; notification_prefs?: unknown }[],
  category: NotificationCategory | undefined
): string[] {
  return players
    .filter((p) => {
      if (!category) return true;
      const prefs = p.notification_prefs as Record<string, boolean> | null | undefined;
      return !prefs || prefs[category] !== false;
    })
    .map((p) => p.discord_id)
    .filter(Boolean);
}

export async function pushToAllApproved(payload: PushPayload) {
  if (!(await notificationsEnabled())) return;
  const { data: players, error } = await supabaseAdmin
    .from("players")
    .select("discord_id, notification_prefs")
    .eq("status", "approved");
  let ids: string[];
  if (error) {
    // notification_prefs column not yet migrated — fall back to all
    const { data: fb } = await supabaseAdmin.from("players").select("discord_id").eq("status", "approved");
    ids = (fb ?? []).map((p) => p.discord_id as string).filter(Boolean);
  } else {
    ids = filterByCategory(players ?? [], payload.category);
  }
  if (!ids.length) return;
  const { data } = await supabaseAdmin.from("push_subscriptions").select("endpoint, p256dh, auth").in("discord_id", ids);
  if (data?.length) await sendToSubscriptions(data, payload);
}

export async function pushToTeam(teamId: string, payload: PushPayload) {
  if (!(await notificationsEnabled())) return;
  const { data: players } = await supabaseAdmin
    .from("players")
    .select("discord_id")
    .eq("status", "approved")
    .eq("team_id", teamId);
  const ids = (players ?? []).map((p) => p.discord_id as string).filter(Boolean);
  if (!ids.length) return;
  const { data } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("discord_id", ids);
  if (data?.length) await sendToSubscriptions(data, payload);
}

export async function pushToEnteredDraft(payload: PushPayload) {
  if (!(await notificationsEnabled())) return;
  const { data: players, error } = await supabaseAdmin
    .from("players")
    .select("discord_id, notification_prefs")
    .eq("status", "approved")
    .eq("draft_entered", true);
  let ids: string[];
  if (error) {
    const { data: fb } = await supabaseAdmin.from("players").select("discord_id").eq("status", "approved").eq("draft_entered", true);
    ids = (fb ?? []).map((p) => p.discord_id as string).filter(Boolean);
  } else {
    ids = filterByCategory(players ?? [], payload.category);
  }
  if (!ids.length) return;
  const { data } = await supabaseAdmin.from("push_subscriptions").select("endpoint, p256dh, auth").in("discord_id", ids);
  if (data?.length) await sendToSubscriptions(data, payload);
}
