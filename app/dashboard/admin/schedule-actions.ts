"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { openReadyMatchChannels } from "@/app/lib/discord-bot";
import { type ScheduleType, stageName, expectedStageRounds, canonicalStage } from "./schedule-utils";
import { zonedDate, wallToUtc, shiftWall } from "@/app/lib/pt-time";

// Fallback zone when a client doesn't supply one (e.g. a non-browser caller).
const FALLBACK_TZ = "America/Los_Angeles";

// Sequential phase rank for a canonical stage. Stages within the same phase
// (e.g. DE winners/losers/grand final, or hybrid sub-brackets) run concurrently,
// so ordering is enforced *between* phases, not between stages in the same phase.
function phaseRank(canonStage: string): number {
  if (canonStage === "group") return 0;
  if (canonStage === "se_qualifier" || canonStage === "deq_winners" || canonStage === "deq_losers") return 1;
  if (canonStage === "swiss") return 2;
  return 3; // single_elimination, de_*, hybrid_* — the final bracket phase
}

async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");
}

// All window math is done in the scheduling admin's local zone (`tz`) — the app has
// no single canonical zone. Times are stored as absolute UTC instants, so once saved
// they display correctly in every viewer's own zone.
function computeDeadlineAt(
  playAtMs: number,
  scheduleType: ScheduleType,
  rangeDays: number | null,
  tz: string,
): string {
  // A specific time has no window — the exact time is both play and deadline.
  if (scheduleType === "specific") return new Date(playAtMs).toISOString();

  // Range: 23:59 on the last day of the range (rangeDays counted from the start day).
  const play = zonedDate(tz, playAtMs); // UTC getters return wall-clock fields in `tz`
  const days = rangeDays ?? 1;
  return new Date(
    wallToUtc(tz, play.getUTCFullYear(), play.getUTCMonth(), play.getUTCDate() + (days - 1), 23, 59),
  ).toISOString();
}

// Play time a "follow" produces: the next round starts when the previous round's
// window ends. A range result is anchored to 12:00 AM in `tz` so chain
// detection matches storage.
function inferredPlayAtMs(prevMs: number, prevType: string, prevRangeDays: number | null, nextType: string, tz: string): number {
  const ms = prevMs + windowLenMs(prevType, prevRangeDays);
  if (nextType !== "specific") {
    const d = zonedDate(tz, ms);
    return wallToUtc(tz, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0);
  }
  return ms;
}

// How long a round occupies, so later rounds can't overlap it. A window type (range
// or weekly) fills its day count, and a specific time is an instant (no window).
function windowLenMs(type: string, rangeDays: number | null): number {
  if (type !== "specific") return (rangeDays ?? 1) * 86_400_000;
  return 0; // specific
}

// Start of a round's window: a window type begins at 12:00 AM of the play day.
function windowStartMs(playMs: number, type: string, tz: string): number {
  if (type !== "specific") {
    const d = zonedDate(tz, playMs);
    return wallToUtc(tz, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0);
  }
  return playMs; // specific
}

function parseDateInZone(dateStr: string, hour: number, tz: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return wallToUtc(tz, y, m - 1, d, hour, 0);
}

function parseDateTimeInZone(dtStr: string, tz: string): number {
  const [dateStr, timeStr] = dtStr.split("T");
  const [h, min] = timeStr.split(":").map(Number);
  const [y, m, d] = dateStr.split("-").map(Number);
  return wallToUtc(tz, y, m - 1, d, h, min);
}

async function isRoundLocked(canonStage: string, round: number): Promise<boolean> {
  let q = supabaseAdmin
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("round", round)
    .not("discord_channel_id", "is", null);
  if (canonStage === "group") {
    q = q.like("stage", "group_%");
  } else {
    q = q.eq("stage", canonStage);
  }
  const { count } = await q;
  return (count ?? 0) > 0;
}

