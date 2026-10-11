// Pure leaf: the admin notification categories, and what an unset preference
// means for each. Four places have to agree on that answer — push.ts gates the
// send, notifications.ts gates the in-app feed row, setAdminNotificationPref
// refuses an unknown key, and the toggles UI has to render the same default the
// server will apply. Four hand-rolled copies is how a switch ends up drawn ON
// while the server treats it as off, and the first click writes `false` to a
// pref that was already off.

export const ADMIN_NOTIFICATION_CATEGORIES = [
  "sub_requests",
  "match_disputes",
  "registrations",
  "profile_changes",
  "schedule_approvals",
  "test_tournaments",
] as const;

// Deliberately not the old "match_reporting" key, which match_disputes replaces.
// setAdminNotificationPref only ever writes keys into admin_notification_prefs
// and never deletes them, so any staff member who muted the retired
// every-submission push left `match_reporting: false` sitting in that jsonb —
// reusing the name would hand them disputes pre-muted by a choice they made
// about a different notification. The stale key is inert: nothing passes it.
export type AdminNotificationCategory = (typeof ADMIN_NOTIFICATION_CATEGORIES)[number];

// Every category is on until a staff member turns it off — except this one. A
// test tournament's notifications are noise to anyone who isn't running the
// test, so an unset pref means off and only an explicit `true` opts in.
const DEFAULT_OFF = new Set<string>(["test_tournaments"]);

export function adminCategoryDefaultsOn(category: string): boolean {
  return !DEFAULT_OFF.has(category);
}

// typeof rather than `?? default`: this reads a jsonb column, where a key can
// come back holding null, and null is not the same as "never set" to `??`.
export function adminCategoryEnabled(
  prefs: Record<string, boolean> | null | undefined,
  category: string
): boolean {
  const stored = prefs?.[category];
  return typeof stored === "boolean" ? stored : adminCategoryDefaultsOn(category);
}
