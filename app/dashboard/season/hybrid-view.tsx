import { supabaseAdmin } from "@/app/lib/supabase";
import { HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF, HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF } from "@/app/lib/bracket";
import { BracketCanvas } from "./bracket-canvas";

// ── Layout constants ───────────────────────────────────────────────────────────

const MW = 210;  // match card width
const MH = 66;   // match card height (header + 2 team rows)
const UNIT = MW + 80; // 290 — one column + gap

// ── Types ──────────────────────────────────────────────────────────────────────

type MatchRow = {
  id: string;
  round: number;
  match_number: number;
  stage: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
};
type TeamMap = Record<string, { name: string; logo_url: string | null }>;

type Node = {
  key: string;          // `${stage}-${round}-${mn}` — links to the DB match
  x: number;            // left
  y: number;            // center-Y
  badge: string;        // short ID — doubles as the click-to-pan target (data-match-id)
  label?: string;       // group title rendered above this node
  homeFeeder?: string;  // "Winner of X" / "Loser of X" shown when home slot is empty
  awayFeeder?: string;
};
type Edge = { f: string; t: string };  // f/t are node keys
type Layout = { nodes: Node[]; edges: Edge[]; CW: number; CH: number };

// ── Per-variant layouts ─────────────────────────────────────────────────────────
// LB Round 1 → LB QF → Semifinals → Grand Final are aligned in one horizontal row.
// The Upper Bracket sits on top of the column that feeds the Semifinals, so UB → SF
// lines drop cleanly in the gap. There are deliberately NO lines from the Upper
// Bracket down into the Lower Bracket (the loser drops) — those use clickable
// "Loser of X" labels instead, like Double Elimination.

function buildLayout12(UB: string, LB: string, SF: string, GF: string): Layout {
  const X = (c: number) => c * UNIT;
  const nodes: Node[] = [
    { key: `${UB}-1-1`, x: X(0), y: 70,  badge: "UB M1", label: "Upper Bracket" },
    { key: `${UB}-1-2`, x: X(0), y: 170, badge: "UB M2" },

    { key: `${LB}-1-1`, x: X(0), y: 300, badge: "LB1 M1", label: "Lower Bracket R1" },
    { key: `${LB}-1-2`, x: X(0), y: 390, badge: "LB1 M2" },
    { key: `${LB}-1-3`, x: X(0), y: 480, badge: "LB1 M3" },
    { key: `${LB}-1-4`, x: X(0), y: 570, badge: "LB1 M4" },

    { key: `${LB}-2-1`, x: X(1), y: 345, badge: "LB2 M1", label: "Lower Bracket R2",
      homeFeeder: "Winner of LB1 M1", awayFeeder: "Winner of LB1 M2" },
    { key: `${LB}-2-2`, x: X(1), y: 525, badge: "LB2 M2",
      homeFeeder: "Winner of LB1 M3", awayFeeder: "Winner of LB1 M4" },

    { key: `${LB}-3-1`, x: X(2), y: 345, badge: "LBQF M1", label: "Lower Bracket QF",
      homeFeeder: "Winner of LB2 M1", awayFeeder: "Loser of UB M1" },
    { key: `${LB}-3-2`, x: X(2), y: 525, badge: "LBQF M2",
      homeFeeder: "Winner of LB2 M2", awayFeeder: "Loser of UB M2" },

    { key: `${SF}-1-1`, x: X(3), y: 345, badge: "SF M1", label: "Semifinals",
      homeFeeder: "Winner of UB M1", awayFeeder: "Winner of LBQF M1" },
    { key: `${SF}-1-2`, x: X(3), y: 525, badge: "SF M2",
      homeFeeder: "Winner of UB M2", awayFeeder: "Winner of LBQF M2" },

    { key: `${GF}-1-1`, x: X(4), y: 435, badge: "GF", label: "Grand Final",
      homeFeeder: "Winner of SF M1", awayFeeder: "Winner of SF M2" },
  ];
  const edges: Edge[] = [
    { f: `${LB}-1-1`, t: `${LB}-2-1` },
    { f: `${LB}-1-2`, t: `${LB}-2-1` },
    { f: `${LB}-1-3`, t: `${LB}-2-2` },
    { f: `${LB}-1-4`, t: `${LB}-2-2` },
    { f: `${LB}-2-1`, t: `${LB}-3-1` },
    { f: `${LB}-2-2`, t: `${LB}-3-2` },
    { f: `${LB}-3-1`, t: `${SF}-1-1` },
    { f: `${LB}-3-2`, t: `${SF}-1-2` },
    { f: `${SF}-1-1`, t: `${GF}-1-1` },
    { f: `${SF}-1-2`, t: `${GF}-1-1` },
  ];
  return { nodes, edges, CW: X(4) + MW + 48, CH: 660 };
}