// Fetch the match rows of a canonical (stage, round) — group spans group_% sub-stages.
async function fetchRoundMatches(canonStage: string, round: number) {
  const base = supabaseAdmin
    .from("matches")
    .select("id, scheduled_at, admin_scheduled, schedule_proposed_by_team_id");
  const { data } = canonStage === "group"
    ? await base.like("stage", "group_%").eq("round", round)
    : await base.eq("stage", canonStage).eq("round", round);
  return (data ?? []) as {
    id: string; scheduled_at: string | null; admin_scheduled: boolean; schedule_proposed_by_team_id: string | null;
  }[];
}

// Reconcile per-match times when a round's window/type is (re)set:
//  • specific            → pin every match to the exact time (auto-confirmed)
//  • window, type changed → reset admin pins to undecided, clear non-negotiated times
//  • window, same type    → shift each admin-pinned match by the window move delta
async function syncRoundMatchPins(
  canonStage: string,
  round: number,
  newType: string,
  newPlayMs: number,
  newRangeDays: number | null,
  oldType: string | null,
  oldPlayMs: number | null,
  oldRangeDays: number | null,
  tz: string,
): Promise<void> {
  const matches = await fetchRoundMatches(canonStage, round);
  if (!matches.length) return;

  if (newType === "specific") {
    await supabaseAdmin
      .from("matches")
      .update({
        scheduled_at: new Date(newPlayMs).toISOString(),
        admin_scheduled: true,
        schedule_accepted: true,
        schedule_proposed_by_team_id: null,
        schedule_admin_required: false,
      })
      .in("id", matches.map((m) => m.id));
    return;
  }

  const typeChanged = oldType !== null && oldType !== newType;
  if (oldType === null || typeChanged) {
    // Reset any admin pins to undecided …
    const pinnedIds = matches.filter((m) => m.admin_scheduled).map((m) => m.id);
    if (pinnedIds.length)
      await supabaseAdmin.from("matches")
        .update({ scheduled_at: null, admin_scheduled: false, schedule_accepted: false })
        .in("id", pinnedIds);
    // … and clear any non-pinned, non-negotiated stamped time.
    const clearIds = matches.filter((m) => !m.admin_scheduled && !m.schedule_proposed_by_team_id).map((m) => m.id);
    if (clearIds.length)
      await supabaseAdmin.from("matches").update({ scheduled_at: null }).in("id", clearIds);
    return;
  }

  // Same window type → re-anchor pinned matches to the new window start, preserving
  // their weekday + clock time (DST-correct; not a raw millisecond shift). A shrinking
  // range can then leave a pin past the new deadline — reset those to undecided rather
  // than leaving a stale out-of-window time.
  const oldStart = windowStartMs(oldPlayMs!, oldType!, tz);
  const newStart = windowStartMs(newPlayMs, newType, tz);
  const newEnd = newStart + windowLenMs(newType, newRangeDays);
  const resetIds: string[] = [];
  for (const m of matches) {
    if (!m.admin_scheduled || !m.scheduled_at) continue;
    const origMs = new Date(m.scheduled_at).getTime();
    const shiftedMs = oldStart !== newStart ? shiftWall(tz, origMs, oldStart, newStart) : origMs;
    if (shiftedMs < newStart || shiftedMs > newEnd) {
      resetIds.push(m.id);
    } else if (shiftedMs !== origMs) {
      await supabaseAdmin.from("matches")
        .update({ scheduled_at: new Date(shiftedMs).toISOString() })
        .eq("id", m.id);
    }
  }
  if (resetIds.length)
    await supabaseAdmin.from("matches")
      .update({ scheduled_at: null, admin_scheduled: false, schedule_accepted: false })
      .in("id", resetIds);
  // Ensure non-pinned, non-negotiated matches carry no stamped time.
  const clearIds = matches.filter((m) => !m.admin_scheduled && !m.schedule_proposed_by_team_id && m.scheduled_at).map((m) => m.id);
  if (clearIds.length)
    await supabaseAdmin.from("matches").update({ scheduled_at: null }).in("id", clearIds);
}

