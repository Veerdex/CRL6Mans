import { supabaseAdmin } from "@/app/lib/supabase";
import { CRON_JOBS } from "@/app/lib/cron-heartbeat";
import { AdminSubSection } from "./admin-sub-section";
import { CronHealthRows, type CronHealthRow } from "./cron-health-rows";

// Read live on every render, deliberately uncached: the whole point is the age of
// the newest write, and a cached read would serve a stale one. It's a single
// select on a one-row table, unlike the billed measurements in StorageUsageSection.
export async function CronHealthSection() {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select(`active_tournament_id, ${CRON_JOBS.map((j) => j.column).join(", ")}`)
    .single();

  const row = data as Record<string, string | null> | null;

  const rows: CronHealthRow[] = CRON_JOBS.map((j) => ({
    key: j.key,
    label: j.label,
    path: j.path,
    purpose: j.purpose,
    lastRunAt: row?.[j.column] ?? null,
  }));

  const eventActive = !!row?.active_tournament_id;
  const stale = rows.filter(
    (r) => !r.lastRunAt || Date.now() - new Date(r.lastRunAt).getTime() >= 15 * 60 * 1000,
  );

  return (
    <AdminSubSection
      sectionId="data"
      tabId="cron-health"
      title="Cron Health"
      notification={eventActive && stale.length ? stale.length : undefined}
      description="When each scheduled job was last reached by the external per-minute pinger. Green is under 3 minutes, amber under 15."
    >
      <div className="space-y-4">
        {eventActive && stale.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4">
            <p className="text-red-400 font-semibold">
              {stale.length === 1 ? "A job is" : `${stale.length} jobs are`} stale during a live event
            </p>
            <p className="text-sm text-zinc-400 mt-1">
              {stale.map((s) => s.label).join(", ")} — drafts, season starts and check-in
              forfeits will not fire on time. Check the job&apos;s execution history on cron-job.org;
              a wrong <code className="text-zinc-300">Authorization</code> header returns 401 and
              records no heartbeat at all.
            </p>
          </div>
        )}

        <CronHealthRows rows={rows} />

        <p className="text-xs text-zinc-500 leading-relaxed">
          A heartbeat records an <strong className="text-zinc-400">authenticated invocation</strong>,
          not a successful run — a job that is reached and then throws still reads green, so check
          the Vercel logs for errors. Vercel&apos;s own daily crons in{" "}
          <code className="text-zinc-400">vercel.json</code> carry the same secret and stamp these
          too, so a timestamp that is hours rather than days old means the per-minute pinger is down
          while the daily fallback still runs.
        </p>
      </div>
    </AdminSubSection>
  );
}
