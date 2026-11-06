import { LEAGUE_STATUS_LABEL, type FantasyLeagueStatus } from "@/app/lib/fantasy-rules";

export function StatusBadge({ status }: { status: FantasyLeagueStatus }) {
  const tone =
    status === "pre_draft"
      ? "bg-zinc-700 text-zinc-300"
      : status === "drafting"
        ? "bg-amber-500/20 text-amber-300"
        : status === "active"
          ? "bg-emerald-500/20 text-emerald-300"
          : "bg-zinc-700 text-zinc-400";
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${tone}`}>{LEAGUE_STATUS_LABEL[status]}</span>;
}
