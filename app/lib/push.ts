import webpush from "web-push";
import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase";
import { recordNotification } from "./notifications";

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL ?? "admin@crl6mans.com"}`,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export type NotificationCategory = "tournament" | "draft" | "season" | "announcement";

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

// A push service reports a permanently invalid subscription as 404 or 410. Those
// rows are deleted: nothing will ever be delivered to them again, and left alone
// they accumulate for every player who clears site data or reinstalls.
//
// Nothing else is pruned, and 400/403 deliberately are not. Those mean the VAPID
// credentials don't match the ones the subscription was created with — a server
// misconfiguration, not a dead subscription. Those endpoints start working again
// the moment the keypair is right, so deleting them would turn a recoverable
// config mistake into permanent, league-wide loss of every subscription.
const GONE_STATUSES = new Set([404, 410]);

type SendOutcome = { endpoint: string; status: number | null; failed: boolean };

// Returned so a caller can show a human what happened. The counts are the whole
// point of the admin test button: "sent" is not an answer when the interesting
// outcome is five subscriptions failing identically.
export type PushResult = {
  attempted: number;
  delivered: number;
  failed: number;
  byStatus: Record<string, number>;
  pruned: number;
  // Hosts rather than endpoints: an endpoint is a bearer capability for pushing
  // to that person's browser, and this ends up on a screen.
  failedHosts: string[];
  deliveredHosts: string[];
  // Why nothing was sent, when nothing was. Without this every reason collapses
  // into attempted: 0, and "nobody is subscribed" would be reported for a send
  // that was switched off in the caller's own browser.
  skipped?: "notifications-off" | "category-off" | "no-staff" | "no-subscriptions";
};

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unparseable";
  }
}

const EMPTY_RESULT: PushResult = {
  attempted: 0, delivered: 0, failed: 0, byStatus: {}, pruned: 0,
  failedHosts: [], deliveredHosts: [],
};

async function sendToSubscriptions(
  subs: { endpoint: string; p256dh: string; auth: string }[],
  payload: PushPayload
): Promise<PushResult> {
  const body = JSON.stringify(payload);
  const settled = await Promise.allSettled(
    subs.map(async (sub): Promise<SendOutcome> => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
        return { endpoint: sub.endpoint, status: null, failed: false };
      } catch (e) {
        return { endpoint: sub.endpoint, status: (e as { statusCode?: number })?.statusCode ?? null, failed: true };
      }
    })
  );

  const outcomes = settled
    .map((s) => (s.status === "fulfilled" ? s.value : null))
    .filter((o): o is SendOutcome => o !== null);
  const failures = outcomes.filter((o) => o.failed);

  // Counted by status rather than logged one line per failure: a single wrong
  // VAPID key fails every subscription at once, and thousands of identical
  // lines would bury the one number that matters.
  const byStatus: Record<string, number> = {};
  for (const f of failures) {
    const key = f.status === null ? "network" : String(f.status);
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }

  const result: PushResult = {
    attempted: subs.length,
    delivered: outcomes.length - failures.length,
    failed: failures.length,
    byStatus,
    pruned: 0,
    failedHosts: [...new Set(failures.map((f) => hostOf(f.endpoint)))],
    deliveredHosts: [...new Set(outcomes.filter((o) => !o.failed).map((o) => hostOf(o.endpoint)))],
  };
  if (!failures.length) return result;

  // Every other caller fires this without awaiting a result, so a failure to
  // clean up after a failure must not surface as an unhandled rejection.
  try {
    const gone = failures
      .filter((f) => f.status !== null && GONE_STATUSES.has(f.status))
      .map((f) => f.endpoint);
    if (gone.length) {
      const { error } = await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", gone);
      if (!error) result.pruned = gone.length;
    }

    console.error(
      `[push] ${failures.length}/${subs.length} deliveries failed`,
      byStatus,
      result.pruned ? `— pruned ${result.pruned} dead subscription(s)` : ""
    );
  } catch {
    /* best-effort */
  }
  return result;
}

// Every pushToX records the event in the in-app feed before sending. The record
// comes first and is never gated on notificationsEnabled(), which reads a
// per-request cookie — gating it would mean the same event is filed when a cron
// fires it and silently dropped when an admin does.
export async function pushToUser(discordId: string, payload: PushPayload) {
  await recordNotification({ kind: "users", discordIds: [discordId] }, payload);
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

// Returns a delivery summary. Callers that fire-and-forget ignore it; the admin
// test button is the one that needs to know whether anything actually landed.
export async function pushToAdmins(
  payload: PushPayload,
  adminCategory?: AdminNotificationCategory
): Promise<PushResult> {
  await recordNotification({ kind: "admins", adminCategory }, payload);
  if (!(await notificationsEnabled())) return { ...EMPTY_RESULT, skipped: "notifications-off" };
  // Respect per-category admin notification toggles (default on when unset).
  if (adminCategory) {
    const { data: settings } = await supabaseAdmin
      .from("league_settings")
      .select("admin_notification_prefs")
      .maybeSingle();
    const prefs = settings?.admin_notification_prefs as Record<string, boolean> | null | undefined;
    if (prefs && prefs[adminCategory] === false) return { ...EMPTY_RESULT, skipped: "category-off" };
  }
  const { data: staff } = await supabaseAdmin
    .from("staff_roles")
    .select("discord_id");
  const ids = (staff ?? []).map((s) => s.discord_id as string).filter(Boolean);
  if (!ids.length) return { ...EMPTY_RESULT, skipped: "no-staff" };
  const { data } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("discord_id", ids);
  if (!data?.length) return { ...EMPTY_RESULT, skipped: "no-subscriptions" };
  return sendToSubscriptions(data, payload);
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
  await recordNotification({ kind: "all" }, payload);
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

export async function pushToDiscordIds(discordIds: string[], payload: PushPayload) {
  if (!discordIds.length) return;
  await recordNotification({ kind: "users", discordIds }, payload);
  if (!(await notificationsEnabled())) return;
  const { data } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("discord_id", discordIds);
  if (data?.length) await sendToSubscriptions(data, payload);
}

export async function pushToTeam(teamId: string, payload: PushPayload) {
  await recordNotification({ kind: "team", teamId }, payload);
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
  await recordNotification({ kind: "draft" }, payload);
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