export async function setRoundSchedule(params: {
  tournamentId: string | null;
  stage: string; // canonical stage
  round: number;
  scheduleType: ScheduleType;
  rangeDays: number | null; // day count for "range"; ignored/null for "specific"
  dateStr: string; // empty = infer from previous round
  timeZone?: string; // the admin's IANA zone; dates are read in it
}): Promise<{ ok: boolean; error?: string }> {
  await verifyAdmin();

  const { tournamentId, stage, round, scheduleType, dateStr } = params;
  const rangeDays = scheduleType === "range" ? Math.max(1, Math.floor(params.rangeDays ?? 1))
    : scheduleType === "weekly" ? 7
    : null;
  const tz = params.timeZone || FALLBACK_TZ;

  if (await isRoundLocked(stage, round)) {
    return { ok: false, error: "This round has started and can no longer be edited." };
  }

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("match_play_hour, match_deadline_day, season_format, num_teams")
    .single();
  const playHour = (settings?.match_play_hour as number | null) ?? 19;

  // A weekly round's start day is anchored to the league's standard weekly cadence —
  // it must fall the day after the configured match deadline day (e.g. deadline
  // Tuesday → weekly rounds start Wednesday). Only checked for an explicit date;
  // a chained ("Follow") start is trusted since it derives from the prior round.
  if (scheduleType === "weekly" && dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const deadlineDay = (settings?.match_deadline_day as number | null) ?? 2;
    const requiredWeekday = (deadlineDay + 1) % 7;
    if (weekday !== requiredWeekday) {
      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return {
        ok: false,
        error: `Weekly rounds must start on ${names[requiredWeekday]} — the day after the match deadline day (${names[deadlineDay]}).`,
      };
    }
  }

  // Stages that belong to the current format — used to ignore stale round_schedules
  // rows left over from a previously-configured format when checking ordering.
  const sf = settings?.season_format as { preset?: string; groupMaxAdvancing?: number | null } | null;
  const validStages = new Set<string>(
    sf?.preset
      ? expectedStageRounds(sf.preset, (settings?.num_teams as number) ?? 0, sf.groupMaxAdvancing ?? null).map((s) => s.stage)
      : [],
  );

  let playAtMs: number;

  if (!dateStr) {
    if (round <= 1) return { ok: false, error: "The first round requires an explicit date." };
    const prevQ = tournamentId
      ? supabaseAdmin.from("round_schedules").select("play_at, schedule_type, range_days").eq("tournament_id", tournamentId).eq("stage", stage).eq("round", round - 1).maybeSingle()
      : supabaseAdmin.from("round_schedules").select("play_at, schedule_type, range_days").is("tournament_id", null).eq("stage", stage).eq("round", round - 1).maybeSingle();
    const { data: prev } = await prevQ;
    if (!prev) return { ok: false, error: "Cannot infer: previous round has no schedule set." };
    // Start when the previous round's window ends (its window length, not ours).
    playAtMs = new Date(prev.play_at as string).getTime() + windowLenMs(prev.schedule_type as string, prev.range_days as number | null);
  } else if (scheduleType === "specific") {
    playAtMs = parseDateTimeInZone(dateStr, tz);
  } else {
    playAtMs = parseDateInZone(dateStr, playHour, tz);
  }

  if (isNaN(playAtMs)) return { ok: false, error: "Invalid date." };

  // A window round (range or weekly) is a time *window*, not a fixed kickoff, so anchor
  // play_at to the start of the day (12:00 AM) in the admin's zone. Deadline is the
  // window's last day at 11:59 PM. (Also re-anchors a chained "follow" whose inferred
  // time carried a stale hour.)
  if (scheduleType !== "specific") {
    const d = zonedDate(tz, playAtMs);
    playAtMs = wallToUtc(tz, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0);
  }

  // Old play_at of this round — needed both to detect downstream chained rounds and
  // to exclude them from the ordering check below (the cascade will shift them).
  const oldQ = tournamentId
    ? supabaseAdmin.from("round_schedules").select("play_at, schedule_type, range_days").eq("tournament_id", tournamentId).eq("stage", stage).eq("round", round).maybeSingle()
    : supabaseAdmin.from("round_schedules").select("play_at, schedule_type, range_days").is("tournament_id", null).eq("stage", stage).eq("round", round).maybeSingle();
  const { data: oldSchedule } = await oldQ;

  // Enforce global ordering against every other scheduled round:
  //  • same stage  → strict round monotonicity (earlier rounds before, later rounds after)
  //  • earlier/later phase → must sit entirely before/after this round
  //  • same phase, different stage (concurrent sub-brackets) → no constraint
  {
    const allQ = tournamentId
      ? supabaseAdmin.from("round_schedules").select("stage, round, play_at, schedule_type, range_days").eq("tournament_id", tournamentId)
      : supabaseAdmin.from("round_schedules").select("stage, round, play_at, schedule_type, range_days").is("tournament_id", null);
    const { data: others } = await allQ;
    const myPhase = phaseRank(stage);

    // Downstream same-stage rounds chained off this one are shifted by the cascade,
    // so they must not block moving this round later.
    const chainedDownstream = new Set<number>();
    if (oldSchedule?.play_at) {
      const sameStage = new Map<number, { ms: number; type: string; rangeDays: number | null }>();
      for (const o of others ?? []) {
        if ((o.stage as string) === stage)
          sameStage.set(o.round as number, { ms: new Date(o.play_at as string).getTime(), type: o.schedule_type as string, rangeDays: o.range_days as number | null });
      }
      let prevOldMs = new Date(oldSchedule.play_at as string).getTime();
      let prevType = sameStage.get(round)?.type ?? scheduleType;
      let prevRangeDays = sameStage.get(round)?.rangeDays ?? rangeDays;
      let r = round + 1;
      for (;;) {
        const nxt = sameStage.get(r);
        if (!nxt) break;
        if (Math.abs(nxt.ms - inferredPlayAtMs(prevOldMs, prevType, prevRangeDays, nxt.type, tz)) >= 60_000) break;
        chainedDownstream.add(r);
        prevOldMs = nxt.ms;
        prevType = nxt.type;
        prevRangeDays = nxt.rangeDays;
        r++;
      }
    }

    // Order by each round's *window* (start .. start + window length), so a later
    // round can't start until the previous round's window has ended (and vice-versa).
    const myStartMs = windowStartMs(playAtMs, scheduleType, tz);
    const myEndMs = myStartMs + windowLenMs(scheduleType, rangeDays);
    for (const o of others ?? []) {
      const oStage = o.stage as string;
      const oRound = o.round as number;
      if (oStage === stage && oRound === round) continue; // skip the row being edited
      // Ignore stale rows from a different format (not part of the current stages).
      if (validStages.size > 0 && oStage !== stage && !validStages.has(oStage)) continue;
      const oStartMs = windowStartMs(new Date(o.play_at as string).getTime(), o.schedule_type as string, tz);
      const oEndMs = oStartMs + windowLenMs(o.schedule_type as string, o.range_days as number | null);

      if (oStage === stage) {
        if (oRound < round && oEndMs > myStartMs)
          return { ok: false, error: `Must start after ${stageName(stage)} round ${oRound}'s window ends.` };
        if (oRound > round && !chainedDownstream.has(oRound) && myEndMs > oStartMs)
          return { ok: false, error: `Must finish before ${stageName(stage)} round ${oRound} begins.` };
      } else {
        const oPhase = phaseRank(oStage);
        if (oPhase < myPhase && oEndMs > myStartMs)
          return { ok: false, error: `Must start after the ${stageName(oStage)} stage finishes.` };
        if (oPhase > myPhase && myEndMs > oStartMs)
          return { ok: false, error: `Must finish before the ${stageName(oStage)} stage begins.` };
      }
    }
  }

  const playAt = new Date(playAtMs).toISOString();
  const deadlineAt = computeDeadlineAt(playAtMs, scheduleType, rangeDays, tz);
  const now = new Date().toISOString();

  // Delete then insert (upsert can't target partial indexes when tournament_id is null)
  const delQ = tournamentId
    ? supabaseAdmin.from("round_schedules").delete().eq("tournament_id", tournamentId).eq("stage", stage).eq("round", round)
    : supabaseAdmin.from("round_schedules").delete().is("tournament_id", null).eq("stage", stage).eq("round", round);
  await delQ;

  const { error } = await supabaseAdmin.from("round_schedules").insert({
    tournament_id: tournamentId,
    stage,
    round,
    schedule_type: scheduleType,
    range_days: rangeDays,
    play_at: playAt,
    deadline_at: deadlineAt,
    updated_at: now,
  });

  if (error) return { ok: false, error: error.message };

  // Update matches.scheduled_at for the affected stage/round. For round 1 of a stage,
  // also clear any check-in window not yet locked in (no channel) so rescheduling the
  // stage start re-opens the window at the new time instead of the stale one.
  //
  // Only a "specific" schedule is an actual fixed play time — those auto-confirm.
  // "range" defines a *window*; the play_at is just the window start (and the
  // default play hour is only a recommendation), so we leave scheduled_at for the teams
  // to propose within the window rather than stamping a misleading "confirmed" time.
  if (round === 1) {
    if (stage === "group") {
      await supabaseAdmin.from("matches").update({ checkin_deadline: null }).like("stage", "group_%").eq("round", round).is("discord_channel_id", null);
    } else {
      await supabaseAdmin.from("matches").update({ checkin_deadline: null }).eq("stage", stage).eq("round", round).is("discord_channel_id", null);
    }
  }
  // Reconcile per-match times with the round's window/type (handles admin-pinned
  // individual matches: shift on move, reset on type change, pin-all on specific).
  await syncRoundMatchPins(
    stage, round, scheduleType, playAtMs, rangeDays,
    (oldSchedule?.schedule_type as string | undefined) ?? null,
    oldSchedule?.play_at ? new Date(oldSchedule.play_at as string).getTime() : null,
    (oldSchedule?.range_days as number | null | undefined) ?? null,
    tz,
  );

  // Cascade-update downstream rounds that were chained off this one. "wasChained" must
  // be tested against this round's OLD type/rangeDays (its window length before this
  // edit) — using the new values here would misjudge chaining whenever only the range
  // day count changed (type staying "range"), breaking the cascade for a plain resize.
  if (oldSchedule?.play_at) {
    let prevOldPlayAt = oldSchedule.play_at as string;
    let prevOldType: string = (oldSchedule.schedule_type as string | undefined) ?? scheduleType;
    let prevOldRangeDays: number | null = (oldSchedule.range_days as number | null | undefined) ?? rangeDays;
    let prevNewPlayAt = playAt;
    let prevNewType: string = scheduleType;
    let prevNewRangeDays: number | null = rangeDays;
    let nextRound = round + 1;
    while (true) {
      const nextQ = tournamentId
        ? supabaseAdmin.from("round_schedules").select("play_at, schedule_type, range_days").eq("tournament_id", tournamentId).eq("stage", stage).eq("round", nextRound).maybeSingle()
        : supabaseAdmin.from("round_schedules").select("play_at, schedule_type, range_days").is("tournament_id", null).eq("stage", stage).eq("round", nextRound).maybeSingle();
      const { data: next } = await nextQ;
      if (!next) break;
      const nextType = next.schedule_type as ScheduleType;
      const nextRangeDays = next.range_days as number | null;
      const oldInferredMs = inferredPlayAtMs(new Date(prevOldPlayAt).getTime(), prevOldType, prevOldRangeDays, nextType, tz);
      const wasChained = Math.abs(new Date(next.play_at as string).getTime() - oldInferredMs) < 60_000;
      if (!wasChained) break;
      if (await isRoundLocked(stage, nextRound)) break;
      const newPlayAtMs = inferredPlayAtMs(new Date(prevNewPlayAt).getTime(), prevNewType, prevNewRangeDays, nextType, tz);
      const newPlayAt = new Date(newPlayAtMs).toISOString();
      const newDeadlineAt = computeDeadlineAt(newPlayAtMs, nextType, nextRangeDays, tz);
      const cascadeDelQ = tournamentId
        ? supabaseAdmin.from("round_schedules").delete().eq("tournament_id", tournamentId).eq("stage", stage).eq("round", nextRound)
        : supabaseAdmin.from("round_schedules").delete().is("tournament_id", null).eq("stage", stage).eq("round", nextRound);
      await cascadeDelQ;
      await supabaseAdmin.from("round_schedules").insert({ tournament_id: tournamentId, stage, round: nextRound, schedule_type: nextType, range_days: nextRangeDays, play_at: newPlayAt, deadline_at: newDeadlineAt, updated_at: now });
      // Chained move: same type, shifted window → pinned matches shift by the delta.
      await syncRoundMatchPins(stage, nextRound, nextType, newPlayAtMs, nextRangeDays, nextType, new Date(next.play_at as string).getTime(), nextRangeDays, tz);
      prevOldPlayAt = next.play_at as string;
      prevOldType = nextType;
      prevOldRangeDays = nextRangeDays;
      prevNewPlayAt = newPlayAt;
      prevNewType = nextType;
      prevNewRangeDays = nextRangeDays;
      nextRound++;
    }
  }

  // Open any channels that are now unblocked by this schedule being set
  await openReadyMatchChannels().catch(() => {});

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/season");
  return { ok: true };
}

