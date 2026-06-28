import { supabaseAdmin } from "@/app/lib/supabase";
import { SWISS_STAGE, SWISS_ADVANCE_WINS, SWISS8_ADVANCE_WINS } from "@/app/lib/bracket";
import { BracketCanvas } from "./bracket-canvas";

// ── Layout constants ───────────────────────────────────────────────────────────

const MW = 210;  // match / group box width
const MH = 28;   // match row height (single horizontal row)
const MG = 0;    // no gap between match rows (dividers handle separation)
const GH = 28;   // group header height
const GP = 6;    // group vertical padding (top + bottom)
const CG = 48;   // horizontal connector gap between round columns
const BW = 148;  // badge column width
const BG = 28;   // gap between badge column and next round column
const TH = 36;   // top header row height (round labels)

const UNIT = MW + CG;  // 258 — one round-column + connector gap
const BCOL = BW + BG;  // 176 — one badge column + gap

// group height given n matches
function gH(n: number) { return GH + 2 * GP + n * MH + Math.max(0, n - 1) * MG; }

// ── Connector transition type ──────────────────────────────────────────────────

type Trans = {
  sR: number; sW: number; sL: number;
  dR: number; dW: number; dL: number;
  kind: "winner" | "loser";
  badge: boolean;
};

// ── Per-variant layout (16-team 3W/3L Swiss vs 8-team 2W/2L Swiss) ──────────────

type SwissLayout = {
  threshold: number;                 // wins to qualify / losses to eliminate
  rounds: number[];                  // round columns to label
  RX: Record<number, number>;        // X by round
  BX: Record<number, number>;        // X of badge column by "after round R"
  GCNT: Record<string, number>;      // match count per "round-w-l"
  GROUP_CY: Record<string, number>;  // group center-Y by "w-l"
  BADGE_CY: Record<string, number>;  // badge center-Y by "w-l"
  TRANS: Trans[];
  CW: number;
  CH: number;
};

// 16-team Swiss: 3 wins qualify, 3 losses eliminate. R1–R5, badges after R3/R4/R5.
const RX16: Record<number, number> = {
  1: 0,
  2: UNIT,
  3: 2 * UNIT,
  4: 3 * UNIT + BCOL,
  5: 3 * UNIT + BCOL + UNIT + BCOL,
};
const BX16: Record<number, number> = {
  3: 3 * UNIT,
  4: RX16[4] + MW + CG,
  5: RX16[5] + MW + CG,
};
const LAYOUT_16: SwissLayout = {
  threshold: SWISS_ADVANCE_WINS,
  rounds: [1, 2, 3, 4, 5],
  RX: RX16,
  BX: BX16,
  GCNT: {
    "1-0-0": 8,
    "2-1-0": 4, "2-0-1": 4,
    "3-2-0": 2, "3-1-1": 4, "3-0-2": 2,
    "4-2-1": 3, "4-1-2": 3,
    "5-2-2": 3,
  },
  GROUP_CY: {
    "0-0": 240,
    "1-0": 158, "0-1": 322,
    "2-0": 104, "1-1": 240, "0-2": 376,
    "2-1": 172, "1-2": 308,
    "2-2": 240,
  },
  BADGE_CY: {
    "3-0":  85, "0-3": 395,
    "3-1": 147, "1-3": 333,
    "3-2": 178, "2-3": 302,
  },
  TRANS: [
    { sR:1,sW:0,sL:0, dR:2,dW:1,dL:0, kind:"winner", badge:false },
    { sR:1,sW:0,sL:0, dR:2,dW:0,dL:1, kind:"loser",  badge:false },
    { sR:2,sW:1,sL:0, dR:3,dW:2,dL:0, kind:"winner", badge:false },
    { sR:2,sW:1,sL:0, dR:3,dW:1,dL:1, kind:"loser",  badge:false },
    { sR:2,sW:0,sL:1, dR:3,dW:1,dL:1, kind:"winner", badge:false },
    { sR:2,sW:0,sL:1, dR:3,dW:0,dL:2, kind:"loser",  badge:false },
    { sR:3,sW:2,sL:0, dR:3,dW:3,dL:0, kind:"winner", badge:true  },
    { sR:3,sW:2,sL:0, dR:4,dW:2,dL:1, kind:"loser",  badge:false },
    { sR:3,sW:1,sL:1, dR:4,dW:2,dL:1, kind:"winner", badge:false },
    { sR:3,sW:1,sL:1, dR:4,dW:1,dL:2, kind:"loser",  badge:false },
    { sR:3,sW:0,sL:2, dR:4,dW:1,dL:2, kind:"winner", badge:false },
    { sR:3,sW:0,sL:2, dR:3,dW:0,dL:3, kind:"loser",  badge:true  },
    { sR:4,sW:2,sL:1, dR:4,dW:3,dL:1, kind:"winner", badge:true  },
    { sR:4,sW:2,sL:1, dR:5,dW:2,dL:2, kind:"loser",  badge:false },
    { sR:4,sW:1,sL:2, dR:5,dW:2,dL:2, kind:"winner", badge:false },
    { sR:4,sW:1,sL:2, dR:4,dW:1,dL:3, kind:"loser",  badge:true  },
    { sR:5,sW:2,sL:2, dR:5,dW:3,dL:2, kind:"winner", badge:true  },
    { sR:5,sW:2,sL:2, dR:5,dW:2,dL:3, kind:"loser",  badge:true  },
  ],
  CW: BX16[5] + BW + 20,
  CH: 460,
};

