// Pure presentational Swiss bracket rendering — no supabaseAdmin/server
// imports, safe to render from both the live fetch wrapper (swiss-view.tsx)
// and the client-side archive viewer.

import { SWISS_ADVANCE_WINS, SWISS8_ADVANCE_WINS } from "@/app/lib/bracket";
import { BracketCanvas } from "./bracket-canvas";
import { LiveClock } from "./live-clock";
import { isMatchLive } from "@/app/lib/match-live";
import { DefaultLogo } from "@/app/lib/team-logo";
import { MW, MH, GH, GP, TH, BW, EXIT_FRAC, gH, LAYOUT_8, LAYOUT_16 } from "./swiss-layout";

// ── Colours ────────────────────────────────────────────────────────────────────

function gColors(w: number, l: number) {
  if (w > l)   return { border: "border-emerald-700", bg: "bg-emerald-950", lbl: "text-emerald-300" };
  if (l > w)   return { border: "border-red-800",     bg: "bg-red-950",     lbl: "text-red-300"     };
  if (w === 0) return { border: "border-indigo-700",  bg: "bg-indigo-950",  lbl: "text-indigo-300"  };
  return         { border: "border-amber-600",        bg: "bg-amber-950",   lbl: "text-amber-300"   };
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type DBMatch = {
  id: string; round: number; match_number: number;
  stage: string; status: string;
  home_team_id: string | null; away_team_id: string | null;
  home_score: number | null; away_score: number | null;
  started_at?: string | null;
};
export type Team       = { id: string; name: string; logo_url: string | null };
type GMatch     = DBMatch & { w: number; l: number };
type MatchGroup = { round: number; w: number; l: number; matches: GMatch[] };
type BadgeGroup = { afterRound: number; w: number; l: number; type: "qualified" | "eliminated"; teamIds: string[] };

// ── Crest ──────────────────────────────────────────────────────────────────────

// Squares off against the match row and bleeds back over the row's px-2 so it
// sits flush on the group box's inner edge — home on the left, away on the
// right. A team with no crest gets the number tile the teams tab shows; an
// unassigned slot (TBD) gets nothing, so the label stands alone as before.
function SwissCrest({ team, side }: { team: Team | undefined; side: "home" | "away" }) {
  if (!team) return null;
  const box = `self-stretch w-auto h-auto aspect-square shrink-0 ${side === "home" ? "-ml-2" : "-mr-2"}`;
  if (!team.logo_url) return <DefaultLogo name={team.name} className={`${box} text-[11px]`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={team.logo_url} alt="" className={`${box} object-cover`} />;
}

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

export function SwissBracketDisplay({
  matches: raw, teams, teamTitles, isHybrid8,
}: {
  matches: DBMatch[];
  teams: Record<string, Team>;
  teamTitles: Record<string, string>;
  isHybrid8: boolean;
}) {
  const L = isHybrid8 ? LAYOUT_8 : LAYOUT_16;
  const threshold = isHybrid8 ? SWISS8_ADVANCE_WINS : SWISS_ADVANCE_WINS;
  const { RX, BX, TRANS, CW, CH } = L;
  const gMatchCnt = (r: number, w: number, l: number) => L.GCNT[`${r}-${w}-${l}`] ?? 4;
  const gCY = (w: number, l: number) => L.GROUP_CY[`${w}-${l}`] ?? L.CH / 2;
  const badgeCY = (w: number, l: number) => L.BADGE_CY[`${w}-${l}`] ?? L.CH / 2;

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
      if (w >= threshold || l >= threshold) break;
    }
    if (w < threshold && l < threshold) continue;
    const type = w >= threshold ? "qualified" : "eliminated";
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
              const yOff  = gH(srcN) * EXIT_FRAC;
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
                    const live    = isMatchLive(m);
                    const homeWon = done && (m.home_score ?? 0) > (m.away_score ?? 0);
                    const awayWon = done && (m.away_score ?? 0) > (m.home_score ?? 0);
                    const hn = m.home_team_id ? (teams[m.home_team_id]?.name ?? "?") : "TBD";
                    const an = m.away_team_id ? (teams[m.away_team_id]?.name ?? "?") : "TBD";
                    return (
                      <div key={m.id}>
                        {idx > 0 && <div className="h-px bg-zinc-700/25 mx-2" />}
                        <div style={{ height: MH }} className="flex items-center gap-1 px-2">
                          {/* Home */}
                          <div className={`flex-1 min-w-0 flex self-stretch items-center gap-1.5 text-xs ${homeWon ? "text-white font-semibold" : done ? "text-zinc-500" : "text-zinc-300"}`}>
                            <SwissCrest team={m.home_team_id ? teams[m.home_team_id] : undefined} side="home" />
                            {m.home_team_id ? (
                              <a href={`/dashboard/teams?search=${encodeURIComponent(hn)}&from=season`} title={teamTitles[m.home_team_id]} className="truncate hover:underline">{hn}</a>
                            ) : (
                              <span className="truncate">{hn}</span>
                            )}
                          </div>
                          {/* Series score / live clock / vs — the row has no space
                              above it, so the clock takes the slot the "vs" sits in. */}
                          <span className={`shrink-0 text-[11px] font-mono tabular-nums w-14 text-center ${done ? "font-bold text-white" : live ? "text-cyan-300" : "text-zinc-600"}`}>
                            {done
                              ? `${m.home_score} – ${m.away_score}`
                              : live && m.started_at
                                ? <LiveClock startedAt={m.started_at} />
                                : "vs"}
                          </span>
                          {/* Away */}
                          <div className={`flex-1 min-w-0 flex self-stretch items-center justify-end gap-1.5 text-xs ${awayWon ? "text-white font-semibold" : done ? "text-zinc-500" : "text-zinc-300"}`}>
                            {m.away_team_id ? (
                              <a href={`/dashboard/teams?search=${encodeURIComponent(an)}&from=season`} title={teamTitles[m.away_team_id]} className="truncate hover:underline">{an}</a>
                            ) : (
                              <span className="truncate">{an}</span>
                            )}
                            <SwissCrest team={m.away_team_id ? teams[m.away_team_id] : undefined} side="away" />
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
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={teams[id].logo_url!} alt="" className="w-4 h-4 rounded shrink-0 object-cover" />
                      ) : (
                        <DefaultLogo name={teams[id]?.name ?? ""} className="w-4 h-4 rounded text-[8px]" />
                      )}
                      {/* These were text-black on a near-black box, i.e. unreadable. */}
                      <span className={`truncate flex-1 font-medium ${isQual ? "text-emerald-100" : "text-red-100"}`}>
                        {teams[id]?.name ?? "?"}
                      </span>
                      <span className="text-[10px] shrink-0 ml-1 text-zinc-400">{b.w}–{b.l}</span>
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