export async function deleteRoundSchedule(params: {
  tournamentId: string | null;
  stage: string;
  round: number;
  timeZone?: string;
}): Promise<{ ok: boolean; error?: string }> {
  await verifyAdmin();
  const { tournamentId, stage, round } = params;
  const tz = params.timeZone || FALLBACK_TZ;

  if (await isRoundLocked(stage, round)) {
    return { ok: false, error: "This round has started and cannot be cleared." };
  }

  // Fetch play_at before deleting so we can cascade-check downstream rounds
  const fetchQ = tournamentId
    ? supabaseAdmin.from("round_schedules").select("play_at, schedule_type, range_days").eq("tournament_id", tournamentId).eq("stage", stage).eq("round", round).maybeSingle()
    : supabaseAdmin.from("round_schedules").select("play_at, schedule_type, range_days").is("tournament_id", null).eq("stage", stage).eq("round", round).maybeSingle();
  const { data: current } = await fetchQ;

  const delQ = tournamentId
    ? supabaseAdmin.from("round_schedules").delete().eq("tournament_id", tournamentId).eq("stage", stage).eq("round", round)
    : supabaseAdmin.from("round_schedules").delete().is("tournament_id", null).eq("stage", stage).eq("round", round);
  const { error } = await delQ;

  if (error) return { ok: false, error: error.message };

  // Removing the window orphans any per-match pins — reset them to undecided.
  await clearRoundMatchPins(stage, round);

  // Cascade-delete downstream rounds that were chained off this one
  if (current?.play_at) {
    let prevPlayAt = current.play_at as string;
    let prevType = current.schedule_type as string;
    let prevRangeDays = current.range_days as number | null;
    let nextRound = round + 1;
    while (true) {
      const nextQ = tournamentId
        ? supabaseAdmin.from("round_schedules").select("play_at, schedule_type, range_days").eq("tournament_id", tournamentId).eq("stage", stage).eq("round", nextRound).maybeSingle()
        : supabaseAdmin.from("round_schedules").select("play_at, schedule_type, range_days").is("tournament_id", null).eq("stage", stage).eq("round", nextRound).maybeSingle();
      const { data: next } = await nextQ;
      if (!next) break;

      const inferredMs = inferredPlayAtMs(new Date(prevPlayAt).getTime(), prevType, prevRangeDays, next.schedule_type as string, tz);
      const isChained = Math.abs(new Date(next.play_at as string).getTime() - inferredMs) < 60_000;
      if (!isChained) break;

      const locked = await isRoundLocked(stage, nextRound);
      if (locked) break;

      prevPlayAt = next.play_at as string;
      prevType = next.schedule_type as string;
      prevRangeDays = next.range_days as number | null;
      const cascadeQ = tournamentId
        ? supabaseAdmin.from("round_schedules").delete().eq("tournament_id", tournamentId).eq("stage", stage).eq("round", nextRound)
        : supabaseAdmin.from("round_schedules").delete().is("tournament_id", null).eq("stage", stage).eq("round", nextRound);
      await cascadeQ;
      await clearRoundMatchPins(stage, nextRound);
      nextRound++;
    }
  }

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/season");
  return { ok: true };
}

