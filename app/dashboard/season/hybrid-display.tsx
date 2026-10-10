// Pure presentational Hybrid bracket rendering — no supabaseAdmin/server
// imports, safe to render from both the live fetch wrapper (hybrid-view.tsx)
// and the client-side archive viewer.

import { HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF, HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF } from "@/app/lib/bracket";
import { BracketCanvas } from "./bracket-canvas";
import { LiveClock } from "./live-clock";
import { isMatchLive } from "@/app/lib/match-live";
import { DefaultLogo } from "@/app/lib/team-logo";
import { MW, MH, HEAD_H, LABEL_H, buildLayout8, buildLayout12, type Node } from "./hybrid-layout";

// ── Types ──────────────────────────────────────────────────────────────────────

export type MatchRow = {
  id: string;
  round: number;
  match_number: number;
  stage: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  started_at?: string | null;
};
export type TeamMap = Record<string, { name: string; logo_url: string | null }>;


// ── Match card ──────────────────────────────────────────────────────────────────

function statusStyle(status: string, hasTeams: boolean, live = false) {
  if (status === "completed") return { border: "border-emerald-600/70 bg-emerald-950/30", tag: "text-emerald-400", label: "FINAL" };
  if (live)                   return { border: "border-cyan-500/70 bg-cyan-950/30",       tag: "text-cyan-400",    label: "LIVE" };
  if (hasTeams)               return { border: "border-indigo-500/60 bg-indigo-950/25",  tag: "text-indigo-400",  label: "UPCOMING" };
  return                             { border: "border-zinc-700/60 bg-zinc-900/40",       tag: "text-zinc-600",    label: "TBD" };
}

// Empty-slot text. "Winner of X" / "Loser of X" become clickable + pan via data-goto.
function SlotText({ feeder }: { feeder?: string }) {
  const m = feeder?.match(/^(?:Winner|Loser) of (.+)$/);
  if (feeder && m) {
    return (
      <span
        data-goto={m[1]}
        className="flex-1 truncate text-xs text-zinc-500 underline decoration-dotted underline-offset-2 cursor-pointer hover:text-zinc-300"
      >
        {feeder}
      </span>
    );
  }
  return <span className="flex-1 truncate text-xs text-zinc-600 italic">{feeder ?? "TBD"}</span>;
}

