const PRESET_LABELS: Record<string, string> = {
  single_elimination: "Single Elimination",
  double_elimination: "Double Elimination",
  group_single_elimination: "Group → Single Elimination",
  group_swiss_single_elimination: "Group → Swiss → SE",
  group_swiss_hybrid: "Group → Swiss → Hybrid(12)",
  group_swiss_hybrid_8: "Group → Swiss → Hybrid(8)",
  se_swiss_single_elimination: "SE Qualifier → Swiss → SE",
  de_swiss_single_elimination: "DE Qualifier → Swiss → SE",
};

export function presetLabel(preset: string | null | undefined): string | null {
  if (!preset) return null;
  return PRESET_LABELS[preset] ?? preset;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

type Player = { username: string; displayName: string | null };

export type PastEvent = {
  id: string;
  kind: "season" | "tournament";
  name: string;
  formatLabel: string | null;
  teamCount: number | null;
  champion: string | null;
  runnerUp: string | null;
  championPlayers: Player[];
  runnerUpPlayers: Player[];
  date: string | null;
};

function PlayerPills({ players }: { players: Player[] }) {
  if (players.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {players.map((p) => (
        <span key={p.username} className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700/60 rounded-full text-[10px] text-zinc-400">
          {p.displayName ?? p.username}
        </span>
      ))}
    </div>
  );
}

function EventCard({ e }: { e: PastEvent }) {
  const big = e.kind === "season";
  const meta = [
    e.formatLabel,
    e.teamCount && e.teamCount > 0 ? `${e.teamCount} teams` : null,
    fmtDate(e.date),
  ].filter(Boolean) as string[];

  return (
    <div
      className={`bg-zinc-900 border rounded-xl ${
        big ? "border-amber-700/40 p-5" : "border-zinc-800 p-3"
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`font-semibold text-white ${big ? "text-lg" : "text-sm"}`}>{e.name}</span>
        <span
          className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
            big
              ? "bg-amber-900/40 border-amber-700/50 text-amber-300"
              : "bg-zinc-800 border-zinc-700 text-zinc-400"
          }`}
        >
          {e.kind}
        </span>
      </div>

      {meta.length > 0 && (
        <div className={`text-zinc-500 mt-1 flex flex-wrap gap-x-4 gap-y-0.5 ${big ? "text-sm" : "text-xs"}`}>
          {meta.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      )}

      {e.champion ? (
        <div className="mt-2 space-y-1">
          <p className={`text-amber-300 ${big ? "text-sm" : "text-xs"}`}>
            🏆 {e.champion}
          </p>
          <PlayerPills players={e.championPlayers} />
        </div>
      ) : (
        <p className={`text-zinc-600 mt-2 ${big ? "text-sm" : "text-xs"}`}>No champion recorded</p>
      )}
    </div>
  );
}

export function PastEvents({ events }: { events: PastEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-300 mb-3">Past Events</h2>
      <div className="space-y-3">
        {events.map((e) => (
          <EventCard key={`${e.kind}-${e.id}`} e={e} />
        ))}
      </div>
    </div>
  );
}