// Reset any admin-pinned matches in a round back to undecided.
async function clearRoundMatchPins(canonStage: string, round: number): Promise<void> {
  const matches = await fetchRoundMatches(canonStage, round);
  const pinnedIds = matches.filter((m) => m.admin_scheduled).map((m) => m.id);
  if (pinnedIds.length)
    await supabaseAdmin.from("matches")
      .update({ scheduled_at: null, admin_scheduled: false, schedule_accepted: false })
      .in("id", pinnedIds);
}

// ── Per-match scheduling (admin pins an individual match within a round window) ──

export async function pinMatchTime(matchId: string, dtStr: string, timeZone?: string): Promise<{ ok: boolean; error?: string }> {
  await verifyAdmin();
  const tz = timeZone || FALLBACK_TZ;

  const { data: match } = await supabaseAdmin
    .from("matches")
    .select("id, stage, round, discord_channel_id")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) return { ok: false, error: "Match not found." };
  if (match.discord_channel_id) return { ok: false, error: "This match has already started." };

  const canonStage = canonicalStage(match.stage as string);
  const { data: settings } = await supabaseAdmin
    .from("league_settings").select("active_tournament_id").single();
  const tid = (settings?.active_tournament_id as string | null) ?? null;

  const rsQ = tid
    ? supabaseAdmin.from("round_schedules").select("schedule_type, play_at, deadline_at").eq("tournament_id", tid).eq("stage", canonStage).eq("round", match.round as number).maybeSingle()
    : supabaseAdmin.from("round_schedules").select("schedule_type, play_at, deadline_at").is("tournament_id", null).eq("stage", canonStage).eq("round", match.round as number).maybeSingle();
  const { data: rs } = await rsQ;
  if (!rs) return { ok: false, error: "Set a time frame for this round before scheduling individual matches." };
  if (rs.schedule_type === "specific") return { ok: false, error: "This round is a single fixed time — schedule it at the round level." };

  const pinnedMs = parseDateTimeInZone(dtStr, tz);
  if (isNaN(pinnedMs)) return { ok: false, error: "Invalid time." };

  const startMs = windowStartMs(new Date(rs.play_at as string).getTime(), rs.schedule_type as string, tz);
  const endMs = new Date(rs.deadline_at as string).getTime();
  if (pinnedMs < startMs || pinnedMs > endMs)
    return { ok: false, error: "Time must fall within the round's window." };

  const { error } = await supabaseAdmin.from("matches").update({
    scheduled_at: new Date(pinnedMs).toISOString(),
    admin_scheduled: true,
    schedule_accepted: true,
    schedule_proposed_by_team_id: null,
    schedule_admin_required: false,
  }).eq("id", matchId);
  if (error) return { ok: false, error: error.message };

  await openReadyMatchChannels().catch(() => {});
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/schedule");
  return { ok: true };
}