function buildLayout8(UB: string, LB: string, SF: string, GF: string): Layout {
  const X = (c: number) => c * UNIT;
  const nodes: Node[] = [
    { key: `${UB}-1-1`, x: X(0), y: 70,  badge: "UB M1", label: "Upper Bracket" },
    { key: `${UB}-1-2`, x: X(0), y: 170, badge: "UB M2" },

    { key: `${LB}-1-1`, x: X(0), y: 300, badge: "LB1 M1", label: "Lower Bracket R1" },
    { key: `${LB}-1-2`, x: X(0), y: 410, badge: "LB1 M2" },

    { key: `${LB}-2-1`, x: X(1), y: 300, badge: "LBQF M1", label: "Lower Bracket QF",
      homeFeeder: "Winner of LB1 M1", awayFeeder: "Loser of UB M1" },
    { key: `${LB}-2-2`, x: X(1), y: 410, badge: "LBQF M2",
      homeFeeder: "Winner of LB1 M2", awayFeeder: "Loser of UB M2" },

    { key: `${SF}-1-1`, x: X(2), y: 300, badge: "SF M1", label: "Semifinals",
      homeFeeder: "Winner of UB M1", awayFeeder: "Winner of LBQF M1" },
    { key: `${SF}-1-2`, x: X(2), y: 410, badge: "SF M2",
      homeFeeder: "Winner of UB M2", awayFeeder: "Winner of LBQF M2" },

    { key: `${GF}-1-1`, x: X(3), y: 355, badge: "GF", label: "Grand Final",
      homeFeeder: "Winner of SF M1", awayFeeder: "Winner of SF M2" },
  ];
  const edges: Edge[] = [
    { f: `${LB}-1-1`, t: `${LB}-2-1` },
    { f: `${LB}-1-2`, t: `${LB}-2-2` },
    { f: `${LB}-2-1`, t: `${SF}-1-1` },
    { f: `${LB}-2-2`, t: `${SF}-1-2` },
    { f: `${SF}-1-1`, t: `${GF}-1-1` },
    { f: `${SF}-1-2`, t: `${GF}-1-1` },
  ];
  return { nodes, edges, CW: X(3) + MW + 48, CH: 490 };
}

// ── Match card ──────────────────────────────────────────────────────────────────

function statusStyle(status: string, hasTeams: boolean) {
  if (status === "completed") return { border: "border-emerald-600/70 bg-emerald-950/30", tag: "text-emerald-400", label: "FINAL" };
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

function MatchCard({ node, match, teams }: { node: Node; match: MatchRow | undefined; teams: TeamMap }) {
  const home = match?.home_team_id ? teams[match.home_team_id] : null;
  const away = match?.away_team_id ? teams[match.away_team_id] : null;
  const done = match?.status === "completed";
  const homeWon = done && (match!.home_score ?? 0) > (match!.away_score ?? 0);
  const awayWon = done && (match!.away_score ?? 0) > (match!.home_score ?? 0);
  const { border, tag, label } = statusStyle(match?.status ?? "pending", !!(home && away));

  const rows = [
    { team: home, score: match?.home_score ?? null, won: homeWon, feeder: node.homeFeeder },
    { team: away, score: match?.away_score ?? null, won: awayWon, feeder: node.awayFeeder },
  ];

  return (
    <div
      className={`absolute rounded-lg overflow-hidden border ${border}`}
      style={{ left: node.x, top: Math.round(node.y - MH / 2), width: MW, height: MH }}
      data-match-id={node.badge}
    >
      <div className="flex items-center justify-between px-2.5 border-b border-zinc-700/40" style={{ height: 22 }}>
        <span className="text-[10px] font-bold text-zinc-400 tracking-wide">{node.badge}</span>
        <span className={`text-[9px] font-semibold uppercase tracking-widest ${tag}`}>{label}</span>
      </div>
      {rows.map(({ team, score, won, feeder }, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 px-2.5 ${won ? "bg-white/5" : ""}`}
          style={{ height: 21 }}
        >
          {team?.logo_url ? (
            <img src={team.logo_url} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
          ) : (
            <div className={`w-2 h-2 rounded-full shrink-0 ${team ? "bg-zinc-400" : "bg-zinc-700"}`} />
          )}
          {team ? (
            <span className={`flex-1 truncate text-xs ${won ? "text-white font-semibold" : "text-zinc-300"}`}>
              {team.name}
            </span>
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

export async function HybridBracketView({ variant = "12" }: { variant?: "12" | "8" }) {
  const stages = variant === "8"
    ? [HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF]
    : [HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF];

  const { data: matches } = await supabaseAdmin
    .from("matches")
    .select("id, round, match_number, stage, home_team_id, away_team_id, home_score, away_score, status")
    .in("stage", stages)
    .order("stage")
    .order("round")
    .order("match_number");

  if (!matches?.length) {
    return <p className="text-zinc-500 text-sm">Hybrid bracket has not been generated yet.</p>;
  }

  const teamIds = [...new Set(
    matches.flatMap(m => [m.home_team_id, m.away_team_id].filter(Boolean) as string[])
  )];
  const teams: TeamMap = {};
  if (teamIds.length) {
    const { data: teamsData } = await supabaseAdmin
      .from("teams").select("id, name, logo_url").in("id", teamIds);
    (teamsData ?? []).forEach(t => { teams[t.id] = { name: t.name, logo_url: (t as { logo_url?: string | null }).logo_url ?? null }; });
  }

  const [UB, LB, SF, GF] = stages;
  const { nodes, edges, CW, CH } = variant === "8"
    ? buildLayout8(UB, LB, SF, GF)
    : buildLayout12(UB, LB, SF, GF);

  const matchByKey = new Map<string, MatchRow>();
  for (const m of matches as MatchRow[]) matchByKey.set(`${m.stage}-${m.round}-${m.match_number}`, m);
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
              style={{ position: "absolute", left: n.x, top: Math.round(n.y - MH / 2 - 22), width: MW }}
              className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider whitespace-nowrap"
            >
              {n.label}
            </div>
          ))}

          {/* Match cards */}
          {nodes.map(n => (
            <MatchCard key={n.key} node={n} match={matchByKey.get(n.key)} teams={teams} />
          ))}

        </div>
      </BracketCanvas>
    </div>
  );
}
