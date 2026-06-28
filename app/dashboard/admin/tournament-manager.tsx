"use client";

import { useState, useTransition } from "react";
import {
  createTournament,
  updateTournament,
  cancelTournament,
  activateTournament,
  completeTournament,
  openSignups,
  closeSignups,
  toggleEventVisibility,
  deleteEvent,
  type Tournament,
  type Season,
  type JoinMode,
  type TeamAssignment,
  type TournamentInput,
} from "./tournament-actions";
import { addBulkTournamentTestUsers } from "./league-actions";
import { ExportCompletedPdfButton, ExportAndCompletePdfButton } from "./export-pdf-button";
import {
  type RoundTier,
  type BestOf,
  type SeasonFormatConfig,
  TIER_ORDER,
  TIER_LABELS,
  BO_OPTIONS,
  DEFAULT_BEST_OF,
  applyBestOfCascade,
  getNumGroups,
  getDefaultGroupAdvancing,
} from "@/app/dashboard/season/format-editor";
import { LocalTime } from "@/app/dashboard/local-time";

// ── Preset list ─────────────────────────────────────────────────────────────

const PRESETS: { id: string; name: string }[] = [
  { id: "single_elimination",             name: "Single Elimination" },
  { id: "double_elimination",             name: "Double Elimination" },
  { id: "group_single_elimination",       name: "Group → Single Elimination" },
  { id: "group_swiss_single_elimination", name: "Group → Swiss → SE" },
  { id: "group_swiss_hybrid",             name: "Group → Swiss → Hybrid(12)" },
  { id: "group_swiss_hybrid_8",           name: "Group → Swiss → Hybrid(8)" },
  { id: "se_swiss_single_elimination",    name: "SE Qualifier → Swiss → SE" },
  { id: "de_swiss_single_elimination",    name: "DE Qualifier → Swiss → SE" },
];

const FORMAT_TEAM_DEFAULTS: Record<string, { min: string }> = {
  single_elimination:             { min: "4" },
  double_elimination:             { min: "4" },
  group_single_elimination:       { min: "8" },
  group_swiss_single_elimination: { min: "32" },
  group_swiss_hybrid:             { min: "24" },
  group_swiss_hybrid_8:           { min: "16" },
  se_swiss_single_elimination:    { min: "32" },
  de_swiss_single_elimination:    { min: "32" },
};

// ── Stage schedule helpers ───────────────────────────────────────────────────

type StageScheduleEntry = {
  key: string;
  label: string;
  estimatedMinutes: number;
};

// Per-match spacing: 8 minutes per game in the series, rounded up to the next 5.
function gapMin(bo: BestOf): number {
  return Math.ceil((8 * bo) / 5) * 5;
}

