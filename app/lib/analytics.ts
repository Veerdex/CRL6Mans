import { supabaseAdmin } from "./supabase";

export type AnalyticsEventType = "visit" | "registration" | "draft_join";

// Best-effort append to the analytics log used by the admin Insights chart.
export async function logAnalyticsEvent(type: AnalyticsEventType): Promise<void> {
  try {
    await supabaseAdmin.from("analytics_events").insert({ type });
  } catch { /* analytics is best-effort — never block the user action */ }
}

// Drop analytics rows older than ~14 months (the chart only reads 52 weeks).
// Called opportunistically so the table doesn't grow unbounded.
export async function pruneOldAnalyticsEvents(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 14);
    await supabaseAdmin.from("analytics_events").delete().lt("created_at", cutoff.toISOString());
  } catch { /* best-effort */ }
}

// Best-effort append to the per-tab visit log used by the admin Tab Visits section.
export async function logTabVisit(tab: string): Promise<void> {
  try {
    await supabaseAdmin.from("tab_visits").insert({ tab });
  } catch { /* analytics is best-effort — never block the user action */ }
}

// Drop tab-visit rows older than 45 days (the section only reads the last 30).
export async function pruneOldTabVisits(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 45);
    await supabaseAdmin.from("tab_visits").delete().lt("created_at", cutoff.toISOString());
  } catch { /* best-effort */ }
}
