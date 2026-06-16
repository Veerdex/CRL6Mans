"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSeasonFormat } from "./actions";

// ── Types ──────────────────────────────────────────────────────────────────────

export type PresetId =
  | "single_elimination"
  | "double_elimination"
  | "group_single_elimination"
  | "group_swiss_single_elimination"
  | "group_swiss_hybrid"
  | "group_swiss_hybrid_8"
  | "se_swiss_single_elimination"
  | "de_swiss_single_elimination";

export type RoundTier = "standard" | "quarterfinals" | "semifinals" | "finals";
export type BestOf = 1 | 3 | 5 | 7;

export type SeasonFormatConfig = {
  preset: PresetId;
  groupSeedingMethod?: "balanced" | "random";
  groupMaxAdvancing?: number | null;
  roundBestOf?: Partial<Record<RoundTier, BestOf>>;
};

type StageType = "group" | "swiss" | "single_elimination" | "double_elimination";

type PresetDef = {
  id: PresetId;
  name: string;
  stageTypes: StageType[];
  minTeams: number;
  maxTeams?: number;
  description: string;
};

type StageInfo = {
  type: StageType;
  label: string;
  start: number;
  end: number;
  detail?: string;
  hasByes?: boolean;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const PRESETS: PresetDef[] = [
  {
    id: "single_elimination",
    name: "Single Elimination",
    stageTypes: ["single_elimination"],
    minTeams: 4,
    description: "Standard single-elimination bracket.",
  },
  {
    id: "double_elimination",
    name: "Double Elimination",
    stageTypes: ["double_elimination"],
    minTeams: 4,
    description: "Two losses to eliminate; winners and losers brackets.",
  },
  {
    id: "group_single_elimination",
    name: "Group → Single Elimination",
    stageTypes: ["group", "single_elimination"],
    minTeams: 8,
    maxTeams: 64,
    description: "Teams split into groups; top qualifiers enter the SE bracket.",
  },
  {
    id: "group_swiss_single_elimination",
    name: "Group → Swiss → SE",
    stageTypes: ["group", "swiss", "single_elimination"],
    minTeams: 32,
    maxTeams: 64,
    description: "Groups narrow to 16 → Swiss (16→8) → SE finals.",
  },
  {
    id: "group_swiss_hybrid",
    name: "Group → Swiss → Hybrid(12)",
    stageTypes: ["group", "swiss", "double_elimination"],
    minTeams: 24,
    maxTeams: 32,
    description: "4 groups: 1sts → UB, 2nd–5th → Swiss. Swiss top 8 → LB. 12-team hybrid bracket.",
  },
  {
    id: "group_swiss_hybrid_8",
    name: "Group → Swiss → Hybrid(8)",
    stageTypes: ["group", "swiss", "double_elimination"],
    minTeams: 16,
    maxTeams: 32,
    description: "4 groups: 1sts → UB, 2nd–3rd → Swiss. Swiss top 4 → LB. 8-team hybrid bracket.",
  },
  {
    id: "se_swiss_single_elimination",
    name: "SE Qualifier → Swiss → SE",
    stageTypes: ["single_elimination", "swiss", "single_elimination"],
    minTeams: 32,
    description: "SE qualifier narrows to 16 → Swiss (16→8) → SE finals.",
  },
  {
    id: "de_swiss_single_elimination",
    name: "DE Qualifier → Swiss → SE",
    stageTypes: ["double_elimination", "swiss", "single_elimination"],
    minTeams: 32,
    description: "DE qualifier narrows to 16 → Swiss (16→8) → SE finals.",
  },
];

export const TIER_LABELS: Record<RoundTier, string> = {
  standard: "Standard Rounds",
  quarterfinals: "Quarterfinals",
  semifinals: "Semifinals",
  finals: "Finals",
};
export const BO_OPTIONS: BestOf[] = [1, 3, 5, 7];

export function getNumGroups(teams: number): number {
  if (teams > 32) return 8;
  if (teams > 16) return 4;
  return 2;
}

export function getDefaultGroupAdvancing(teams: number): number {
  const ng = getNumGroups(teams);
  const natural = Math.floor((teams * 3) / 4);
  return Math.floor(natural / ng) * ng;
}

const STAGE_COLORS: Record<
  StageType,
  { border: string; bg: string; label: string; divider: string }
> = {
  group: {
    border: "border-blue-700",
    bg: "bg-blue-950/60",
    label: "text-blue-300",
    divider: "bg-blue-800/40",
  },
  swiss: {
    border: "border-purple-700",
    bg: "bg-purple-950/60",
    label: "text-purple-300",
    divider: "bg-purple-800/40",
  },
  single_elimination: {
    border: "border-emerald-700",
    bg: "bg-emerald-950/60",
    label: "text-emerald-300",
    divider: "bg-emerald-800/40",
  },
  double_elimination: {
    border: "border-orange-700",
    bg: "bg-orange-950/60",
    label: "text-orange-300",
    divider: "bg-orange-800/40",
  },
};

const STAGE_LABELS: Record<StageType, string> = {
  group: "Group Stage",
  swiss: "Swiss",
  single_elimination: "Single Elim",
  double_elimination: "Double Elim",
};

export const TIER_ORDER: RoundTier[] = ["standard", "quarterfinals", "semifinals", "finals"];
export const DEFAULT_BEST_OF: Record<RoundTier, BestOf> = {
  standard: 3, quarterfinals: 3, semifinals: 3, finals: 3,
};

export function applyBestOfCascade(
  current: Record<RoundTier, BestOf>,
  changedTier: RoundTier,
  newValue: BestOf
): Record<RoundTier, BestOf> {
  const result = { ...current, [changedTier]: newValue };
  const tierIdx = TIER_ORDER.indexOf(changedTier);
  // Push higher tiers up if they're below the new value
  for (let i = tierIdx + 1; i < TIER_ORDER.length; i++) {
    const tier = TIER_ORDER[i];
    if (result[tier] < newValue) result[tier] = newValue;
  }
  // Pull lower tiers down if they're above the new value
  for (let i = tierIdx - 1; i >= 0; i--) {
    const tier = TIER_ORDER[i];
    if (result[tier] > newValue) result[tier] = newValue;
  }
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isPowerOf2(n: number): boolean {
  return n > 1 && (n & (n - 1)) === 0;
}

function computeStageInfos(
  preset: PresetDef,
  teams: number,
  groupMaxAdvancing: number | null
): StageInfo[] {
  if (teams < preset.minTeams) return [];
  if (preset.maxTeams !== undefined && teams > preset.maxTeams) return [];

  switch (preset.id) {
    case "single_elimination":
      return [
        {
          type: "single_elimination",
          label: "Single Elimination",
          start: teams,
          end: 1,
          hasByes: !isPowerOf2(teams),
        },
      ];

    case "double_elimination":
      return [
        {
          type: "double_elimination",
          label: "Double Elimination",
          start: teams,
          end: 1,
          hasByes: !isPowerOf2(teams),
        },
      ];

    case "group_single_elimination": {
      const ng = getNumGroups(teams);
      const adv = groupMaxAdvancing ?? getDefaultGroupAdvancing(teams);
      const perGroup = Math.floor(adv / ng);
      return [
        {
          type: "group",
          label: "Group Stage",
          start: teams,
          end: adv,
          detail: `${ng} groups · ${perGroup} advance each`,
        },
        {
          type: "single_elimination",
          label: "Single Elimination",
          start: adv,
          end: 1,
          hasByes: !isPowerOf2(adv),
        },
      ];
    }

    case "group_swiss_single_elimination": {
      const ng = getNumGroups(teams);
      const perGroup = Math.floor(16 / ng);
      return [
        {
          type: "group",
          label: "Group Stage",
          start: teams,
          end: 16,
          detail: `${ng} groups · ${perGroup} advance each`,
        },
        { type: "swiss", label: "Swiss", start: 16, end: 8 },
        { type: "single_elimination", label: "Single Elimination", start: 8, end: 1 },
      ];
    }

    case "group_swiss_hybrid": {
      const ng = getNumGroups(teams);
      return [
        {
          type: "group",
          label: "Group Stage",
          start: teams,
          end: 20,
          detail: `${ng} groups · 1st → UB · 2nd–5th → Swiss`,
        },
        { type: "swiss", label: "Swiss", start: 16, end: 8, detail: "16 teams → top 8 to LB" },
        { type: "double_elimination", label: "Hybrid(12)", start: 12, end: 1, detail: "4 UB + 8 LB" },
      ];
    }

    case "group_swiss_hybrid_8": {
      const ng = getNumGroups(teams);
      return [
        {
          type: "group",
          label: "Group Stage",
          start: teams,
          end: 12,
          detail: `${ng} groups · 1st → UB · 2nd–3rd → Swiss`,
        },
        { type: "swiss", label: "Swiss", start: 8, end: 4, detail: "8 teams → top 4 to LB" },
        { type: "double_elimination", label: "Hybrid(8)", start: 8, end: 1, detail: "4 UB + 4 LB" },
      ];
    }

    case "se_swiss_single_elimination":
      return [
        {
          type: "single_elimination",
          label: "SE Qualifier",
          start: teams,
          end: 16,
          hasByes: !isPowerOf2(teams),
        },
        { type: "swiss", label: "Swiss", start: 16, end: 8 },
        { type: "single_elimination", label: "Single Elimination", start: 8, end: 1 },
      ];

    case "de_swiss_single_elimination":
      return [
        {
          type: "double_elimination",
          label: "DE Qualifier",
          start: teams,
          end: 16,
          hasByes: !isPowerOf2(teams),
        },
        { type: "swiss", label: "Swiss", start: 16, end: 8 },
        { type: "single_elimination", label: "Single Elimination", start: 8, end: 1 },
      ];

    default:
      return [];
  }
}

function getPresetSaveError(preset: PresetDef, actualTeams: number): string | null {
  if (actualTeams <= 0) return null;
  if (actualTeams < preset.minTeams)
    return `Requires ≥ ${preset.minTeams} teams (current: ${actualTeams})`;
  if (preset.maxTeams !== undefined && actualTeams > preset.maxTeams)
    return `Max ${preset.maxTeams} teams for this format (current: ${actualTeams})`;
  return null;
}

// ── Stage flow visualization ───────────────────────────────────────────────────

function StageFlow({ stages }: { stages: StageInfo[] }) {
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex items-center gap-4 min-w-max">
        {stages.flatMap((stage, i) => {
          const c = STAGE_COLORS[stage.type];
          const box = (
            <div
              key={`box-${i}`}
              className={`flex items-stretch rounded-xl border-2 ${c.border} ${c.bg} overflow-hidden`}
            >
              {/* In count */}
              <div className="flex flex-col items-center justify-center px-4 py-3 min-w-[52px]">
                <span className="text-[10px] text-white/50 mb-1">In</span>
                <span className="text-2xl font-bold text-white leading-none">{stage.start}</span>
              </div>

              <div className={`w-px self-stretch ${c.divider}`} />

              {/* Label + detail */}
              <div className="flex flex-col items-center justify-center px-5 py-3 gap-1">
                <span className={`text-sm font-bold whitespace-nowrap ${c.label}`}>
                  {stage.label}
                </span>
                {stage.detail && (
                  <span className="text-[10px] text-white/40 whitespace-nowrap">{stage.detail}</span>
                )}
                {stage.hasByes && (
                  <span className="text-[10px] text-yellow-400/60 whitespace-nowrap">byes apply</span>
                )}
              </div>

              <div className={`w-px self-stretch ${c.divider}`} />

              {/* Out count */}
              <div className="flex flex-col items-center justify-center px-4 py-3 min-w-[52px]">
                <span className="text-[10px] text-white/50 mb-1">Out</span>
                <span className="text-2xl font-bold text-white leading-none">{stage.end}</span>
              </div>
            </div>
          );

          if (i < stages.length - 1) {
            return [
              box,
              <span
                key={`arrow-${i}`}
                className="text-2xl text-zinc-600 select-none flex-shrink-0"
              >
                →
              </span>,
            ];
          }
          return [box];
        })}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface FormatEditorProps {
  initialFormat: SeasonFormatConfig | null;
  initialParticipants?: number;
  actualTeams?: number;
  isAdmin: boolean;
}

export function FormatEditor({
  initialFormat,
  initialParticipants = 16,
  actualTeams = 0,
  isAdmin,
}: FormatEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [previewTeamsRaw, setPreviewTeamsRaw] = useState(String(Math.max(4, Math.min(64, initialParticipants))));
  const previewTeams = Math.max(4, Math.min(64, parseInt(previewTeamsRaw, 10) || 4));
  const [selected, setSelected] = useState<PresetId | null>(initialFormat?.preset ?? null);
  const [seedingMethod, setSeedingMethod] = useState<"balanced" | "random">(
    initialFormat?.groupSeedingMethod ?? "balanced"
  );
  const [maxAdvancingInput, setMaxAdvancingInput] = useState(
    initialFormat?.groupMaxAdvancing != null ? String(initialFormat.groupMaxAdvancing) : ""
  );
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [roundBestOf, setRoundBestOf] = useState<Record<RoundTier, BestOf>>({
    ...DEFAULT_BEST_OF,
    ...(initialFormat?.roundBestOf ?? {}),
  });

  const selectedPreset = PRESETS.find((p) => p.id === selected);
  const hasGroupStage =
    selected === "group_single_elimination" || selected === "group_swiss_single_elimination" || selected === "group_swiss_hybrid" || selected === "group_swiss_hybrid_8";
  const groupAdvancingFixed = selected === "group_swiss_single_elimination" || selected === "group_swiss_hybrid" || selected === "group_swiss_hybrid_8";

  const numGroups = getNumGroups(previewTeams);
  const parsed = maxAdvancingInput.trim() === "" ? null : parseInt(maxAdvancingInput, 10);
  const effectiveMaxAdvancing = parsed !== null && !isNaN(parsed) ? parsed : null;

  const hasUnsavedChanges =
    selected !== (initialFormat?.preset ?? null) ||
    (hasGroupStage && seedingMethod !== (initialFormat?.groupSeedingMethod ?? "balanced")) ||
    (hasGroupStage && effectiveMaxAdvancing !== (initialFormat?.groupMaxAdvancing ?? null)) ||
    TIER_ORDER.some((tier) => roundBestOf[tier] !== (initialFormat?.roundBestOf?.[tier] ?? DEFAULT_BEST_OF[tier]));

  let maxAdvancingError: string | null = null;
  if (hasGroupStage && !groupAdvancingFixed && effectiveMaxAdvancing !== null) {
    const maxAllowed = getDefaultGroupAdvancing(previewTeams);
    if (effectiveMaxAdvancing < numGroups) {
      maxAdvancingError = `Minimum ${numGroups} (one per group).`;
    } else if (effectiveMaxAdvancing % numGroups !== 0) {
      maxAdvancingError = `Must be a multiple of ${numGroups} (groups for ${previewTeams} teams).`;
    } else if (effectiveMaxAdvancing > maxAllowed) {
      maxAdvancingError = `Cannot exceed ¾ of teams: max ${maxAllowed} for ${previewTeams} teams.`;
    }
  }

  const stageInfos = selectedPreset
    ? computeStageInfos(selectedPreset, previewTeams, effectiveMaxAdvancing)
    : [];

  const saveBlockReason: string | null = selectedPreset
    ? getPresetSaveError(selectedPreset, actualTeams)
    : null;

  const canSave =
    selected !== null &&
    !maxAdvancingError &&
    !(maxAdvancingInput !== "" && (parsed === null || isNaN(parsed)));

  const handleSave = () => {
    if (!selected) return;
    startTransition(async () => {
      const config: SeasonFormatConfig = { preset: selected, roundBestOf };
      if (hasGroupStage) {
        config.groupSeedingMethod = seedingMethod;
        if (!groupAdvancingFixed) config.groupMaxAdvancing = effectiveMaxAdvancing;
      }
      const result = await saveSeasonFormat(config);
      if (result?.error) {
        setSaveError(result.error);
      } else {
        setSaved(true);
        setSaveError(null);
        router.refresh();
        setTimeout(() => setSaved(false), 3000);
      }
    });
  };

  // ── Read-only (season page) ──────────────────────────────────────────────────
  if (!isAdmin) {
    if (!initialFormat || !selectedPreset) {
      return <p className="text-zinc-500 text-sm">No season format configured yet.</p>;
    }
    const readOnlyStages = computeStageInfos(
      selectedPreset,
      Math.max(selectedPreset.minTeams, previewTeams),
      initialFormat.groupMaxAdvancing ?? null
    );
    const savedBestOf: Record<RoundTier, BestOf> = { ...DEFAULT_BEST_OF, ...(initialFormat.roundBestOf ?? {}) };
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-400">Format:</span>
          <span className="text-white font-medium">{selectedPreset.name}</span>
          {initialFormat.groupSeedingMethod && (
            <span className="text-zinc-500">· {initialFormat.groupSeedingMethod} seeding</span>
          )}
        </div>
        <StageFlow stages={readOnlyStages} />
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {TIER_ORDER.map((tier) => (
            <span key={tier} className="text-xs text-zinc-500">
              {TIER_LABELS[tier]}: <span className="text-zinc-300">BO{savedBestOf[tier]}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ── Admin editor ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Preview + actual team info */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">Preview with</label>
          <input
            type="number"
            value={previewTeamsRaw}
            onChange={(e) => setPreviewTeamsRaw(e.target.value)}
            className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-white text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield]"
          />
          <span className="text-xs text-zinc-500">teams</span>
        </div>
        {actualTeams > 0 && (
          <p className="text-xs text-zinc-500">
            Current team pool: <span className="text-zinc-300">{actualTeams}</span>
          </p>
        )}
      </div>

      {/* Preset cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {PRESETS.map((preset) => {
          const isSelected = selected === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => {
                setSelected(preset.id);
                // Clamp the preview count into this preset's valid range
                const n = parseInt(previewTeamsRaw, 10) || 4;
                const lo = preset.minTeams;
                const hi = preset.maxTeams ?? 64;
                const clamped = Math.max(lo, Math.min(hi, n));
                if (clamped !== n) setPreviewTeamsRaw(String(clamped));
              }}
              className={`text-left p-4 rounded-xl border transition-all ${
                isSelected
                  ? "border-indigo-500 bg-indigo-950/50 ring-1 ring-indigo-500/50"
                  : "border-zinc-700 bg-zinc-800 hover:border-zinc-500"
              }`}
            >
              <p className="text-sm font-semibold text-white">{preset.name}</p>
              <p className="text-xs text-zinc-500 mt-1">{preset.description}</p>
              <p className="text-xs mt-2 text-zinc-600">
                {preset.maxTeams
                  ? `${preset.minTeams}–${preset.maxTeams} teams`
                  : `≥ ${preset.minTeams} teams`}
              </p>
              <div className="flex gap-1 mt-2 flex-wrap">
                {preset.stageTypes.map((s, i) => (
                  <span
                    key={i}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${STAGE_COLORS[s].border} ${STAGE_COLORS[s].bg} ${STAGE_COLORS[s].label}`}
                  >
                    {STAGE_LABELS[s]}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Group stage settings */}
      {hasGroupStage && selected && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
          <p className="text-sm font-medium text-zinc-300">Group Stage Settings</p>

          <div>
            <p className="text-xs text-zinc-500 mb-2">Team seeding</p>
            <div className="flex gap-2">
              {(["balanced", "random"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setSeedingMethod(m)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    seedingMethod === m
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
              <p className="text-xs text-zinc-500 mb-1">
                Max teams advancing{" "}
                <span className="text-zinc-600">
                  (multiple of {numGroups} · default {getDefaultGroupAdvancing(previewTeams)})
                </span>
              </p>
              <input
                type="number"
                value={maxAdvancingInput}
                onChange={(e) => setMaxAdvancingInput(e.target.value)}
                placeholder={String(getDefaultGroupAdvancing(previewTeams))}
                className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield]"
              />
              {maxAdvancingError && (
                <p className="text-xs text-red-400 mt-1">{maxAdvancingError}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
            {selected === "group_swiss_hybrid"
              ? "1st → UB (4 teams) · 2nd–5th → Swiss (16 teams). Fixed by format."
              : selected === "group_swiss_hybrid_8"
              ? "1st → UB (4 teams) · 2nd–3rd → Swiss (8 teams). Fixed by format."
              : "Advancing is fixed at 16 to feed the Swiss stage."}
          </p>
          )}
        </div>
      )}

      {/* Best Of settings */}
      {selected && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
          <p className="text-sm font-medium text-zinc-300">Best Of Settings</p>
          {TIER_ORDER.map((tier) => (
            <div key={tier} className="flex items-center gap-4">
              <span className="text-xs text-zinc-500 w-24 sm:w-36 shrink-0">{TIER_LABELS[tier]}</span>
              <div className="flex gap-2">
                {BO_OPTIONS.map((bo) => (
                  <button
                    key={bo}
                    onClick={() => setRoundBestOf((prev) => applyBestOfCascade(prev, tier, bo))}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      roundBestOf[tier] === bo
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
      )}

      {/* Stage visualization */}
      {stageInfos.length > 0 && (
        <div>
          <p className="text-xs text-zinc-600 mb-3">Preview · {previewTeams} teams</p>
          <StageFlow stages={stageInfos} />
        </div>
      )}


      {/* Save */}
      <div className="flex flex-wrap items-center gap-4 pt-2">
        <button
          onClick={handleSave}
          disabled={!canSave || isPending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "Saving…" : "Save Format"}
        </button>
        {hasUnsavedChanges && !saved && (
          <p className="text-sm text-amber-400">Unsaved changes — press Save Format to apply.</p>
        )}
        {saveBlockReason && (
          <p className="text-sm text-amber-400">⚠ {saveBlockReason} — season start will be blocked until this is met.</p>
        )}
        {saved && <p className="text-sm text-green-400">Saved!</p>}
        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
      </div>
    </div>
  );
}
