import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase";
import { activateTournamentRuntime } from "@/app/lib/tournament-runtime";
import { execStartDraft, execAutoBalanceTeams, execStartSeason, execPregenerateBracket, execFinalizeTeamSignups, processExpiredCheckIns, processExpiredScoreConfirmations, openReadyMatchChannels } from "@/app/lib/discord-bot";
import { pushToAllApproved, pushToAdmins, pushToEnteredDraft, pushToTournamentEntrants, pushToTournamentRoster, pushToRosteredPlayers } from "@/app/lib/push";
import { freezeUnfrozenMatchPredictions } from "@/app/lib/match-predictions";
import { cleanupOrphanedVerificationReplays } from "@/app/lib/platform-account-cleanup";
import { stampCronHeartbeat } from "@/app/lib/cron-heartbeat";

export const runtime = "nodejs";
// Draft start / team finalize can do many sequential Discord role calls, so give
// it well beyond the old 60s ceiling.
export const maxDuration = 300;

// How far ahead of a tournament's first matches the bracket is built.
const BRACKET_PREGEN_LEAD_MS = 30 * 60 * 1000;

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

  await stampCronHeartbeat("scheduler");

  const now = Date.now();
  const fired: string[] = [];
  const passed = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() <= now;

  // Auto-finalize series results unconfirmed past the confirm window (15 min for a
  // standalone season, 5 min for a discrete tournament). Applies to seasons and
  // tournaments alike, so it runs before any active-tournament gating.
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
      // signups_closed, not just signups_open: false. The two are not the same
      // flag read back — eventAcceptsLateEntries refuses to add a player unless
      // signups_closed is true, so closing by cron without it left a running
      // event unable to take late entries while an admin-closed one could.
      // It also stops the open branch above from reopening sign-ups if an admin
      // later pushes draft_close_at out.
      await supabaseAdmin.from("tournaments")
        .update({ signups_open: false, signups_closed: true, updated_at: new Date().toISOString() }).eq("id", s.id);
      fired.push(`signups_closed:${s.name}`);
      // Awaited: a push left in flight when the cron response returns is not
      // guaranteed to finish, and this one now has a real audience to reach.
      await pushToTournamentEntrants(s.id, s.join_mode, {
        title: `${s.name} Signups Closed`,
        body: s.team_assignment === "auto_balance"
          ? "Signups have closed. Teams will be generated soon."
          : "Signups have closed. The draft will begin soon.",
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

  // Weekly 250-coin pending grant during a manual season (no active tournament).
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
        // Expires when the next weekly is due, so a week away is a week missed
        // rather than a week banked. No 24h anchor here — that offset exists to
        // give lead time before an event's first matches, which is a start-grant
        // concern only.
        await supabaseAdmin
          .from("league_settings")
          .update({
            last_coin_grant_at: new Date().toISOString(),
            weekly_grant_expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
          })
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

  // ── 2b. "Starts soon" reminder, once, 24h before a tournament's first matches ──
  // Anchored on season_start_at: the sign-up and team-formation milestones already
  // have their own notifications, and this is the one players actually have to
  // show up for. Runs ahead of the activeId return because a tournament is
  // usually still `scheduled` a day out.
  //
  // Claimed with a conditional update rather than read-then-write: maxDuration is
  // 300s against a per-minute pinger, so two ticks can overlap inside one send.
  // Only the tick whose update returns a row sends.
  //
  // Before the migration the filter errors and nothing is selected, so the
  // reminder is skipped entirely — the opposite failure (reading a missing column
  // as "not yet sent") would re-send every single minute.
  const reminderWindowEnd = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const { data: dueReminders } = await supabaseAdmin
    .from("tournaments")
    .select("id, name, join_mode, season_start_at")
    .in("status", ["scheduled", "active"])
    .is("reminder_24h_sent_at", null)
    .not("season_start_at", "is", null)
    .lte("season_start_at", reminderWindowEnd)
    .gt("season_start_at", new Date(now).toISOString());

  for (const r of dueReminders ?? []) {
    const { data: claimed } = await supabaseAdmin
      .from("tournaments")
      .update({ reminder_24h_sent_at: new Date().toISOString() })
      .eq("id", r.id)
      .is("reminder_24h_sent_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const hoursOut = Math.max(
      1,
      Math.round((new Date(r.season_start_at as string).getTime() - now) / (60 * 60 * 1000))
    );
    const payload = {
      title: `${r.name} Starts Soon`,
      body: `First matches start in about ${hoursOut} ${hoursOut === 1 ? "hour" : "hours"}. Check the schedule so you don't miss yours.`,
      url: "/dashboard/schedule",
      tag: "tournament-24h",
      category: "tournament" as const,
    };
    // Awaited, not fire-and-forget: this runs in a cron response and the sends
    // would otherwise be left in flight when the route returns.
    await pushToTournamentRoster(r.id, r.join_mode, payload)
      .catch(() => { /* the claim is already stored, so this never retries */ });
    fired.push(`reminder_24h:${r.name}`);
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

  // Forming teams is a one-time milestone, so it gets a stored claim rather than
  // being inferred from runtime state. The snake draft happens to self-guard by
  // setting league_settings.draft_active, but execAutoBalanceTeams ends with
  // draft_active: false — so nothing stopped the window between draft_start_at
  // and the season start from re-forming teams on every tick, re-shuffling
  // rosters, deleting matches and re-syncing every Discord team role once a
  // minute for as long as the window stayed open.
  //
  // Claimed before the work rather than after it: maxDuration is 300s against a
  // per-minute pinger, so two ticks can overlap inside one formation and only
  // the one whose update returns a row may proceed. Released again on failure,
  // so a transient error still retries on the next tick.
  //
  // Before the migration the filter errors and no row comes back, so teams never
  // auto-form and an admin forms them by hand — deliberately the safe direction,
  // since reading a missing column as "not yet claimed" is the bug this fixes.
  const claimTeamFormation = async () => {
    const { data: claimed } = await supabaseAdmin
      .from("tournaments")
      .update({ teams_formed_at: new Date().toISOString() })
      .eq("id", t.id)
      .is("teams_formed_at", null)
      .select("id");
    return !!claimed?.length;
  };
  const releaseTeamFormation = async () => {
    await supabaseAdmin.from("tournaments").update({ teams_formed_at: null }).eq("id", t.id);
  };

  if (t.join_mode === "teams") {
    const teamsFormed = await teamsFormedCheck();
    if (passed(t.draft_close_at) && !t.teams_formed_at && !seasonActive && !teamsFormed
        && (await claimTeamFormation())) {
      const res = await execFinalizeTeamSignups();
      if (!res.ok) await releaseTeamFormation();
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
    if (passed(t.draft_start_at) && !t.teams_formed_at && !draftActive && !seasonActive
        && (await claimTeamFormation())) {
      const isAutoBalance = t.team_assignment === "auto_balance";
      const res = isAutoBalance
        ? await execAutoBalanceTeams()
        : await execStartDraft();
      if (!res.ok) await releaseTeamFormation();
      fired.push(res.ok ? `teams_formed:${t.team_assignment}` : `teams_form_failed:${res.message}`);
      if (res.ok) {
        // Auto-balance has no draft to watch — the rosters already exist — so it
        // gets its own message, and goes to the players who actually landed on a
        // team rather than to everyone who signed up.
        // Awaited for the same reason as the close push above.
        if (isAutoBalance) {
          await pushToRosteredPlayers({
            title: "Teams Generated!",
            body: "Teams are set. Head to the My Team tab to see who you're teamed up with.",
            url: "/dashboard/my-team",
            tag: "teams-generated",
            category: "draft",
          }).catch(() => {});
        } else {
          await pushToEnteredDraft({
            title: "Draft Starting!",
            body: "The draft is now live. Head to the draft page to watch your team get picked.",
            url: "/dashboard/draft",
            tag: "draft-start",
            category: "draft",
          }).catch(() => {});
        }
        pushToAdmins({
          title: isAutoBalance ? "Teams Generated!" : "Draft Starting!",
          body: isAutoBalance ? "Teams have been auto-balanced." : "The draft is now live.",
          url: isAutoBalance ? "/dashboard/teams" : "/dashboard/draft",
          tag: isAutoBalance ? "teams-generated-admin" : "draft-start-admin",
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

  // ── 3b. Build the bracket 30 minutes before the first matches ──
  // Settles the seeding while there is still time to check it, and locks adding
  // teams. Nothing reaches Discord: execPregenerateBracket opens no channel and
  // no check-in window, and both of those paths independently refuse while
  // season_active is false. The start time is passed in because the opening round
  // is stamped with it — the only time a tournament match gets, and what makes it
  // bettable for this window.
  //
  // Gated on the formation trigger being absent or past, not on teams_formed_at:
  // a field built by hand from the Teams tab never stamps that column and should
  // pre-generate like any other, but a formation scheduled *inside* this window
  // must not be pre-empted. Nothing clears a past event's team_id assignments
  // (section 3 says so explicitly), so a window that opened first would seed the
  // previous field, formation would then reshuffle the rosters underneath it, and
  // execStartSeason would not rebuild over the stamp.
  //
  // execPregenerateBracket re-reads draft_active and counts the real rosters, so a
  // formation that runs on this same tick — section 3 above, before this — either
  // makes it refuse (a draft is now live) or hands it the finished rosters. The
  // refusal releases the claim, so the next tick in the window tries again.
  //
  // Claimed before the work, like the formation claim above: maxDuration is 300s
  // against a per-minute pinger, and buildAndSaveBracket opens by deleting every
  // stage match, so two overlapping ticks would have the second wipe the first's
  // bracket. Released again on failure so a transient error retries — a failure
  // sends no push, because a 30-minute window against a per-minute pinger would
  // notify thirty times, and the start itself still reports it the way it always has.
  const formationTriggerAt = t.join_mode === "teams" ? t.draft_close_at : t.draft_start_at;
  if (t.season_start_at && !t.bracket_generated_at && !seasonActive && !draftActive
      && (!formationTriggerAt || passed(formationTriggerAt))
      && passed(new Date(new Date(t.season_start_at).getTime() - BRACKET_PREGEN_LEAD_MS).toISOString())) {
    const { data: claimed } = await supabaseAdmin
      .from("tournaments")
      .update({ bracket_generated_at: new Date().toISOString() })
      .eq("id", t.id)
      .is("bracket_generated_at", null)
      .select("id");
    if (claimed?.length) {
      const res = await execPregenerateBracket(t.season_start_at as string);
      if (!res.ok) await supabaseAdmin.from("tournaments").update({ bracket_generated_at: null }).eq("id", t.id);
      fired.push(res.ok ? "bracket_pregenerated" : `bracket_pregen_skipped:${res.message}`);
    }
  }

  if (passed(t.season_start_at) && !seasonActive && !draftActive) {
    const res = await execStartSeason();
    // Both the start-grant and the season-start push live inside execStartSeason, so
    // they fire identically whether the season is started here, via the admin
    // dashboard, or via the Discord /confirm command.
    fired.push(res.ok ? "season_started" : `season_start_failed:${res.message}`);
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
