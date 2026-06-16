import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase";
import { activateTournamentRuntime } from "@/app/lib/tournament-runtime";
import { execStartDraft, execAutoBalanceTeams, execStartSeason, execFinalizeTeamSignups } from "@/app/lib/discord-bot";
import { pushToAllApproved, pushToAdmins, pushToEnteredDraft } from "@/app/lib/push";

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
    .select("active_tournament_id, draft_active, season_active")
    .single();
  let activeId = settings?.active_tournament_id as string | null | undefined;

  if (!activeId && !settings?.draft_active && !settings?.season_active) {
    const due = (scheduled ?? []).find((t) =>
      t.join_mode === "players" ? passed(t.draft_start_at) : passed(t.draft_close_at)
    );
    if (due) {
      const res = await activateTournamentRuntime(due.id);
      if (res.ok) { activeId = due.id; fired.push(`activated:${due.name}`); }
      else fired.push(`activate_failed:${res.error}`);
    }
  }

  if (!activeId) return NextResponse.json({ ok: true, fired });

  // ── 3. Advance the active tournament ──
  const { data: t } = await supabaseAdmin.from("tournaments").select("*").eq("id", activeId).single();
  if (!t) return NextResponse.json({ ok: true, fired });

  const { data: live } = await supabaseAdmin
    .from("league_settings").select("draft_active, season_active").single();
  const draftActive = live?.draft_active ?? false;
  const seasonActive = live?.season_active ?? false;

  const { count: rosterCount } = await supabaseAdmin
    .from("players").select("*", { count: "exact", head: true }).not("team_id", "is", null);
  const teamsFormed = (rosterCount ?? 0) > 0;

  if (t.join_mode === "teams") {
    if (passed(t.draft_close_at) && !seasonActive && !teamsFormed) {
      const res = await execFinalizeTeamSignups();
      fired.push(res.ok ? "teams_finalized" : `teams_finalize_failed:${res.message}`);
    }
  } else {
    // player-signup: form teams via snake draft or auto-balance
    if (passed(t.draft_start_at) && !draftActive && !seasonActive && !teamsFormed) {
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
      }
    }
  }

  if (passed(t.season_start_at) && !seasonActive && !draftActive) {
    const res = await execStartSeason();
    fired.push(res.ok ? "season_started" : `season_start_failed:${res.message}`);
    if (res.ok) {
      pushToAllApproved({
        title: "Season Started!",
        body: "The season is now live. Check the schedule for your upcoming matches.",
        url: "/dashboard/season",
        tag: "season-start",
        category: "season",
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, fired });
}