// 8-team Swiss (hybrid_8): 2 wins qualify, 2 losses eliminate. R1–R3, badges after R2/R3.
const RX8: Record<number, number> = {
  1: 0,
  2: UNIT,
  3: 2 * UNIT + BCOL,
};
const BX8: Record<number, number> = {
  2: 2 * UNIT,
  3: RX8[3] + MW + CG,
};
const LAYOUT_8: SwissLayout = {
  threshold: SWISS8_ADVANCE_WINS,
  rounds: [1, 2, 3],
  RX: RX8,
  BX: BX8,
  GCNT: {
    "1-0-0": 4,
    "2-1-0": 2, "2-0-1": 2,
    "3-1-1": 2,
  },
  GROUP_CY: {
    "0-0": 200,
    "1-0": 110, "0-1": 290,
    "1-1": 200,
  },
  BADGE_CY: {
    "2-0": 85, "0-2": 315,
    "2-1": 140, "1-2": 260,
  },
  TRANS: [
    { sR:1,sW:0,sL:0, dR:2,dW:1,dL:0, kind:"winner", badge:false },
    { sR:1,sW:0,sL:0, dR:2,dW:0,dL:1, kind:"loser",  badge:false },
    { sR:2,sW:1,sL:0, dR:2,dW:2,dL:0, kind:"winner", badge:true  },
    { sR:2,sW:1,sL:0, dR:3,dW:1,dL:1, kind:"loser",  badge:false },
    { sR:2,sW:0,sL:1, dR:3,dW:1,dL:1, kind:"winner", badge:false },
    { sR:2,sW:0,sL:1, dR:2,dW:0,dL:2, kind:"loser",  badge:true  },
    { sR:3,sW:1,sL:1, dR:3,dW:2,dL:1, kind:"winner", badge:true  },
    { sR:3,sW:1,sL:1, dR:3,dW:1,dL:2, kind:"loser",  badge:true  },
  ],
  CW: BX8[3] + BW + 20,
  CH: 400,
};

// ── Colours ────────────────────────────────────────────────────────────────────

function gColors(w: number, l: number) {
  if (w > l)   return { border: "border-emerald-700", bg: "bg-emerald-950", lbl: "text-emerald-300" };
  if (l > w)   return { border: "border-red-800",     bg: "bg-red-950",     lbl: "text-red-300"     };
  if (w === 0) return { border: "border-indigo-700",  bg: "bg-indigo-950",  lbl: "text-indigo-300"  };
  return         { border: "border-amber-600",        bg: "bg-amber-950",   lbl: "text-amber-300"   };
}

// ── Types ──────────────────────────────────────────────────────────────────────

type DBMatch = {
  id: string; round: number; match_number: number;
  stage: string; status: string;
  home_team_id: string | null; away_team_id: string | null;
  home_score: number | null; away_score: number | null;
};
type Team       = { id: string; name: string; logo_url: string | null };
type GMatch     = DBMatch & { w: number; l: number };
type MatchGroup = { round: number; w: number; l: number; matches: GMatch[] };
type BadgeGroup = { afterRound: number; w: number; l: number; type: "qualified" | "eliminated"; teamIds: string[] };

// ── Helpers ────────────────────────────────────────────────────────────────────

function preRecord(teamId: string, round: number, ms: DBMatch[]) {
  let wins = 0, losses = 0;
  for (const m of ms) {
    if (m.round >= round || m.status !== "completed") continue;
    const isHome = m.home_team_id === teamId;
    const isAway = m.away_team_id === teamId;
    if (!isHome && !isAway) continue;
    const homeWon = (m.home_score ?? 0) > (m.away_score ?? 0);
    if ((isHome && homeWon) || (isAway && !homeWon)) wins++; else losses++;
  }
  return { wins, losses };
}