function fmtDuration(minutes: number): string {
  if (minutes <= 0) return "—";
  if (minutes < 60) return `~${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `~${h}h` : `~${h}h ${m}m`;
}

const log2ceil = (n: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

// Sum the spacing for a sequence of single-elimination rounds, mapping the final
// rounds to the QF/SF/Final tiers (matches getSeedOrder/SE bracket structure).
function seRoundsDuration(totalRounds: number, bof: Record<RoundTier, BestOf>): number {
  let dur = 0;
  for (let r = 0; r < totalRounds; r++) {
    const rem = totalRounds - r;
    if (rem === 1) dur += gapMin(bof.finals);
    else if (rem === 2) dur += gapMin(bof.semifinals);
    else if (rem === 3) dur += gapMin(bof.quarterfinals);
    else dur += gapMin(bof.standard);
  }
  return dur;
}

// All groups play (minGroupSize - 1) * 2 rounds. The smallest group gets a full
// double RR; larger groups exhaust single-RR then fill remaining rounds from pass 2.
function groupStageRounds(teams: number): number {
  const ng = getNumGroups(teams);
  const minSize = Math.floor(teams / ng); // smallest group (floor of even split)
  return (minSize - 1) * 2;
}

// Double-elimination wall-clock rounds: WB = log2(size), LB = 2·(log2(size)−1),
// plus the grand final. LB is the critical path for size ≥ 4. (bracket.ts)
function deRounds(teams: number): number {
  if (teams <= 2) return 1;
  const wb = log2ceil(teams);
  const lb = 2 * (wb - 1);
  return Math.max(wb, lb) + 1;
}

// Swiss runs until every team reaches 3 wins or 3 losses → at most 5 rounds, all standard.
const SWISS_ROUNDS = 5;

function computeStageSchedule(
  preset: string,
  teams: number,
  groupMaxAdvancing: number | null,
  bof: Record<RoundTier, BestOf>
): StageScheduleEntry[] {
  if (teams < 2) return [];

  const std = gapMin(bof.standard);
  const qf  = gapMin(bof.quarterfinals);
  const sf  = gapMin(bof.semifinals);
  const fin = gapMin(bof.finals);

  const groups = { key: "groups", label: "Groups", estimatedMinutes: groupStageRounds(teams) * std };
  const swiss  = { key: "swiss", label: "Swiss", estimatedMinutes: SWISS_ROUNDS * std };
  const se8    = { key: "bracket", label: "Bracket", estimatedMinutes: seRoundsDuration(3, bof) }; // 8→1: QF+SF+Final

  switch (preset) {
    case "single_elimination":
      return [{ key: "bracket", label: "Bracket", estimatedMinutes: seRoundsDuration(log2ceil(teams), bof) }];

    case "double_elimination":
      return [{ key: "bracket", label: "Bracket", estimatedMinutes: seRoundsDuration(deRounds(teams), bof) }];

    case "group_single_elimination": {
      const adv = groupMaxAdvancing ?? getDefaultGroupAdvancing(teams);
      return [
        groups,
        { key: "bracket", label: "Bracket", estimatedMinutes: seRoundsDuration(log2ceil(adv), bof) },
      ];
    }

    case "group_swiss_single_elimination":
      return [groups, swiss, se8];

    case "group_swiss_hybrid":
      // 5 wall-clock rounds: (UB QF ‖ LB R1), LB R2, LB QF, SF, GF
      return [
        groups,
        swiss,
        { key: "hybrid", label: "Hybrid(12)", estimatedMinutes: std + std + qf + sf + fin },
      ];

    case "group_swiss_hybrid_8":
      // 4 wall-clock rounds: (UB QF ‖ LB R1), LB QF, SF, GF
      return [
        groups,
        swiss,
        { key: "hybrid", label: "Hybrid(8)", estimatedMinutes: std + qf + sf + fin },
      ];

    case "se_swiss_single_elimination": {
      // SE qualifier narrows N → 16: log2(N) − log2(16) rounds.
      const qualRounds = Math.max(1, log2ceil(teams) - 4);
      return [
        { key: "se_qualifier", label: "SE Qualifier", estimatedMinutes: qualRounds * std },
        swiss,
        se8,
      ];
    }

    case "de_swiss_single_elimination": {
      // DE qualifier narrows N → 16: WB k = log2(size/8), LB = 2·(k−1), run in parallel.
      const k = Math.max(1, log2ceil(teams) - 3);
      const qualRounds = Math.max(k, 2 * (k - 1));
      return [
        { key: "de_qualifier", label: "DE Qualifier", estimatedMinutes: qualRounds * std },
        swiss,
        se8,
      ];
    }

    default:
      return [];
  }
}

function emptyStarts(preset: string): string[] {
  const count =
    preset === "single_elimination" || preset === "double_elimination" ? 1 :
    preset === "group_single_elimination" ? 2 : 3;
  return Array(count).fill("");
}

// ── Misc ─────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<Tournament["status"], string> = {
  scheduled: "bg-blue-900/40 border-blue-700/50 text-blue-300",
  active: "bg-emerald-900/40 border-emerald-700/50 text-emerald-300",
  completed: "bg-zinc-800 border-zinc-700 text-zinc-400",
  cancelled: "bg-red-900/30 border-red-800/40 text-red-400",
};

const GOLD_BADGE = "bg-amber-900/40 border-amber-600/50 text-amber-300";

function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Form state ────────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  joinMode: JoinMode;
  teamAssignment: TeamAssignment;
  minTeams: string;
  teamLimit: string;
  minMmr2v2: string;
  minMmr3v3: string;
  preset: string;
  roundBestOf: Record<RoundTier, BestOf>;
  groupSeedingMethod: "balanced" | "random";
  groupMaxAdvancing: string;
  draftOpenAt: string;
  draftCloseAt: string;
  draftStartAt: string;
  stageStarts: string[];
  previewTeams: string;
  isTest: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  joinMode: "players",
  teamAssignment: "snake_draft",
  minTeams: FORMAT_TEAM_DEFAULTS.single_elimination.min,
  teamLimit: "",
  minMmr2v2: "",
  minMmr3v3: "",
  preset: "single_elimination",
  roundBestOf: { ...DEFAULT_BEST_OF },
  groupSeedingMethod: "balanced",
  groupMaxAdvancing: "",
  draftOpenAt: "",
  draftCloseAt: "",
  draftStartAt: "",
  stageStarts: [""],
  previewTeams: "",
  isTest: false,
};

const inputCls =
  "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const labelCls = "block text-xs font-medium text-zinc-400 mb-1";

// ── Component ─────────────────────────────────────────────────────────────────

export function TournamentManager({
  tournaments,
  seasons,
  hasActive,
  testingMode = false,
}: {
  tournaments: Tournament[];
  seasons: Season[];
  hasActive: boolean;
  testingMode?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "complete" | "cancel" } | null>(null);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const showFeedback = (msg: string, ok: boolean) => {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 5000);
  };

  const isPlayers = form.joinMode === "players";
  const hasGroupStage = [
    "group_single_elimination",
    "group_swiss_single_elimination",
    "group_swiss_hybrid",
    "group_swiss_hybrid_8",
  ].includes(form.preset);
  const groupAdvancingFixed = [
    "group_swiss_single_elimination",
    "group_swiss_hybrid",
    "group_swiss_hybrid_8",
  ].includes(form.preset);

  const teams = parseInt(form.minTeams) || 0;
  const groupMaxAdvParsed = form.groupMaxAdvancing ? parseInt(form.groupMaxAdvancing) || null : null;
  const stages = computeStageSchedule(form.preset, teams, groupMaxAdvParsed, form.roundBestOf);
  const previewCount = parseInt(form.previewTeams) || teams;
  const displayStages = computeStageSchedule(form.preset, previewCount, groupMaxAdvParsed, form.roundBestOf);

  const buildInput = (): TournamentInput => {
    const season_format: SeasonFormatConfig = {
      preset: form.preset as SeasonFormatConfig["preset"],
      roundBestOf: form.roundBestOf,
    };
    if (hasGroupStage) {
      season_format.groupSeedingMethod = form.groupSeedingMethod;
      if (!groupAdvancingFixed) {
        const parsed = form.groupMaxAdvancing ? parseInt(form.groupMaxAdvancing) : null;
        season_format.groupMaxAdvancing = parsed && !isNaN(parsed) ? parsed : null;
      }
    }

    const stage_starts: Record<string, string> = {};
    stages.forEach((s, i) => {
      const iso = localInputToIso(form.stageStarts[i] ?? "");
      if (iso) stage_starts[s.key] = iso;
    });

    const season_start_at = localInputToIso(form.stageStarts[0] ?? "");

    return {
      name: form.name,
      min_teams: parseInt(form.minTeams) || 0,
      team_limit: form.teamLimit ? parseInt(form.teamLimit) || null : null,
      join_mode: form.joinMode,
      team_assignment: isPlayers ? form.teamAssignment : null,
      draft_open_at: localInputToIso(form.draftOpenAt),
      draft_close_at: localInputToIso(form.draftCloseAt),
      draft_start_at: isPlayers ? localInputToIso(form.draftStartAt) : null,
      season_start_at,
      season_format,
      stage_starts: Object.keys(stage_starts).length > 0 ? stage_starts : null,
      match_spacing_min: null,
      match_deadline_day: null,
      match_play_day: null,
      match_play_hour: null,
      min_mmr_2v2: form.minMmr2v2 ? parseInt(form.minMmr2v2) || null : null,
      min_mmr_3v3: form.minMmr3v3 ? parseInt(form.minMmr3v3) || null : null,
      is_test: form.isTest,
    };
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const validateDates = (): string | null => {
    const openAt  = form.draftOpenAt  ? new Date(form.draftOpenAt)  : null;
    const closeAt = form.draftCloseAt ? new Date(form.draftCloseAt) : null;
    const draftAt = isPlayers && form.draftStartAt ? new Date(form.draftStartAt) : null;
    const draftLabel = form.teamAssignment === "auto_balance" ? "Teams auto-formed" : "Draft start";

    if (openAt && closeAt && closeAt <= openAt)
      return "Sign-ups must close after they open.";
    if (closeAt && draftAt && draftAt <= closeAt)
      return `${draftLabel} must be after sign-ups close.`;

    // Stage start ordering (use displayStages for durations so warnings match what admin sees)
    const stageInfos = stages.map((s, i) => ({
      label: s.label,
      estimatedMinutes: (displayStages[i] ?? s).estimatedMinutes,
      start: form.stageStarts[i] ? new Date(form.stageStarts[i]) : null,
    }));

    const firstStart = stageInfos[0]?.start;
    if (firstStart) {
      const regEnd = draftAt ?? closeAt;
      if (regEnd && firstStart <= regEnd)
        return `${stageInfos[0].label} must start after ${draftAt ? "the draft" : "sign-ups close"}.`;
    }

    for (let i = 1; i < stageInfos.length; i++) {
      const prev = stageInfos[i - 1];
      const curr = stageInfos[i];
      if (curr.start && !prev.start)
        return `${prev.label} needs a start time before ${curr.label} can be scheduled.`;
      if (curr.start && prev.start) {
        const prevEnd = new Date(prev.start.getTime() + prev.estimatedMinutes * 60_000);
        if (curr.start <= prevEnd)
          return `${curr.label} must start after ${prev.label} ends (est. ${fmtDuration(prev.estimatedMinutes)}).`;
      }
    }

    return null;
  };

  const handleSubmit = () => {
    const dateError = validateDates();
    if (dateError) return showFeedback(dateError, false);
    const input = buildInput();
    startTransition(async () => {
      const res = editingId
        ? await updateTournament(editingId, input)
        : await createTournament(input);
      if (res.error) return showFeedback(res.error, false);
      showFeedback(res.message ?? "Saved.", true);
      resetForm();
    });
  };

  const handleEdit = (t: Tournament) => {
    setEditingId(t.id);
    const fmt = t.season_format as SeasonFormatConfig | null;
    const preset = fmt?.preset ?? "single_elimination";
    const tTeams = t.min_teams || 0;
    const tBof = { ...DEFAULT_BEST_OF, ...(fmt?.roundBestOf ?? {}) };
    const tGroupAdv = fmt?.groupMaxAdvancing ?? null;
    const tStages = computeStageSchedule(preset, tTeams, tGroupAdv, tBof);
    const savedStarts = (t as { stage_starts?: Record<string, string> | null }).stage_starts ?? null;

    setForm({
      name: t.name,
      joinMode: t.join_mode,
      teamAssignment: t.team_assignment ?? "snake_draft",
      minTeams: t.min_teams ? String(t.min_teams) : "",
      teamLimit: t.team_limit ? String(t.team_limit) : "",
      preset,
      roundBestOf: tBof,
      groupSeedingMethod: fmt?.groupSeedingMethod ?? "balanced",
      groupMaxAdvancing: fmt?.groupMaxAdvancing != null ? String(fmt.groupMaxAdvancing) : "",
      draftOpenAt: isoToLocalInput(t.draft_open_at),
      draftCloseAt: isoToLocalInput(t.draft_close_at),
      draftStartAt: isoToLocalInput(t.draft_start_at),
      stageStarts: tStages.map(s => isoToLocalInput(savedStarts?.[s.key] ?? null)),
      previewTeams: "",
      minMmr2v2: t.min_mmr_2v2 ? String(t.min_mmr_2v2) : "",
      minMmr3v3: t.min_mmr_3v3 ? String(t.min_mmr_3v3) : "",
      isTest: t.is_test ?? false,
    });
    setFeedback(null);
  };

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) => {
    startTransition(async () => {
      const res = await fn();
      if (res.error) return showFeedback(res.error, false);
      showFeedback(res.message ?? "Done.", true);
      setConfirm(null);
    });
  };

  const hiddenBadge = (
    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-zinc-800 border-zinc-700 text-zinc-500">
      hidden
    </span>
  );

  return (
    <div className="space-y-8">
      {/* Create / edit form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">
          {editingId ? "Edit Tournament" : "Schedule a Tournament"}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Name</label>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Summer League 2026"
            />
          </div>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5">
              <div>
                <p className="text-xs font-medium text-zinc-300">Test Tournament</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {form.isTest
                    ? "ON — discarded on completion, no records saved, no Westside Wages"
                    : "OFF — real tournament, results archived and Westside Wages awarded"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, isTest: !form.isTest })}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none ${
                  form.isTest ? "bg-amber-600 border-amber-600" : "bg-zinc-700 border-zinc-700"
                }`}
                role="switch"
                aria-checked={form.isTest}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${form.isTest ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </div>
          </div>

          <div>
            <label className={labelCls}>Who signs up?</label>
            <select
              className={inputCls}
              value={form.joinMode}
              onChange={(e) => setForm({ ...form, joinMode: e.target.value as JoinMode })}
            >
              <option value="players">Players (individual)</option>
              <option value="teams">Teams (pre-formed)</option>
            </select>
          </div>

          {isPlayers && (
            <div>
              <label className={labelCls}>Team formation</label>
              <select
                className={inputCls}
                value={form.teamAssignment}
                onChange={(e) => setForm({ ...form, teamAssignment: e.target.value as TeamAssignment })}
              >
                <option value="snake_draft">Snake draft (captains pick)</option>
                <option value="auto_balance">Auto-balance by MMR</option>
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>Min teams</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={form.minTeams ?? ""}
              onChange={(e) => setForm({ ...form, minTeams: e.target.value })}
              placeholder={FORMAT_TEAM_DEFAULTS[form.preset]?.min ?? "4"}
            />
          </div>

          <div>
            <label className={labelCls}>Max teams (optional)</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={form.teamLimit}
              onChange={(e) => setForm({ ...form, teamLimit: e.target.value })}
              placeholder="No cap"
            />
          </div>

          <div>
            <label className={labelCls}>Min 2v2 MMR requirement (optional)</label>
            <input
              type="number"
              min={0}
              max={3000}
              className={inputCls}
              value={form.minMmr2v2}
              onChange={(e) => setForm({ ...form, minMmr2v2: e.target.value })}
              placeholder="No minimum"
            />
          </div>

          <div>
            <label className={labelCls}>Min 3v3 MMR requirement (optional)</label>
            <input
              type="number"
              min={0}
              max={3000}
              className={inputCls}
              value={form.minMmr3v3}
              onChange={(e) => setForm({ ...form, minMmr3v3: e.target.value })}
              placeholder="No minimum"
            />
          </div>

          <div>
            <label className={labelCls}>Format</label>
            <select
              className={inputCls}
              value={form.preset}
              onChange={(e) => {
                const p = e.target.value;
                const d = FORMAT_TEAM_DEFAULTS[p] ?? { min: "4" };
                setForm(f => ({ ...f, preset: p, minTeams: d.min, stageStarts: emptyStarts(p) }));
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>{isPlayers ? "Sign-ups open" : "Team registration opens"}</label>
            <input type="datetime-local" className={inputCls} value={form.draftOpenAt}
              onChange={(e) => setForm({ ...form, draftOpenAt: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>{isPlayers ? "Sign-ups close" : "Team registration closes"}</label>
            <input type="datetime-local" className={inputCls} value={form.draftCloseAt}
              onChange={(e) => setForm({ ...form, draftCloseAt: e.target.value })} />
          </div>
          {isPlayers && (
            <div>
              <label className={labelCls}>
                {form.teamAssignment === "auto_balance" ? "Teams auto-formed at" : "Draft starts"}
              </label>
              <input type="datetime-local" className={inputCls} value={form.draftStartAt}
                onChange={(e) => setForm({ ...form, draftStartAt: e.target.value })} />
            </div>
          )}
        </div>

        {/* Group stage settings */}
        {hasGroupStage && (
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Group Stage Settings</p>
            <div>
              <p className="text-xs text-zinc-500 mb-2">Team seeding</p>
              <div className="flex gap-2">
                {(["balanced", "random"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, groupSeedingMethod: m }))}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      form.groupSeedingMethod === m
                        ? "border-indigo-500 bg-indigo-900/50 text-white"
                        : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {m === "balanced" ? "Balanced (by MMR)" : "Random"}
                  </button>
                ))}
              </div>
            </div>
            {!groupAdvancingFixed ? (
              <div>
                <p className="text-xs text-zinc-500 mb-1">Max teams advancing (leave blank for default)</p>
                <input
                  type="number"
                  value={form.groupMaxAdvancing}
                  onChange={(e) => setForm(f => ({ ...f, groupMaxAdvancing: e.target.value }))}
                  placeholder={String(getDefaultGroupAdvancing(parseInt(form.minTeams) || 8))}
                  className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield]"
                />
                <p className="text-[10px] text-zinc-600 mt-1">
                  Must be a multiple of {getNumGroups(parseInt(form.minTeams) || 8)} (number of groups)
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Advancing is fixed by this format.</p>
            )}
          </div>
        )}

        {/* Best Of settings */}
        {(() => {
          const bof: Record<RoundTier, BestOf> = form.roundBestOf ?? { ...DEFAULT_BEST_OF };
          return (
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Best Of Settings</p>
              {TIER_ORDER.map((tier) => (
                <div key={tier} className="flex items-center gap-4">
                  <span className="text-xs text-zinc-500 w-24 sm:w-36 shrink-0">{TIER_LABELS[tier]}</span>
                  <div className="flex gap-2">
                    {BO_OPTIONS.map((bo) => (
                      <button
                        key={bo}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, roundBestOf: applyBestOfCascade(f.roundBestOf ?? { ...DEFAULT_BEST_OF }, tier, bo) }))}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          bof[tier] === bo
                            ? "border-indigo-500 bg-indigo-900/50 text-white"
                            : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
                        }`}
                      >
                        <span className="sm:hidden">{bo}</span>
                        <span className="hidden sm:inline">BO{bo}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Stage schedule */}
        {stages.length > 0 && (
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Stage Schedule</p>
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500 shrink-0">Preview teams</label>
                <input
                  type="number"
                  min={2}
                  value={form.previewTeams}
                  onChange={(e) => setForm(f => ({ ...f, previewTeams: e.target.value }))}
                  placeholder={String(previewCount || "—")}
                  className="w-20 bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield]"
                />
              </div>
            </div>
            <div className="space-y-2">
              {stages.map((stage, i) => {
                const display = displayStages[i] ?? stage;
                const prevDisplay = i > 0 ? (displayStages[i - 1] ?? stages[i - 1]) : null;
                const prevStart = i > 0 && form.stageStarts[i - 1] ? new Date(form.stageStarts[i - 1]) : null;
                const prevEnd = prevStart && prevDisplay
                  ? new Date(prevStart.getTime() + prevDisplay.estimatedMinutes * 60_000)
                  : null;
                const thisStart = form.stageStarts[i] ? new Date(form.stageStarts[i]) : null;
                const tooEarly = !!(thisStart && prevEnd && thisStart <= prevEnd);

                return (
                  <div key={stage.key}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400 w-24 shrink-0">{stage.label}</span>
                      <input
                        type="datetime-local"
                        value={form.stageStarts[i] ?? ""}
                        onChange={(e) => {
                          const next = [...form.stageStarts];
                          next[i] = e.target.value;
                          setForm(f => ({ ...f, stageStarts: next }));
                        }}
                        className={`flex-1 bg-zinc-800 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                          tooEarly ? "border-red-500" : "border-zinc-700"
                        }`}
                      />
                      <span className="text-xs text-zinc-500 shrink-0 w-16 text-right">
                        {fmtDuration(display.estimatedMinutes)}
                      </span>
                    </div>
                    {tooEarly && prevEnd && prevDisplay && (
                      <p className="text-xs text-red-400 mt-1 ml-26">
                        Must start after {stages[i - 1].label} ends (est. {fmtDuration(prevDisplay.estimatedMinutes)}).
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-600">
              Durations are estimates based on BO settings and preview team count. Leave blank for no scheduled times.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {editingId ? "Save changes" : "Schedule tournament"}
          </button>
          {editingId && (
            <button onClick={resetForm} disabled={isPending}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-lg transition-colors">
              Cancel edit
            </button>
          )}
          {feedback && (
            <span className={`text-sm ${feedback.ok ? "text-emerald-400" : "text-red-400"}`}>
              {feedback.msg}
            </span>
          )}
        </div>
      </div>

      {/* Tournaments list */}
      {(() => {
        if (tournaments.length === 0 && seasons.length === 0)
          return <p className="text-zinc-500 text-sm">No tournaments yet.</p>;

        const activeTournament = tournaments.find((t) => t.status === "active") ?? null;
        const scheduledTournaments = tournaments
          .filter((t) => t.status === "scheduled")
          .sort((a, b) => {
            const aDate = a.season_start_at ?? a.draft_open_at ?? a.created_at;
            const bDate = b.season_start_at ?? b.draft_open_at ?? b.created_at;
            return new Date(aDate ?? 0).getTime() - new Date(bDate ?? 0).getTime();
          });
        const endedTournaments = tournaments.filter(
          (t) => t.status === "completed" || t.status === "cancelled"
        );

        const renderDetail = (t: Tournament) => {
          const summary = t.summary;
          const sf = t.season_format as SeasonFormatConfig | null;
          const savedStarts = (t as { stage_starts?: Record<string, string> | null }).stage_starts ?? null;
          const tStages = sf?.preset
            ? computeStageSchedule(
                sf.preset,
                t.min_teams || 0,
                sf.groupMaxAdvancing ?? null,
                { ...DEFAULT_BEST_OF, ...(sf.roundBestOf ?? {}) }
              )
            : [];

          return (
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-500 mt-1">
                  {t.join_mode === "teams"
                    ? "Team sign-ups"
                    : t.team_assignment === "auto_balance"
                    ? "Player sign-ups · auto-balance"
                    : "Player sign-ups · snake draft"}
                  {t.min_teams > 0 && ` · min ${t.min_teams} teams`}
                  {t.team_limit ? ` · max ${t.team_limit} teams` : ""}
                </p>
                <div className="text-xs text-zinc-500 mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
                  <span>{t.join_mode === "teams" ? "Reg open" : "Open"}: <LocalTime iso={t.draft_open_at} /></span>
                  <span>{t.join_mode === "teams" ? "Reg close" : "Close"}: <LocalTime iso={t.draft_close_at} /></span>
                  {t.join_mode === "players" && <span>Draft: <LocalTime iso={t.draft_start_at} /></span>}
                  {tStages.length > 0 && savedStarts
                    ? tStages.map(s => savedStarts[s.key] ? (
                        <span key={s.key}>{s.label}: <LocalTime iso={savedStarts[s.key]} /></span>
                      ) : null)
                    : t.season_start_at
                    ? <span>Season: <LocalTime iso={t.season_start_at} /></span>
                    : null}
                </div>
                {sf?.preset && (
                  <p className="text-xs text-zinc-500 mt-1">
                    <span className="text-zinc-400">{PRESETS.find(p => p.id === sf.preset)?.name ?? sf.preset}</span>
                    {TIER_ORDER.map(tier => ` · ${TIER_LABELS[tier]}: BO${sf.roundBestOf?.[tier] ?? DEFAULT_BEST_OF[tier]}`).join("")}
                  </p>
                )}
                {t.status === "completed" && summary && (
                  <p className="text-xs text-amber-300 mt-2">
                    🏆 Champion: {summary.champion ?? "—"}
                  </p>
                )}
                {t.status === "cancelled" && summary?.cancellationReason && (
                  <p className="text-xs text-red-400 mt-2">⚠ {summary.cancellationReason}</p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {t.status === "scheduled" && (
                  <>
                    {t.signups_open ? (
                      <button onClick={() => run(() => closeSignups(t.id))} disabled={isPending}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-amber-300 text-xs font-medium rounded-lg transition-colors">
                        Close sign-ups
                      </button>
                    ) : (
                      <button onClick={() => run(() => openSignups(t.id))} disabled={isPending}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors">
                        Open sign-ups
                      </button>
                    )}
                    <button onClick={() => run(() => activateTournament(t.id))} disabled={isPending || hasActive}
                      title={hasActive ? "Another tournament is active" : ""}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors">
                      Activate
                    </button>
                    {testingMode && t.join_mode === "players" && (
                      <button onClick={() => run(() => addBulkTournamentTestUsers(t.id, 32))} disabled={isPending}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-medium rounded-lg transition-colors">
                        Add 32 Test Users
                      </button>
                    )}
                    <button onClick={() => handleEdit(t)} disabled={isPending}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors">
                      Edit
                    </button>
                  </>
                )}
                {t.status === "active" && (
                  <>
                    <ExportAndCompletePdfButton />
                    <button onClick={() => setConfirm({ id: t.id, action: "complete" })} disabled={isPending}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg transition-colors">
                      Complete
                    </button>
                  </>
                )}
                {t.status === "completed" && (summary?.finalStandings?.length ?? 0) > 0 && (
                  <ExportCompletedPdfButton tournamentId={t.id} />
                )}
                {t.status === "scheduled" && (
                  <button onClick={() => setConfirm({ id: t.id, action: "cancel" })} disabled={isPending}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-red-900/50 text-red-400 text-xs font-medium rounded-lg transition-colors">
                    Cancel
                  </button>
                )}
              </div>
            </div>
          );
        };

        const renderHeader = (t: Tournament) => (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white">{t.name}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_STYLES[t.status]}`}>
              {t.status}
            </span>
            {t.is_test && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-900/30 border-amber-700/40 text-amber-300">
                test
              </span>
            )}
            {t.status === "scheduled" && t.signups_open && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-emerald-900/30 border-emerald-700/40 text-emerald-300">
                sign-ups open
              </span>
            )}
            {t.status === "completed" && t.hidden_from_home && !t.is_test && hiddenBadge}
          </div>
        );

        const renderSeasonHeader = (s: Season) => (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-amber-300">{s.name}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${GOLD_BADGE}`}>
              season
            </span>
            {s.hidden_from_home && hiddenBadge}
          </div>
        );

        const renderSeasonDetail = (s: Season) => {
          const sf = s.season_format as SeasonFormatConfig | null;
          const presetName = sf?.preset ? (PRESETS.find(p => p.id === sf.preset)?.name ?? sf.preset) : null;
          return (
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-500 mt-1">
                  {presetName ? <span className="text-zinc-400">{presetName}</span> : "Season"}
                  {s.team_count > 0 ? ` · ${s.team_count} teams` : ""}
                </p>
                <p className="text-xs text-zinc-500 mt-1">Ended: <LocalTime iso={s.ended_at} /></p>
                {s.summary?.champion && (
                  <p className="text-xs text-amber-300 mt-2">
                    🏆 Champion: {s.summary.champion}
                  </p>
                )}
              </div>
            </div>
          );
        };

        const renderConfirm = (t: Tournament) => confirm?.id === t.id ? (
          <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-zinc-300">
              {confirm.action === "complete"
                ? "Complete this tournament? This archives the result and resets the league pool."
                : "Cancel this scheduled tournament?"}
            </span>
            <button
              onClick={() => run(() => confirm.action === "complete" ? completeTournament() : cancelTournament(t.id))}
              disabled={isPending}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors">
              Confirm
            </button>
            <button onClick={() => setConfirm(null)} disabled={isPending}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors">
              Back
            </button>
          </div>
        ) : null;

        const primaryDate = (t: Tournament) =>
          t.season_start_at ?? t.draft_open_at ?? t.created_at;

        type Item =
          | { kind: "tournament"; id: string; date: string | null; t: Tournament }
          | { kind: "season"; id: string; date: string | null; s: Season };

        const items: Item[] = [
          ...endedTournaments.map((t): Item => ({ kind: "tournament", id: t.id, date: primaryDate(t), t })),
          ...seasons.map((s): Item => ({ kind: "season", id: s.id, date: s.ended_at ?? s.created_at, s })),
        ].sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));

        return (
          <div className="space-y-3">
            {/* Active tournament — always expanded */}
            {activeTournament && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                {renderHeader(activeTournament)}
                {renderDetail(activeTournament)}
                {renderConfirm(activeTournament)}
              </div>
            )}

            {/* Scheduled tournaments — all expanded, soonest first */}
            {scheduledTournaments.map((t) => (
              <div key={t.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                {renderHeader(t)}
                {renderDetail(t)}
                {renderConfirm(t)}
              </div>
            ))}

            {/* All other events (tournaments + seasons) — collapsible scrollable list */}
            {items.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setHistoryOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 transition-colors"
                >
                  <span className="text-sm font-medium text-zinc-300">
                    All Events
                    <span className="ml-2 text-xs text-zinc-500">{items.length}</span>
                  </span>
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className={`text-zinc-500 transition-transform ${historyOpen ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {historyOpen && (
                  <div className="border-t border-zinc-800 divide-y divide-zinc-800 max-h-[480px] overflow-y-auto">
                    {items.map((item) => {
                      const key = `${item.kind}-${item.id}`;
                      const isExpanded = expandedId === key;
                      const isSeason = item.kind === "season";
                      const name = isSeason ? item.s.name : item.t.name;
                      const hidden = isSeason ? item.s.hidden_from_home : item.t.hidden_from_home;
                      const itemId = isSeason ? item.s.id : item.t.id;
                      const isDeletePending = deleteConfirmKey === key;
                      return (
                        <div key={key}>
                          <div
                            onClick={() => setExpandedId(isExpanded ? null : key)}
                            className="w-full flex items-center gap-2 px-4 py-3 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
                          >
                            <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap">
                              <span className={`text-sm truncate ${isSeason ? "text-amber-300" : "text-white"}`}>{name}</span>
                              {isSeason ? (
                                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${GOLD_BADGE}`}>
                                  season
                                </span>
                              ) : (
                                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${STATUS_STYLES[item.t.status]}`}>
                                  {item.t.status}
                                </span>
                              )}
                              {hidden && hiddenBadge}
                            </div>

                            <div
                              className="flex items-center gap-1.5 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => run(() => toggleEventVisibility(item.kind, itemId, !hidden))}
                                disabled={isPending}
                                title={hidden ? "Show on Home & Podium" : "Hide from Home & Podium"}
                                className={`px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium rounded transition-colors ${hidden ? "text-emerald-300" : "text-amber-300"}`}
                              >
                                {hidden ? "Show" : "Hide"}
                              </button>
                              <button
                                onClick={() => {
                                  setDeleteConfirmKey(key);
                                  setExpandedId(key);
                                }}
                                disabled={isPending}
                                className="px-2 py-1 bg-zinc-800 hover:bg-red-900/50 text-[11px] font-medium text-red-400 rounded transition-colors"
                              >
                                Delete
                              </button>
                              <span className="text-xs text-zinc-500 hidden sm:block ml-1">
                                <LocalTime iso={item.date} dateOnly />
                              </span>
                            </div>

                            <svg
                              width="12" height="12" viewBox="0 0 24 24" fill="none"
                              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                              className={`text-zinc-600 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </div>

                          {isExpanded && (
                            <div className="px-4 pb-4 border-t border-zinc-800/60">
                              {isDeletePending ? (
                                <div className="pt-3 flex items-center gap-3 flex-wrap">
                                  <span className="text-xs text-zinc-300">Permanently delete this record? This cannot be undone.</span>
                                  <button
                                    onClick={() => {
                                      run(() => deleteEvent(item.kind, itemId));
                                      setDeleteConfirmKey(null);
                                    }}
                                    disabled={isPending}
                                    className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                                  >
                                    Confirm Delete
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmKey(null)}
                                    disabled={isPending}
                                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="pt-3 space-y-3">
                                  {isSeason ? (
                                    <>
                                      {renderSeasonHeader(item.s)}
                                      {renderSeasonDetail(item.s)}
                                    </>
                                  ) : (
                                    <>
                                      {renderHeader(item.t)}
                                      {renderDetail(item.t)}
                                      {renderConfirm(item.t)}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
