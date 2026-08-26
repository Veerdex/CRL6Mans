import { STAGE_SLOTS_BY_PRESET, type PresetId } from "./season/format-constants";
import { presetLabel } from "./past-events";
import { stageEmblem, stageShortLabel } from "@/app/lib/format-emblems";

function isPresetId(preset: string): preset is PresetId {
  return preset in STAGE_SLOTS_BY_PRESET;
}

// Renders a preset's stage chain as emblem + name per stage (e.g. Group →
// Swiss → Hybrid(8)) instead of the plain arrow-joined text presetLabel()
// produces. Falls back to that plain text for an unrecognized preset id.
export function PresetEmblemRow({ preset, className = "" }: { preset: string | null | undefined; className?: string }) {
  if (!preset) return null;
  if (!isPresetId(preset)) {
    return <span className={className}>{presetLabel(preset)}</span>;
  }
  const stages = STAGE_SLOTS_BY_PRESET[preset].map((slot) => ({
    key: slot.key,
    label: stageShortLabel(preset, slot.key),
  }));

  return (
    <div className={`flex items-center flex-wrap gap-1.5 ${className}`}>
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-zinc-600">→</span>}
          <div className="flex flex-col items-center gap-0.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={stageEmblem(preset, s.key)} alt="" className="w-12 h-12 rounded-md" />
            <span className="text-[15px] text-zinc-400 whitespace-nowrap">{s.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
