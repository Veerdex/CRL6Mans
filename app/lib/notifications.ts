import { cache } from "react";
import { supabaseAdmin } from "./supabase";
import type { NotificationCategory, AdminNotificationCategory, PushPayload } from "./push";

export const NOTIFICATION_TTL_DAYS = 30;

export type NotificationAudience =
  | { kind: "all" }
  | { kind: "admins"; adminCategory?: AdminNotificationCategory }
  | { kind: "draft" }
  | { kind: "team"; teamId: string }
  | { kind: "users"; discordIds: string[] };

export type FeedNotification = {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  url: string | null;
  category: NotificationCategory | null;
  audience: string;
  unread: boolean;
};

// Written alongside every push, never instead of one. Deliberately NOT gated on
// push.ts's notificationsEnabled(): that reads a cookie on the current request,
// so a cron-triggered push and an admin-triggered push would disagree about
// whether the same event is worth recording, leaving unexplainable holes in the
// feed. The push is ephemeral; this row is the record.
export async function recordNotification(audience: NotificationAudience, payload: PushPayload) {
  const expiresAt = new Date(Date.now() + NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await supabaseAdmin
    .from("notifications")
    .insert({
      title: payload.title,
      body: payload.body,
      url: payload.url ?? null,
      category: payload.category ?? null,
      admin_category: audience.kind === "admins" ? (audience.adminCategory ?? null) : null,
      audience: audience.kind,
      team_id: audience.kind === "team" ? audience.teamId : null,
      discord_ids: audience.kind === "users" ? audience.discordIds : null,
      expires_at: expiresAt.toISOString(),
    })
    .then(undefined, () => {});
}

type Viewer = {
  discordId: string;
  isStaff: boolean;
  teamId: string | null;
  draftEntered: boolean;
  categoryPrefs: Record<string, boolean> | null;
  adminPrefs: Record<string, boolean> | null;
  readAt: string | null;
};

// Everything the feed needs about the viewer, resolved once so the count and the
// list can't be computed against different answers.
async function loadViewer(discordId: string): Promise<Viewer> {
  const [account, player, staff, settings] = await Promise.all([
    supabaseAdmin.from("accounts").select("notifications_read_at").eq("discord_id", discordId).maybeSingle(),
    supabaseAdmin.from("players").select("team_id, draft_entered, notification_prefs").eq("discord_id", discordId).maybeSingle(),
    supabaseAdmin.from("staff_roles").select("role").eq("discord_id", discordId).maybeSingle(),
    supabaseAdmin.from("league_settings").select("admin_notification_prefs").maybeSingle(),
  ]);

  return {
    discordId,
    isStaff: !!staff.data,
    teamId: (player.data?.team_id as string | null) ?? null,
    draftEntered: !!player.data?.draft_entered,
    categoryPrefs: (player.data?.notification_prefs as Record<string, boolean> | null) ?? null,
    adminPrefs: (settings.data?.admin_notification_prefs as Record<string, boolean> | null) ?? null,
    readAt: (account.data?.notifications_read_at as string | null) ?? null,
  };
}

type Row = {
  id: string;
  created_at: string;
  title: string;
  body: string;
  url: string | null;
  category: string | null;
  admin_category: string | null;
  audience: string;
  team_id: string | null;
  discord_ids: string[] | null;
};

// The single visibility rule. Audience matching can't be pushed into the query
// cleanly (a team row and a users row test different columns), and the
// preference filters have to happen here anyway because shared rows carry no
// per-player state — so both the badge count and the page run the same fetch and
// the same filter rather than two hand-rolled WHERE clauses that drift apart.
function visibleTo(viewer: Viewer, row: Row): boolean {
  switch (row.audience) {
    case "all":
      break;
    case "admins":
      if (!viewer.isStaff) return false;
      if (row.admin_category && viewer.adminPrefs?.[row.admin_category] === false) return false;
      return true;
    case "draft":
      if (!viewer.draftEntered) return false;
      break;
    case "team":
      if (!viewer.teamId || row.team_id !== viewer.teamId) return false;
      break;
    case "users":
      if (!row.discord_ids?.includes(viewer.discordId)) return false;
      break;
    default:
      return false;
  }
  // Admin rows return above — their prefs live in a different enum.
  if (row.category && viewer.categoryPrefs?.[row.category] === false) return false;
  return true;
}

const FEED_LIMIT = 100;

// Per-request memo: on /dashboard the layout renders the nav badge and the page
// renders the mobile bell, and both want the same count. Without this they'd each
// run the viewer lookups and the feed query.
const fetchVisible = cache(async function fetchVisible(
  discordId: string,
): Promise<{ viewer: Viewer; rows: Row[] }> {
  const viewer = await loadViewer(discordId);
  const { data } = await supabaseAdmin
    .from("notifications")
    .select("id, created_at, title, body, url, category, admin_category, audience, team_id, discord_ids")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);

  const rows = ((data ?? []) as Row[]).filter((r) => visibleTo(viewer, r));
  return { viewer, rows };
});

function isUnread(viewer: Viewer, row: Row): boolean {
  if (!viewer.readAt) return true;
  return new Date(row.created_at).getTime() > new Date(viewer.readAt).getTime();
}

export async function getNotificationFeed(discordId: string): Promise<FeedNotification[]> {
  const { viewer, rows } = await fetchVisible(discordId);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    title: r.title,
    body: r.body,
    url: r.url,
    category: r.category as NotificationCategory | null,
    audience: r.audience,
    unread: isUnread(viewer, r),
  }));
}

export async function getUnreadCount(discordId: string): Promise<number> {
  const { viewer, rows } = await fetchVisible(discordId);
  return rows.filter((r) => isUnread(viewer, r)).length;
}

export async function markNotificationsRead(discordId: string) {
  await supabaseAdmin
    .from("accounts")
    .update({ notifications_read_at: new Date().toISOString() })
    .eq("discord_id", discordId)
    .then(undefined, () => {});
}

// Called from the clip-reset cron, which already sweeps expired rows every minute.
export async function deleteExpiredNotifications(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("notifications")
    .delete()
    .lte("expires_at", new Date().toISOString())
    .select("id");
  return data?.length ?? 0;
}
