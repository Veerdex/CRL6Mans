"use client";

export type ScheduleMatch = {
  id: string;
  stage: string;
  round: number;
  match_number: number;
  scheduled_at: string | null;
  confirmed: boolean; // time is locked in (computed server-side)
  home_team_name: string;
  away_team_name: string;
};

function stageName(stage: string): string {
  if (stage === "single_elimination") return "SE";
  if (stage === "double_elimination_winners") return "DE Winners";
  if (stage === "double_elimination_losers") return "DE Losers";
  if (stage === "double_elimination_grand_final") return "Grand Final";
  if (stage === "swiss") return "Swiss";
  if (stage === "se_qualifier") return "SE Qualifier";
  if (stage === "de_qualifier_winners") return "DEQ Winners";
  if (stage === "de_qualifier_losers") return "DEQ Losers";
  const gm = stage.match(/^group_(\d+)$/);
  if (gm) return `Group ${gm[1]}`;
  return stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function roundLabel(stage: string, round: number): string {
  return `${stageName(stage)} · R${round}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatDateHeading(iso: string): string {
  const d = new Date(iso);
  const now = new Date();

  const sameCalendarDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (sameCalendarDay(d, now)) return "Today";
  if (sameCalendarDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function MatchCard({
  m,
  showTime,
  confirmed,
}: {
  m: ScheduleMatch;
  showTime: boolean;
  confirmed: boolean;
}) {
  return (
    <div className="px-5 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">
          {m.home_team_name}
          <span className="text-zinc-500 mx-2 font-normal">vs</span>
          {m.away_team_name}
        </p>
        <p className="text-[11px] text-zinc-500 mt-0.5">{roundLabel(m.stage, m.round)}</p>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {showTime && m.scheduled_at && (
          <span className={`text-xs ${confirmed ? "text-emerald-300" : "text-zinc-400"}`}>
            {formatTime(m.scheduled_at)}
          </span>
        )}
        {confirmed ? (
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide">
            Confirmed
          </span>
        ) : showTime ? (
          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-700/30 px-2 py-0.5 rounded-full uppercase tracking-wide">
            Pending
          </span>
        ) : (
          <span className="text-[10px] font-bold text-zinc-500 bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
            TBD
          </span>
        )}
      </div>
    </div>
  );
}

export function ScheduleView({ matches }: { matches: ScheduleMatch[] }) {
  const confirmed = matches.filter((m) => m.confirmed);
  const pending   = matches.filter((m) => m.scheduled_at && !m.confirmed);
  const none      = matches.filter((m) => !m.scheduled_at);

  // Group confirmed matches by calendar day (in the user's local timezone)
  const byDate = new Map<string, ScheduleMatch[]>();
  for (const m of confirmed) {
    const k = dateKey(m.scheduled_at!);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k)!.push(m);
  }

  if (matches.length === 0) {
    return <p className="text-sm text-zinc-600">No upcoming matches.</p>;
  }

  return (
    <div className="space-y-8">
      {byDate.size > 0 ? (
        <div className="space-y-6">
          {[...byDate.entries()].map(([, dayMatches]) => (
            <div key={dayMatches[0].scheduled_at!}>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                {formatDateHeading(dayMatches[0].scheduled_at!)}
              </p>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800">
                {dayMatches.map((m) => (
                  <MatchCard key={m.id} m={m} showTime confirmed />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-600">No confirmed match times yet.</p>
      )}

      {pending.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Proposed (awaiting confirmation)
          </p>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800">
            {pending.map((m) => (
              <MatchCard key={m.id} m={m} showTime confirmed={false} />
            ))}
          </div>
        </div>
      )}

      {none.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Unscheduled
          </p>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800">
            {none.map((m) => (
              <MatchCard key={m.id} m={m} showTime={false} confirmed={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