// ── Component ──────────────────────────────────────────────────────────────────

export async function SwissBracketView() {
  const [{ data: raw }, { data: teamsRaw }, { data: settings }] = await Promise.all([
    supabaseAdmin
      .from("matches")
      .select("id,round,match_number,stage,status,home_team_id,away_team_id,home_score,away_score")
      .eq("stage", SWISS_STAGE)
      .order("round").order("match_number"),
    supabaseAdmin.from("teams").select("id,name,logo_url"),
    supabaseAdmin.from("league_settings").select("season_format").single(),
  ]);

  if (!raw?.length) return <p className="text-zinc-500 text-sm">No Swiss matches found.</p>;

  const isHybrid8 = (settings?.season_format as { preset?: string } | null)?.preset === "group_swiss_hybrid_8";
  const L = isHybrid8 ? LAYOUT_8 : LAYOUT_16;
  const { RX, BX, TRANS, CW, CH } = L;
  const gMatchCnt = (r: number, w: number, l: number) => L.GCNT[`${r}-${w}-${l}`] ?? 4;
  const gCY = (w: number, l: number) => L.GROUP_CY[`${w}-${l}`] ?? L.CH / 2;
  const badgeCY = (w: number, l: number) => L.BADGE_CY[`${w}-${l}`] ?? L.CH / 2;

  const teams: Record<string, Team> = {};
  teamsRaw?.forEach(t => { teams[t.id] = t; });

  const teamTitles: Record<string, string> = {};
  const swissTeamIds = [...new Set((raw ?? []).flatMap(m => [m.home_team_id, m.away_team_id].filter(Boolean) as string[]))];
  if (swissTeamIds.length) {
    const { data: swissPlayers } = await supabaseAdmin
      .from("players")
      .select("team_id, display_name, username, peak_2v2, current_2v2, peak_3v3, current_3v3")
      .in("team_id", swissTeamIds);
    const rvOf = (p: { peak_2v2: string | null; current_2v2: string | null; peak_3v3: string | null; current_3v3: string | null }) =>
      Math.round((Number(p.peak_2v2 ?? 0) + Number(p.current_2v2 ?? 0)) * 0.3 + (Number(p.peak_3v3 ?? 0) + Number(p.current_3v3 ?? 0)) * 0.2);
    const byTeam: Record<string, { display_name: string | null; username: string; peak_2v2: string | null; current_2v2: string | null; peak_3v3: string | null; current_3v3: string | null }[]> = {};
    for (const p of (swissPlayers ?? [])) {
      if (!p.team_id) continue;
      (byTeam[p.team_id] ??= []).push(p as never);
    }
    for (const [tid, roster] of Object.entries(byTeam)) {
      teamTitles[tid] = roster.sort((a, b) => rvOf(b) - rvOf(a)).map(p => `${p.display_name ?? p.username} (${rvOf(p)})`).join("\n");
    }
  }

  // ── Group matches by (round, pre-round W, pre-round L) ────────────────────
  const gMap = new Map<string, GMatch[]>();
  for (const m of raw) {
    if (!m.home_team_id) continue;
    const { wins: w, losses: l } = preRecord(m.home_team_id, m.round, raw);
    const key = `${m.round}-${w}-${l}`;
    if (!gMap.has(key)) gMap.set(key, []);
    gMap.get(key)!.push({ ...m, w, l });
  }
  const groups: MatchGroup[] = [...gMap.entries()]
    .map(([key, matches]) => {
      const [r, w, l] = key.split("-").map(Number);
      return { round: r, w, l, matches: matches.sort((a, b) => a.match_number - b.match_number) };
    })
    .sort((a, b) => a.round - b.round || a.w - b.w);

  // ── Build badge groups ────────────────────────────────────────────────────
  const allTeamIds = [...new Set(raw.flatMap(m =>
    [m.home_team_id, m.away_team_id].filter(Boolean) as string[]
  ))];
  const badgeMap = new Map<string, BadgeGroup>();
  for (const tid of allTeamIds) {
    let w = 0, l = 0, finalR = 0;
    const played = raw
      .filter(m => (m.home_team_id === tid || m.away_team_id === tid) && m.status === "completed")
      .sort((a, b) => a.round - b.round);
    for (const m of played) {
      const isHome = m.home_team_id === tid;
      const homeWon = (m.home_score ?? 0) > (m.away_score ?? 0);
      if ((isHome && homeWon) || (!isHome && !homeWon)) w++; else l++;
      finalR = m.round;
      if (w >= L.threshold || l >= L.threshold) break;
    }
    if (w < L.threshold && l < L.threshold) continue;
    const type = w >= L.threshold ? "qualified" : "eliminated";
    const key  = `${finalR}-${w}-${l}`;
    if (!badgeMap.has(key)) badgeMap.set(key, { afterRound: finalR, w, l, type, teamIds: [] });
    badgeMap.get(key)!.teamIds.push(tid);
  }
  const badges = [...badgeMap.values()];

  // ── Active lookups for connector opacity ──────────────────────────────────
  const activeGroups = new Set(groups.map(g => `${g.round}-${g.w}-${g.l}`));
  const activeBadges = new Set(badges.map(b => `${b.w}-${b.l}`));

  // ── Legend ────────────────────────────────────────────────────────────────
  const legendItems = [
    { cls: "border-emerald-700 bg-emerald-950", label: "Winning record" },
    { cls: "border-red-800 bg-red-950",         label: "Losing record"  },
    { cls: "border-indigo-700 bg-indigo-950",   label: "0 – 0"          },
    { cls: "border-amber-600 bg-amber-950",      label: "Even record"    },
  ];

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {legendItems.map(({ cls, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded border ${cls}`} />
            <span className="text-xs text-zinc-500">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <svg width="22" height="10"><path d="M 0 5 C 6 5 16 5 22 5" stroke="#34d399" strokeWidth="1.5" fill="none" /></svg>
          <span className="text-xs text-zinc-500">Winners path</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="22" height="10"><path d="M 0 5 C 6 5 16 5 22 5" stroke="#f87171" strokeWidth="1.5" fill="none" /></svg>
          <span className="text-xs text-zinc-500">Losers path</span>
        </div>
      </div>

      {/* Pan/zoom canvas */}
      <BracketCanvas>
        <div style={{ width: CW, height: CH, position: "relative" }}>

          {/* ── Connector SVG ──────────────────────────────────────────────── */}
          <svg
            width={CW} height={CH}
            style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
          >
            {TRANS.map((t, i) => {
              const srcN  = gMatchCnt(t.sR, t.sW, t.sL);
              const srcCY = gCY(t.sW, t.sL);
              const yOff  = gH(srcN) * 0.2;
              const exitY = t.kind === "winner" ? srcCY - yOff : srcCY + yOff;
              const srcX  = RX[t.sR] + MW;
              const dstX  = t.badge ? BX[t.sR] : RX[t.dR];
              const dstY  = t.badge ? badgeCY(t.dW, t.dL) : gCY(t.dW, t.dL);

              const srcActive = activeGroups.has(`${t.sR}-${t.sW}-${t.sL}`);
              const dstActive = t.badge
                ? activeBadges.has(`${t.dW}-${t.dL}`)
                : activeGroups.has(`${t.dR}-${t.dW}-${t.dL}`);
              const active = srcActive && dstActive;

              const col = t.kind === "winner" ? "#34d399" : "#f87171";
              const span = dstX - srcX;
              return (
                <path
                  key={i}
                  d={`M ${srcX} ${exitY} C ${srcX + span * 0.45} ${exitY} ${dstX - span * 0.45} ${dstY} ${dstX} ${dstY}`}
                  stroke={active ? col : "#3f3f46"}
                  strokeWidth={active ? 1.5 : 1}
                  strokeOpacity={active ? 0.65 : 0.22}
                  fill="none"
                />
              );
            })}
          </svg>

          {/* ── Round labels ───────────────────────────────────────────────── */}
          {L.rounds.map(r =>
            groups.some(g => g.round === r) ? (
              <div key={r}
                style={{ position: "absolute", top: 0, left: RX[r], width: MW, height: TH }}
                className="flex items-center justify-center">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Round {r}
                </span>
              </div>
            ) : null
          )}

          {/* ── Group boxes ────────────────────────────────────────────────── */}
          {groups.map(g => {
            const cy     = gCY(g.w, g.l);
            const height = gH(g.matches.length);
            const top    = Math.round(cy - height / 2);
            const { border, bg, lbl } = gColors(g.w, g.l);
            const allDone = g.matches.every(m => m.status === "completed");

            return (
              <div
                key={`g-${g.round}-${g.w}-${g.l}`}
                style={{ position: "absolute", top, left: RX[g.round], width: MW }}
                className={`rounded-lg overflow-hidden border ${border} ${bg}`}
              >
                {/* Header */}
                <div
                  className="flex items-center justify-between px-3 border-b border-zinc-700/40"
                  style={{ height: GH }}
                >
                  <span className={`text-xs font-bold ${lbl}`}>{g.w} – {g.l}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest">BO5</span>
                    <span className={`text-[9px] font-semibold uppercase tracking-widest ${allDone ? "text-emerald-400" : "text-amber-400"}`}>
                      {allDone ? "Complete" : "Live"}
                    </span>
                  </div>
                </div>

                {/* Match rows — horizontal side-by-side layout */}
                <div style={{ paddingTop: GP, paddingBottom: GP }}>
                  {g.matches.map((m, idx) => {
                    const done    = m.status === "completed";
                    const homeWon = done && (m.home_score ?? 0) > (m.away_score ?? 0);
                    const awayWon = done && (m.away_score ?? 0) > (m.home_score ?? 0);
                    const hn = m.home_team_id ? (teams[m.home_team_id]?.name ?? "?") : "TBD";
                    const an = m.away_team_id ? (teams[m.away_team_id]?.name ?? "?") : "TBD";
                    return (
                      <div key={m.id}>
                        {idx > 0 && <div className="h-px bg-zinc-700/25 mx-2" />}
                        <div style={{ height: MH }} className="flex items-center gap-1 px-2">
                          {/* Home */}
                          <div className={`flex-1 min-w-0 flex items-center gap-1 text-xs ${homeWon ? "text-white font-semibold" : done ? "text-zinc-500" : "text-zinc-300"}`}>
                            {m.home_team_id && teams[m.home_team_id]?.logo_url ? (
                              <img src={teams[m.home_team_id].logo_url!} alt="" className="w-3.5 h-3.5 rounded shrink-0 object-cover" />
                            ) : null}
                            {m.home_team_id ? (
                              <a href={`/dashboard/teams?search=${encodeURIComponent(hn)}&from=season`} title={teamTitles[m.home_team_id]} className="truncate hover:underline">{hn}</a>
                            ) : (
                              <span className="truncate">{hn}</span>
                            )}
                          </div>
                          {/* Series score / vs */}
                          <span className={`shrink-0 text-[11px] font-mono tabular-nums w-10 text-center ${done ? "font-bold text-white" : "text-zinc-600"}`}>
                            {done ? `${m.home_score} – ${m.away_score}` : "vs"}
                          </span>
                          {/* Away */}
                          <div className={`flex-1 min-w-0 flex items-center justify-end gap-1 text-xs ${awayWon ? "text-white font-semibold" : done ? "text-zinc-500" : "text-zinc-300"}`}>
                            {m.away_team_id ? (
                              <a href={`/dashboard/teams?search=${encodeURIComponent(an)}&from=season`} title={teamTitles[m.away_team_id]} className="truncate hover:underline">{an}</a>
                            ) : (
                              <span className="truncate">{an}</span>
                            )}
                            {m.away_team_id && teams[m.away_team_id]?.logo_url ? (
                              <img src={teams[m.away_team_id].logo_url!} alt="" className="w-3.5 h-3.5 rounded shrink-0 object-cover" />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* ── Qualified / Eliminated badge boxes ─────────────────────────── */}
          {badges.map(b => {
            const cy      = badgeCY(b.w, b.l);
            const badgeH  = GH + 8 + b.teamIds.length * 24 + 8;
            const top     = Math.round(cy - badgeH / 2);
            const isQual  = b.type === "qualified";
            return (
              <div
                key={`b-${b.afterRound}-${b.w}-${b.l}`}
                style={{ position: "absolute", top, left: BX[b.afterRound], width: BW }}
                className={`rounded-lg overflow-hidden border ${isQual ? "border-emerald-700 bg-emerald-950/70" : "border-red-800 bg-red-950/60"}`}
              >
                <div style={{ height: GH }} className="flex items-center px-3 border-b border-zinc-700/30">
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${isQual ? "text-emerald-300" : "text-red-300"}`}>
                    {isQual ? "Qualified" : "Eliminated"}
                  </span>
                </div>
                <div className="pb-2 px-2 pt-1.5 space-y-0.5">
                  {b.teamIds.map(id => (
                    <div key={id} className="flex items-center gap-1.5 px-1 py-0.5 rounded text-xs">
                      {teams[id]?.logo_url ? (
                        <img src={teams[id].logo_url!} alt="" className="w-4 h-4 rounded shrink-0 object-cover" />
                      ) : (
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isQual ? "bg-emerald-400" : "bg-red-400"}`} />
                      )}
                      <span className="truncate flex-1 font-medium text-black">
                        {teams[id]?.name ?? "?"}
                      </span>
                      <span className="text-[10px] shrink-0 ml-1 text-black/60">{b.w}–{b.l}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

        </div>
      </BracketCanvas>
    </div>
  );
}