function MatchCard({ node, match, teams, teamTitles, isLeft }: { node: Node; match: MatchRow | undefined; teams: TeamMap; teamTitles: Record<string, string>; isLeft: boolean }) {
  const home = match?.home_team_id ? teams[match.home_team_id] : null;
  const away = match?.away_team_id ? teams[match.away_team_id] : null;
  const done = match?.status === "completed";
  const homeWon = done && (match!.home_score ?? 0) > (match!.away_score ?? 0);
  const awayWon = done && (match!.away_score ?? 0) > (match!.home_score ?? 0);
  const live = !!match && isMatchLive(match);
  const { border, tag, label } = statusStyle(match?.status ?? "pending", !!(home && away), live);

  const rows = [
    { teamId: match?.home_team_id ?? null, team: home, score: match?.home_score ?? null, won: homeWon, feeder: node.homeFeeder },
    { teamId: match?.away_team_id ?? null, team: away, score: match?.away_score ?? null, won: awayWon, feeder: node.awayFeeder },
  ];

  return (
    <div
      className={`absolute flex flex-col rounded-lg overflow-hidden border ${border}`}
      style={{ left: node.x, top: Math.round(node.y - MH / 2), width: MW, height: MH }}
      data-match-id={node.badge}
    >
      <div className="flex shrink-0 items-center justify-between px-2.5 border-b border-zinc-700/40" style={{ height: HEAD_H }}>
        <span className="text-[10px] font-bold text-zinc-400 tracking-wide">{node.badge}</span>
        <span className={`text-[9px] font-semibold uppercase tracking-widest ${tag}`}>
          {label}
          {live && match?.started_at && (
            <LiveClock startedAt={match.started_at} className="ml-1.5 text-cyan-300 tracking-normal" />
          )}
        </span>
      </div>
      {rows.map(({ teamId, team, score, won, feeder }, i) => (
        <div
          key={i}
          className={`flex flex-1 min-h-0 items-center gap-2 px-2.5 ${won ? "bg-white/5" : ""}`}
        >
          {/* Same treatment as the bracket card: the crest fills the row and
              bleeds over px-2.5 to sit flush on the card edge, a team with no
              crest gets its number tile, and an empty slot keeps a dot. */}
          {team?.logo_url ? (
            <img src={team.logo_url} alt="" className="self-stretch w-auto h-auto aspect-square shrink-0 -ml-2.5 object-cover" />
          ) : team ? (
            <DefaultLogo name={team.name} className="self-stretch w-auto h-auto aspect-square -ml-2.5 text-sm" />
          ) : (
            <div className="w-2 h-2 rounded-full shrink-0 bg-zinc-700" />
          )}
          {team ? (
            <a
              href={`/dashboard/teams?search=${encodeURIComponent(team.name)}&from=season`}
              title={teamId ? teamTitles[teamId] : undefined}
              className={`flex-1 truncate text-xs hover:underline ${won ? "text-white font-semibold" : "text-zinc-300"}`}
            >
              {team.name}
            </a>
          ) : (
            <SlotText feeder={feeder} />
          )}
          {done && score !== null && (
            <span className={`text-xs font-mono font-bold tabular-nums shrink-0 ${won ? "text-emerald-400" : "text-zinc-500"}`}>
              {score}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function HybridBracketDisplay({
  variant = "12", matches, teams, teamTitles,
}: {
  variant?: "12" | "8";
  matches: MatchRow[];
  teams: TeamMap;
  teamTitles: Record<string, string>;
}) {
  const stages = variant === "8"
    ? [HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF]
    : [HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF];
  const [UB, LB, SF, GF] = stages;
  const { nodes, edges, CW, CH } = variant === "8"
    ? buildLayout8(UB, LB, SF, GF)
    : buildLayout12(UB, LB, SF, GF);

  const matchByKey = new Map<string, MatchRow>();
  for (const m of matches) matchByKey.set(`${m.stage}-${m.round}-${m.match_number}`, m);
  const nodeByKey = new Map(nodes.map(n => [n.key, n]));

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded border border-emerald-600/70 bg-emerald-950/30" />
          <span className="text-xs text-zinc-500">Completed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded border border-indigo-500/60 bg-indigo-950/25" />
          <span className="text-xs text-zinc-500">Upcoming</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded border border-zinc-700/60 bg-zinc-900/40" />
          <span className="text-xs text-zinc-500">TBD</span>
        </div>
        <span className="text-xs text-zinc-600">Tap a “Winner/Loser of …” slot to jump to that match.</span>
      </div>

      {/* Pan/zoom canvas */}
      <BracketCanvas>
        <div style={{ width: CW, height: CH, position: "relative" }}>

          {/* Connector lines (advancement only — UB→LB drops use labels, not lines) */}
          <svg width={CW} height={CH} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
            {edges.map((e, i) => {
              const s = nodeByKey.get(e.f);
              const d = nodeByKey.get(e.t);
              if (!s || !d) return null;
              const sx = s.x + MW, sy = s.y;
              const dx = d.x,      dy = d.y;
              const span = dx - sx;
              return (
                <path
                  key={i}
                  d={`M ${sx} ${sy} C ${sx + span * 0.5} ${sy} ${dx - span * 0.5} ${dy} ${dx} ${dy}`}
                  stroke="#3f3f46"
                  strokeWidth="1.5"
                  fill="none"
                />
              );
            })}
          </svg>

          {/* Group labels */}
          {nodes.filter(n => n.label).map(n => (
            <div
              key={`lbl-${n.key}`}
              style={{ position: "absolute", left: n.x, top: Math.round(n.y - MH / 2 - LABEL_H), width: MW }}
              className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider whitespace-nowrap"
            >
              {n.label}
            </div>
          ))}

          {/* Match cards */}
          {nodes.map(n => (
            <MatchCard key={n.key} node={n} match={matchByKey.get(n.key)} teams={teams} teamTitles={teamTitles} isLeft={n.x === 0} />
          ))}

        </div>
      </BracketCanvas>
    </div>
  );
}