export async function clearMatchTime(matchId: string): Promise<{ ok: boolean; error?: string }> {
  await verifyAdmin();

  const { data: match } = await supabaseAdmin
    .from("matches").select("id, discord_channel_id").eq("id", matchId).maybeSingle();
  if (!match) return { ok: false, error: "Match not found." };
  if (match.discord_channel_id) return { ok: false, error: "This match has already started." };

  const { error } = await supabaseAdmin.from("matches").update({
    scheduled_at: null,
    admin_scheduled: false,
    schedule_accepted: false,
    schedule_proposed_by_team_id: null,
    schedule_admin_required: false,
  }).eq("id", matchId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/my-team");
  revalidatePath("/dashboard/schedule");
  return { ok: true };
}

// Manually opens the season's opening round, which otherwise waits on this flag
// (set by execStartSeason) rather than opening the instant its schedule is set —
// giving the admin a chance to fix a bad round-1 schedule before it goes live.
export async function startFirstRound(): Promise<{ ok: boolean; error?: string }> {
  await verifyAdmin();

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("round1_manual_start_pending")
    .single();
  if (!settings?.round1_manual_start_pending) {
    return { ok: false, error: "Round 1 has already been started." };
  }

  await supabaseAdmin.from("league_settings")
    .update({ round1_manual_start_pending: false, updated_at: new Date().toISOString() })
    .not("id", "is", null);

  await openReadyMatchChannels().catch(() => {});

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/season");
  return { ok: true };
}
