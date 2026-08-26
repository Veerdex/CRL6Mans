import type { StageSlotKey } from "@/app/lib/bracket";
import type { PresetId } from "@/app/dashboard/season/format-constants";

// Swiss and hybrid stages come in two sizes depending on how many teams feed
// into them (see the preset descriptions in format-constants.ts) — the emblem
// swaps to match rather than using one generic icon for both.
export function stageEmblem(presetId: PresetId, slotKey: StageSlotKey): string {
  switch (slotKey) {
    case "group":
      return "/format-emblems/group.png";
    case "swiss":
      return presetId === "group_swiss_hybrid_8" ? "/format-emblems/swiss-8.png" : "/format-emblems/swiss-16.png";
    case "hybrid":
      return presetId === "group_swiss_hybrid_8" ? "/format-emblems/hybrid-8.png" : "/format-emblems/hybrid-12.png";
    case "se_qualifier":
    case "single_elimination":
      return "/format-emblems/single-elimination.png";
    case "de_qualifier":
    case "double_elimination":
      return "/format-emblems/double-elimination.png";
  }
}

// Mirrors the per-segment wording baked into PRESET_LABELS in past-events.tsx
// ("Group → Swiss → Hybrid(8)", "SE Qualifier → Swiss → SE", ...) so the name
// under each emblem matches the text it's replacing exactly.
export function stageShortLabel(presetId: PresetId, slotKey: StageSlotKey): string {
  switch (slotKey) {
    case "group":
      return "Group";
    case "swiss":
      return "Swiss";
    case "hybrid":
      return presetId === "group_swiss_hybrid_8" ? "Hybrid(8)" : "Hybrid(12)";
    case "se_qualifier":
      return "SE Qualifier";
    case "de_qualifier":
      return "DE Qualifier";
    case "single_elimination":
      return presetId === "single_elimination" || presetId === "group_single_elimination"
        ? "Single Elimination"
        : "SE";
    case "double_elimination":
      return "Double Elimination";
  }
}
