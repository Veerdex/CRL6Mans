import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase";
import { activateTournamentRuntime } from "@/app/lib/tournament-runtime";
import { execStartDraft, execAutoBalanceTeams, execStartSeason, execFinalizeTeamSignups, processExpiredCheckIns, processExpiredScoreConfirmations, openReadyMatchChannels } from "@/app/lib/discord-bot";
import { pushToAllApproved, pushToAdmins, pushToEnteredDraft } from "@/app/lib/push";
import { freezeUnfrozenMatchPredictions } from "@/app/lib/match-predictions";
import { cleanupOrphanedVerificationReplays } from "@/app/lib/platform-account-cleanup";

export const runtime = "nodejs";
// Draft start / team finalize can do many sequential Discord role calls, so give
// it well beyond the old 60s ceiling.
export const maxDuration = 300;

// Runs frequently (external pinger every minute) to advance tournaments through
// their lifecycle. "Open to join" (signups_open) is independent of the single
// active tournament, so several tournaments can open/close while one runs.
// Every transition is idempotent — guarded by state flags — so re-runs are safe.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const fired: string[] = [];
  const passed = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() <= now;

  // Auto-finalize series results unconfirmed past the 5-minute window. Applies to
  // seasons and tournaments alike, so it runs before any active-tournament gating.
  try {
    await processExpiredScoreConfirmations();
  } catch { /* best-effort */ }

  // Freeze wagers-grid win% for any match that just got both teams assigned,
  // before it's ever played.
  try {
    await freezeUnfrozenMatchPredictions();
  } catch { /* best-effort */ }

  // ── 1. Open/close sign-ups for every scheduled tournament (no runtime impact) ──
  const { data: scheduled } = await supabaseAdmin
    .from("tournaments")
    .select("*")
    .eq("status", "scheduled")
    .order("created_at", { ascending: true });

  for (const s of scheduled ?? []) {
    if (!s.signups_open && !s.signups_closed && passed(s.draft_open_at) && !passed(s.draft_close_at)) {
      await supabaseAdmin.from("tournaments")
        .update({ signups_open: true, updated_at: new Date().toISOString() }).eq("id", s.id);
      fired.push(`signups_opened:${s.name}`);
      pushToAllApproved({
        title: `${s.name} Signups Open`,
        body: "Sign up now before the deadline closes.",
        url: "/dashboard",
        tag: "signups-open",
        category: "tournament",
      }).catch(() => {});
    } else if (s.signups_open && passed(s.draft_close_at)) {
      await supabaseAdmin.from("tournaments")
        .update({ signups_open: false, updated_at: new Date().toISOString() }).eq("id", s.id);
      fired.push(`signups_closed:${s.name}`);
      pushToEnteredDraft({
        title: `${s.name} Signups Closed`,
        body: "Signups have closed. The draft will begin soon.",
        url: "/dashboard",
        tag: "signups-closed",
        category: "tournament",
      }).catch(() => {});
      pushToAdmins({
        title: `${s.name} Signups Closed`,
        body: "Tournament signups have closed.",
        url: "/dashboard/admin",
        tag: "signups-closed-admin",
      }).catch(() => {});
    }
  }

  // ── 2. Activation: promote a due tournament to the single live one ──
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("active_tournament_id, draft_active, season_active, last_coin_grant_at, is_test_season, last_platform_replay_cleanup_at")
    .single();
  let activeId = settings?.active_tournament_id as string | null | undefined;
  const lastCoinGrantAt = (settings?.last_coin_grant_at as string | null | undefined) ?? null;

  if (!activeId && !settings?.draft_active && !settings?.season_active) {
    const due = (scheduled ?? []).find((t) =>
      t.join_mode === "players" ? passed(t.draft_start_at) : passed(t.draft_close_at)
    );
    if (due) {
      const res = await activateTournamentRuntime(due.id);
      if (res.ok) { activeId = due.id; fired.push(`activated:${due.name}`); }
      else {
        fired.push(`activate_failed:${res.error}`);
        pushToAdmins({
          title: "Tournament activation failed",
          body: `Could not activate ${due.name}: ${res.error}`,
          url: "/dashboard/admin",
          tag: "autostart-failed",
        }).catch(() => {});
      }
    }
  }

  // Weekly 1000-coin pending grant during a manual season (no active tournament).
  // Tournaments only get the one-time start grant — no weekly coins.
  // Skipped entirely for test seasons.
  if (settings?.season_active && !activeId && !settings?.is_test_season) {
    const lastGrantTime = lastCoinGrantAt ? new Date(lastCoinGrantAt).getTime() : 0;
    if (now - lastGrantTime >= 7 * 24 * 60 * 60 * 1000) {
      try {
        // Flagged on accounts (Tier 1) so unregistered/pending guests get the
        // weekly grant too — only "rejected" is excluded, matching the
        // wagering gate (accounts.status !== "rejected").
        await supabaseAdmin
          .from("accounts")
          .update({ coin_grant_pending_weekly: true })
          .in("status", ["unregistered", "pending", "approved"]);
        await supabaseAdmin
          .from("league_settings")
          .update({ last_coin_grant_at: new Date().toISOString() })
          .not("id", "is", null);
        fired.push("weekly_coins_pending");
      } catch { /* best-effort */ }
    }
  }

  // Sweep orphaned platform-verification-replay uploads at most every 6 hours —
  // no need to hit storage on every per-minute tick.
  const lastCleanupAt = (settings?.last_platform_replay_cleanup_at as string | null | undefined) ?? null;
  if (!lastCleanupAt || now - new Date(lastCleanupAt).getTime() >= 6 * 60 * 60 * 1000) {
    try {
      const { removed } = await cleanupOrphanedVerificationReplays();
      if (removed) fired.push(`replay_cleanup:${removed}`);
      await supabaseAdmin.from("league_settings")
        .update({ last_platform_replay_cleanup_at: new Date().toISOString() })
        .not("id", "is", null);
    } catch { /* best-effort */ }
  }

  if (!activeId) return NextResponse.json({ ok: true, fired });

  // ── 3. Advance the active tournament ──
  const { data: t } = await supabaseAdmin.from("tournaments").select("*").eq("id", activeId).single();
  if (!t) return NextResponse.json({ ok: true, fired });

  const { data: live } = await supabaseAdmin
    .from("league_settings").select("draft_active, season_active").single();
  const draftActive = live?.draft_active ?? false;
  const seasonActive = live?.season_active ?? false;

  // For teams-mode: check if any player has a team_id (teams already formed).
  // For players-mode: check if a draft is already underway by checking draft_active
  // directly rather than team_id — leftover team_ids from a previous season would
  // otherwise prevent the new draft from ever auto-starting.
  const teamsFormedCheck = async () => {
    const { count } = await supabaseAdmin
      .from("players").select("*", { count: "exact", head: true }).not("team_id", "is", null);
    return (count ?? 0) > 0;
  };

  if (t.join_mode === "teams") {
    const teamsFormed = await teamsFormedCheck();
    if (passed(t.draft_close_at) && !seasonActive && !teamsFormed) {
      const res = await execFinalizeTeamSignups();
      fired.push(res.ok ? "teams_finalized" : `teams_finalize_failed:${res.message}`);
      if (!res.ok) {
        pushToAdmins({
          title: "Tournament auto-start failed",
          body: `Could not finalize teams: ${res.message}`,
          url: "/dashboard/admin",
          tag: "autostart-failed",
        }).catch(() => {});
      }
    }
  } else {
    // player-signup: form teams via snake draft or auto-balance.
    // Guard: don't re-run if a draft is actively in progress or season has started.
    // We intentionally do NOT gate on team_id here — execStartDraft clears all team
    // assignments before forming new ones, and leftover ids from a past season would
    // permanently block the auto-start.
    if (passed(t.draft_start_at) && !draftActive && !seasonActive) {
      const res = t.team_assignment === "auto_balance"
        ? await execAutoBalanceTeams()
        : await execStartDraft();
      fired.push(res.ok ? `teams_formed:${t.team_assignment}` : `teams_form_failed:${res.message}`);
      if (res.ok) {
        pushToEnteredDraft({
          title: "Draft Starting!",
          body: "The draft is now live. Head to the draft page to watch your team get picked.",
          url: "/dashboard/draft",
          tag: "draft-start",
          category: "draft",
        }).catch(() => {});
        pushToAdmins({
          title: "Draft Starting!",
          body: "The draft is now live.",
          url: "/dashboard/draft",
          tag: "draft-start-admin",
        }).catch(() => {});
      } else {
        pushToAdmins({
          title: "Tournament auto-start failed",
          body: `Could not start draft: ${res.message}`,
          url: "/dashboard/admin",
          tag: "autostart-failed",
        }).catch(() => {});
      }
    }
  }

  if (passed(t.season_start_at) && !seasonActive && !draftActive) {
    const res = await execStartSeason();
    fired.push(res.ok ? "season_started" : `season_start_failed:${res.message}`);
    if (res.ok) {
      // Start-grant (coin_grant_pending_start) is set inside execStartSeason itself
      // so it fires identically whether the season is started here, via the admin
      // dashboard, or via the Discord /confirm command.
      pushToAllApproved({
        title: "Season Started!",
        body: "The season is now live. Check the schedule for your upcoming matches.",
        url: "/dashboard/season",
        tag: "season-start",
        category: "season",
      }).catch(() => {});
    }
  }

  // ── 4. Tournament check-in: DQ expired windows + open ready channels ──
  if (seasonActive) {
    try {
      await processExpiredCheckIns();
      await openReadyMatchChannels();
      fired.push("checkins_processed");
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true, fired });
}
