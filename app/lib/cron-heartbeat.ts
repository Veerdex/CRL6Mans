import { supabaseAdmin } from "./supabase";

// The three cron routes driven by the external per-minute pinger (cron-job.org).
// patreon-sync is deliberately absent — its route is daily-only by design.
// Shared so the routes and the admin health panel can't drift apart on column names.
export const CRON_JOBS = [
  {
    key: "scheduler",
    column: "cron_scheduler_last_run_at",
    label: "Tournament Scheduler",
    path: "/api/cron/tournament-scheduler",
    purpose: "Opens and closes signups, starts drafts and seasons, sweeps check-ins.",
  },
  {
    key: "autopick",
    column: "cron_autopick_last_run_at",
    label: "Draft Autopick",
    path: "/api/cron/draft-autopick",
    purpose: "Picks for a captain who lets the 45-second clock run out.",
  },
  {
    key: "clipreset",
    column: "cron_clipreset_last_run_at",
    label: "Clip Reset",
    path: "/api/cron/clip-reset",
    purpose: "Archives expired clips and crowns the weekly Clip of the Week.",
  },
] as const;

export type CronJobKey = (typeof CRON_JOBS)[number]["key"];

// Stamped immediately after the auth check, so it records an authenticated
// invocation rather than a successful run: a 401 returns before the handler body
// and writes nothing (which is the point — a misconfigured pinger stays invisible
// in the logs but obvious here), while a run that throws halfway still counts as
// "we were pinged". Awaited so a route that returns early can't drop the write.
export async function stampCronHeartbeat(key: CronJobKey) {
  const job = CRON_JOBS.find((j) => j.key === key)!;
  await supabaseAdmin
    .from("league_settings")
    .update({ [job.column]: new Date().toISOString() })
    .not("id", "is", null)
    .then(undefined, () => {});
}
