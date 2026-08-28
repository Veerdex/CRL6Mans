"use client";

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { placeBets, placeParlayBet, type BetInput, type ParlayLegInput, type BettingMode } from "./actions";
import { getOULines, getTotalSlots, HOUSE_VIG, type MatchPrediction } from "./prediction";
import { LeaderboardView, type LeaderboardEntry } from "./leaderboard-view";
import { MatchOverviewGrid, type OverviewMatch } from "./overview-grid";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toAmericanOdds(prob: number): string {
  const p = Math.max(0.01, Math.min(0.99, prob));
  const vp = Math.min(0.99, p / (1 - HOUSE_VIG));
  if (vp >= 0.5) {
    const raw = Math.round((vp / (1 - vp)) * 100);
    return `-${Math.floor(raw / 10) * 10}`;
  }
  const raw = Math.round(((1 - vp) / vp) * 100);
  return `+${Math.floor(raw / 10) * 10}`;
}

// Converts a decimal multiplier directly to American odds (no additional vig)
function multiplierToAmericanOdds(mult: number): string {
  const imp = Math.max(0.01, Math.min(0.99, 1 / mult));
  if (imp >= 0.5) {
    const raw = Math.round((imp / (1 - imp)) * 100);
    return `-${Math.floor(raw / 10) * 10}`;
  }
  const raw = Math.round(((1 - imp) / imp) * 100);
  return `+${Math.floor(raw / 10) * 10}`;
}

// Converts a displayed American odds string to an exact decimal multiplier.
// +100 → 2.0 (win 100 on 100 stake), -130 → 230/130 ≈ 1.769
function americanOddsToMultiplier(oddsStr: string): number {
  const val = Math.abs(parseInt(oddsStr));
  if (oddsStr.startsWith("+")) return (100 + val) / 100;
  return (val + 100) / val;
}

function toPct(prob: number): string {
  return `${Math.round(Math.max(0, Math.min(1, prob)) * 100)}%`;
}

// Pool-mode probability is the live ratio of stake on each side of a slot —
// falls back to a flat 50/50 while the slot has no money in it.
function poolProb(
  matchId: string,
  sk: string,
  side: string,
  betTypeTotals: Record<string, Record<string, number>>,
): number {
  const totals = betTypeTotals[matchId] ?? {};
  if (sk === "moneyline") {
    const home = totals.home ?? 0;
    const away = totals.away ?? 0;
    const sum = home + away;
    if (sum === 0) return 0.5;
    return (side === "home" ? home : away) / sum;
  }
  const line = sk.replace("ou_", "");
  const over = totals[`over_${line}`] ?? 0;
  const under = totals[`under_${line}`] ?? 0;
  const sum = over + under;
  if (sum === 0) return 0.5;
  return (side === "over" ? over : under) / sum;
}

function getProbForBet(sk: string, betType: string, pred: MatchPrediction): number {
  if (sk === "moneyline") return betType === "home" ? pred.homeWinProb : pred.awayWinProb;
  const line = parseFloat(sk.replace("ou_", ""));
  const ou = pred.ouLines.find((l) => l.line === line);
  if (ou) return betType.startsWith("over") ? ou.overProb : ou.underProb;
  return 0.5;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Team = { id: string; name: string; logo_url: string | null };

type MatchBO = {
  id: string;
  stage: string;
  round: number;
  match_number: number;
  home_team_id: string;
  away_team_id: string;
  status: string;
  scheduled_at: string | null;
  bestOf: number;
  bettingMode: BettingMode;
};

type MyWager = {
  match_id: string;
  bet_type: string;
  amount: number;
  odds_multiplier: number | null; // null means this was a pool-mode bet — payout is set at close
  status: string;
  payout_amount: number | null; // set once a pool-mode bet resolves (won/lost/void); unused for fixed-mode bets
};

type ParlayLeg = {
  matchId: string;
  betType: string;
  oddsMultiplier: number;
  status: string;
};

type MyParlay = {
  id: string;
  amount: number;
  combinedMultiplier: number;
  status: string;
  legs: ParlayLeg[];
};

type TickerWager = {
  id: string;
  player_id: string;
  match_id: string;
  bet_type: string;
  amount: number;
  placed_at: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const FALLBACK_PRED: MatchPrediction = { homeWinProb: 0.5, awayWinProb: 0.5, ouLines: [] };

const MAX_PENDING_BETS = 10;
const MAX_PENDING_PARLAYS = 3;
const MAX_PARLAY_LEGS = 5;

function stageShort(stage: string): string {
  if (stage.startsWith("group_")) return `G${stage.split("_")[1]}`;
  const map: Record<string, string> = {
    swiss: "SW",
    hybrid_ub: "UB", hybrid8_ub: "UB",
    hybrid_lb: "LB", hybrid8_lb: "LB",
    hybrid_sf: "SF", hybrid8_sf: "SF",
    hybrid_gf: "GF", hybrid8_gf: "GF",
    single_elimination: "SE",
    de_winners: "WB", de_losers: "LB",
    de_grand_final: "GF",
  };
  return map[stage] ?? stage.slice(0, 4).toUpperCase();
}

function matchBadge(stage: string, round: number, mn: number): string {
  const s = stageShort(stage);
  if (s === "GF") return "GF";
  return `${s} R${round}M${mn}`;
}

function betDescription(betType: string, homeName: string, awayName: string): string {
  if (betType === "home") return `${homeName} ML`;
  if (betType === "away") return `${awayName} ML`;
  const m = betType.match(/^(over|under)_([\d.]+)$/);
  if (m) return `${m[1] === "over" ? "Over" : "Under"} ${m[2]}`;
  return betType;
}

function slotKey(betType: string): string {
  if (betType === "home" || betType === "away") return "moneyline";
  const m = betType.match(/^(?:over|under)_([\d.]+)$/);
  return m ? `ou_${m[1]}` : betType;
}

function sideFromBetType(betType: string): string {
  if (betType === "home") return "home";
  if (betType === "away") return "away";
  if (betType.startsWith("over")) return "over";
  return "under";
}

function getSlotMultiplier(sk: string, side: string, pred: MatchPrediction): number {
  let prob: number;
  if (sk === "moneyline") {
    prob = side === "home" ? pred.homeWinProb : pred.awayWinProb;
  } else {
    const line = parseFloat(sk.replace("ou_", ""));
    const ou = pred.ouLines.find((l) => l.line === line);
    prob = ou ? (side === "over" ? ou.overProb : ou.underProb) : 0.5;
  }
  // Derive multiplier from the displayed (vigged + floored) American odds so
  // payout always exactly matches what the user sees on the button.
  return americanOddsToMultiplier(toAmericanOdds(prob));
}

function countFilledSlots(betTypes: string[], bestOf: number): number {
  let count = 0;
  if (betTypes.some((t) => t === "home" || t === "away")) count++;
  for (const line of getOULines(bestOf)) {
    if (betTypes.some((t) => t === `over_${line}` || t === `under_${line}`)) count++;
  }
  return count;
}

type SlotStatus = "green" | "yellow" | "red";

function getSlotStatus(matchId: string, wagers: MyWager[], bestOf: number): SlotStatus {
  const betTypes = wagers.filter((w) => w.match_id === matchId).map((w) => w.bet_type);
  const filled = countFilledSlots(betTypes, bestOf);
  const total = getTotalSlots(bestOf);
  if (filled === 0) return "green";
  if (filled >= total) return "red";
  return "yellow";
}

// ── Main component ─────────────────────────────────────────────────────────────

export function WagersClient({
  eventName,
  currentStage,
  matches,
  teams,
  matchPredictions,
  defaultMatchId,
  gridMatches,
  gridWagerTotals,
  betTypeTotals,
  teamStandings,
  matchRosters,
  myWagers: initialWagers,
  myParlays,
  tickerWagers: _tickerWagers,
  tickerPlayers: _tickerPlayers,
  coinBalance,
  currentUsername,
  leaderboard,
  sponsoredByLine,
}: {
  eventName: string;
  currentStage: string;
  matches: MatchBO[];
  teams: Record<string, Team>;
  matchPredictions: Record<string, MatchPrediction>;
  defaultMatchId: string;
  gridMatches: OverviewMatch[];
  gridWagerTotals: Record<string, { home: number; away: number }>;
  betTypeTotals: Record<string, Record<string, number>>;
  teamStandings: Record<string, number>;
  matchRosters: Record<string, Record<string, { name: string; rating: number; isSub: boolean }[]>>;
  myWagers: MyWager[];
  myParlays: MyParlay[];
  tickerWagers: TickerWager[];
  tickerPlayers: Record<string, { username: string; display_name: string | null }>;
  coinBalance: number;
  currentUsername: string;
  leaderboard: LeaderboardEntry[];
  sponsoredByLine?: ReactNode;
}) {
  const [selectedMatchId, setSelectedMatchId] = useState(defaultMatchId || matches[0]?.id || "");
  const [straightSelections, setStraightSelections] = useState<Record<string, { betType: string; amount: string }>>({});
  const [parlaySelections, setParlaySelections] = useState<Record<string, { betType: string; amount: string }>>({});
  const [betMode, setBetMode] = useState<"straight" | "parlay">("straight");
  const [parlayAmount, setParlayAmount] = useState("100");
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard — set before the first await so a rapid second click
  // (before `submitting` re-renders the disabled button) can't fire a 2nd request.
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [localBalance, setLocalBalance] = useState(coinBalance);
  const [localWagers, setLocalWagers] = useState<MyWager[]>(initialWagers);
  // Match IDs the user has committed a parlay to (parlays aren't tracked in localWagers).
  const [parlayMatchIds, setParlayMatchIds] = useState<Set<string>>(new Set());
  const [localParlays, setLocalParlays] = useState<MyParlay[]>(myParlays);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showMyBets, setShowMyBets] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [leaderboardSearch, setLeaderboardSearch] = useState("");
  // Mobile: only one pane is shown at a time (3 columns is desktop-only).
  const [mobileTab, setMobileTab] = useState<"matches" | "market" | "slip">("matches");
  const selectedMatch = matches.find((m) => m.id === selectedMatchId) ?? matches[0];

  useEffect(() => { setError(null); setSuccessMsg(null); }, [selectedMatchId]);

  const bettableMatchIds = useMemo(() => new Set(matches.map((m) => m.id)), [matches]);

  const allSelections = useMemo(
    () => Object.entries(betMode === "straight" ? straightSelections : parlaySelections),
    [betMode, straightSelections, parlaySelections],
  );

  const totalCost = useMemo(
    () => allSelections.reduce((s, [, v]) => s + (parseInt(v.amount) || 0), 0),
    [allSelections],
  );

  const combinedMultiplier = useMemo(() => allSelections.reduce((product, [key, sel]) => {
    const parts = key.split(":");
    const matchId = parts[0];
    const sk = parts.slice(1).join(":");
    const pred = matchPredictions[matchId] ?? FALLBACK_PRED;
    return product * getSlotMultiplier(sk, sideFromBetType(sel.betType), pred);
  }, 1), [allSelections, matchPredictions]);

  const parlayPayout = Math.round((parseInt(parlayAmount) || 0) * combinedMultiplier);

  // Pool-mode legs have no fixed multiplier — their payout isn't known until the
  // match closes, so they're excluded from this sum (see hasPoolSelections below).
  const totalPayout = useMemo(() => allSelections.reduce((sum, [key, sel]) => {
    const parts = key.split(":");
    const matchId = parts[0];
    const sk = parts.slice(1).join(":");
    if (matches.find((m) => m.id === matchId)?.bettingMode === "pool") return sum;
    const pred = matchPredictions[matchId] ?? FALLBACK_PRED;
    const mult = getSlotMultiplier(sk, sideFromBetType(sel.betType), pred);
    return sum + Math.round((parseInt(sel.amount) || 0) * mult);
  }, 0), [allSelections, matchPredictions, matches]);

  const hasPoolSelections = useMemo(
    () => allSelections.some(([key]) => matches.find((m) => m.id === key.split(":")[0])?.bettingMode === "pool"),
    [allSelections, matches],
  );

  function handleSideClick(matchId: string, sk: string, side: string) {
    const betType = sk === "moneyline" ? side : `${side}_${sk.replace("ou_", "")}`;
    const key = `${matchId}:${sk}`;
    const isParlay = betMode === "parlay";
    const current = isParlay ? parlaySelections : straightSelections;
    const setFn = isParlay ? setParlaySelections : setStraightSelections;
    const isToggleOff = current[key]?.betType === betType;

    // Pool-mode matches have no fixed multiplier, so they can't price into a parlay.
    if (isParlay && !isToggleOff) {
      const m = matches.find((mm) => mm.id === matchId);
      if (m?.bettingMode === "pool") {
        setError("Pool-mode matches can't be added to a parlay.");
        return;
      }
    }

    // Cap parlay legs
    if (!isToggleOff && isParlay && !current[key] && Object.keys(current).length >= MAX_PARLAY_LEGS) {
      setError(`A parlay can have at most ${MAX_PARLAY_LEGS} legs`);
      return;
    }
    setError(null);

    setFn((prev) => {
      if (prev[key]?.betType === betType) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { betType, amount: prev[key]?.amount ?? "100" } };
    });
  }

  function handleAmountChange(fullKey: string, value: string) {
    setStraightSelections((prev) => ({ ...prev, [fullKey]: { ...prev[fullKey], amount: value } }));
  }

  function handleRemoveBet(fullKey: string) {
    const setFn = betMode === "straight" ? setStraightSelections : setParlaySelections;
    setFn((prev) => { const next = { ...prev }; delete next[fullKey]; return next; });
  }

  async function handleSubmit() {
    if (submittingRef.current) return;
    setError(null);
    setSuccessMsg(null);

    const allBets: BetInput[] = allSelections.map(([key, sel]) => {
      const parts = key.split(":");
      const matchId = parts[0];
      const sk = parts.slice(1).join(":");
      const pred = matchPredictions[matchId] ?? FALLBACK_PRED;
      const mult = getSlotMultiplier(sk, sideFromBetType(sel.betType), pred);
      return { matchId, betType: sel.betType, amount: parseInt(sel.amount) || 0, oddsMultiplier: mult };
    });

    if (!allBets.length) { setError("No bets selected"); return; }
    if (allBets.some((b) => b.amount < 10)) { setError("Each bet must be at least 10 Westside Wages"); return; }
    if (allBets.reduce((s, b) => s + b.amount, 0) > localBalance) { setError("Insufficient Westside Wages"); return; }
    const pendingBetCount = localWagers.filter((w) => w.status === "pending").length;
    if (pendingBetCount + allBets.length > MAX_PENDING_BETS) {
      setError(`You can have at most ${MAX_PENDING_BETS} pending bets (you have ${pendingBetCount}).`);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await placeBets(allBets);
      if (result.error) {
        setError(result.error);
      } else {
        const spent = allBets.reduce((s, b) => s + b.amount, 0);
        setLocalBalance((b) => b - spent);
        setLocalWagers((prev) => [
          ...prev,
          ...allBets.map((b) => {
            const isPool = matches.find((m) => m.id === b.matchId)?.bettingMode === "pool";
            return {
              match_id: b.matchId,
              bet_type: b.betType,
              amount: b.amount,
              odds_multiplier: isPool ? null : b.oddsMultiplier,
              status: "pending",
              payout_amount: null,
            };
          }),
        ]);
        setStraightSelections({});
        setSuccessMsg(`${allBets.length} bet${allBets.length > 1 ? "s" : ""} placed!`);
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  async function handleParlaySubmit() {
    if (submittingRef.current) return;
    setError(null);
    setSuccessMsg(null);
    const amount = parseInt(parlayAmount) || 0;
    if (allSelections.length < 2) { setError("A parlay requires at least 2 legs"); return; }
    if (allSelections.length > MAX_PARLAY_LEGS) { setError(`A parlay can have at most ${MAX_PARLAY_LEGS} legs`); return; }
    if (amount < 10) { setError("Minimum parlay bet is 10 Westside Wages"); return; }
    if (amount > localBalance) { setError("Insufficient Westside Wages"); return; }
    const pendingParlayCount = localParlays.filter((p) => p.status === "pending").length;
    if (pendingParlayCount >= MAX_PENDING_PARLAYS) {
      setError(`You can have at most ${MAX_PENDING_PARLAYS} pending parlays.`);
      return;
    }

    const legs: ParlayLegInput[] = allSelections.map(([key, sel]) => {
      const parts = key.split(":");
      const matchId = parts[0];
      const sk = parts.slice(1).join(":");
      const pred = matchPredictions[matchId] ?? FALLBACK_PRED;
      return { matchId, betType: sel.betType, oddsMultiplier: getSlotMultiplier(sk, sideFromBetType(sel.betType), pred) };
    });

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await placeParlayBet(legs, amount, combinedMultiplier);
      if (result.error) {
        setError(result.error);
      } else {
        setLocalBalance((b) => b - amount);
        setParlayMatchIds((prev) => {
          const next = new Set(prev);
          legs.forEach((l) => next.add(l.matchId));
          return next;
        });
        setLocalParlays((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}`,
            amount,
            combinedMultiplier,
            status: "pending",
            legs: legs.map((l) => ({
              matchId: l.matchId,
              betType: l.betType,
              oddsMultiplier: l.oddsMultiplier,
              status: "pending",
            })),
          },
        ]);
        setParlaySelections({});
        setParlayAmount("100");
        setSuccessMsg(`Parlay placed! Potential payout: 🪙 ${parlayPayout.toLocaleString()}`);
        setTimeout(() => setSuccessMsg(null), 5000);
      }
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    // pb clears the app's fixed mobile bottom-nav on phones (hidden ≥ md).
    <div className="flex flex-col h-full overflow-hidden pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h1 className="text-base font-bold text-white truncate">{eventName}</h1>
            {sponsoredByLine}
          </div>
          {currentStage && <p className="text-xs text-zinc-500 truncate">{currentStage}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setShowOverview((v) => !v); setShowMyBets(false); setShowLeaderboard(false); setMobileTab("market"); }}
            title="All Matches"
            className={[
              "flex items-center justify-center w-8 h-8 rounded-lg border transition-colors",
              showOverview
                ? "bg-indigo-600/20 border-indigo-500 text-indigo-400"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500",
            ].join(" ")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => { setShowMyBets((v) => !v); setShowLeaderboard(false); setShowOverview(false); setMobileTab("market"); }}
            title="My Bets"
            className={[
              "flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-semibold transition-colors",
              showMyBets
                ? "bg-emerald-600/20 border-emerald-500 text-emerald-400"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500",
            ].join(" ")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16a2 2 0 0 1 2 2v4a2 2 0 0 0 0 4v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 0 0-4V6a2 2 0 0 1 2-2z" />
              <path d="M9 9h6M9 13h6" />
            </svg>
            My Bets
          </button>
          <button
            onClick={() => { setShowLeaderboard((v) => !v); setShowMyBets(false); setShowOverview(false); setMobileTab("market"); }}
            title="Leaderboard"
            className={[
              "flex items-center justify-center w-8 h-8 rounded-lg border transition-colors",
              showLeaderboard
                ? "bg-amber-600/20 border-amber-500 text-amber-400"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500",
            ].join(" ")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
              <path d="M4 22h16" />
              <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
              <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
              <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
            </svg>
          </button>
          <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5">
            <span className="text-sm">🪙</span>
            <span className="text-sm font-semibold text-amber-400">{localBalance.toLocaleString()}</span>
            <span className="text-xs text-zinc-500 hidden sm:inline">Westside Wages</span>
          </div>
        </div>
      </div>

      {showOverview ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-zinc-900">
          <MatchOverviewGrid
            matches={gridMatches}
            teams={teams}
            wagerTotals={gridWagerTotals}
            bettableMatchIds={bettableMatchIds}
            onSelectMatch={(id) => {
              setSelectedMatchId(id);
              setShowOverview(false);
              setMobileTab("market");
            }}
          />
        </div>
      ) : !selectedMatch && !showMyBets && !showLeaderboard ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center p-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">Wagers</h1>
          <p className="text-zinc-500 text-lg sm:text-xl">No matches available for betting right now.</p>
        </div>
      ) : (
      <>
      {/* Mobile pane switcher (desktop shows all three panes side-by-side) */}
      <div className="lg:hidden flex border-b border-zinc-800 bg-zinc-950 shrink-0">
        {([
          { key: "matches", label: "Matches" },
          { key: "market", label: showLeaderboard ? "Leaderboard" : showMyBets ? "My Bets" : "Market" },
          { key: "slip", label: "Slip" },
        ] as const).map((t) => {
          const active = mobileTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setMobileTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                active ? "border-indigo-500 text-indigo-400" : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
              {t.key === "slip" && allSelections.length > 0 && (
                <span className="text-[10px] bg-indigo-600 text-white rounded-full px-1.5 py-0.5 font-bold leading-none">
                  {allSelections.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left: Game list ── */}
        <div className={`w-full lg:w-[260px] shrink-0 border-r border-zinc-800 flex-col overflow-hidden bg-zinc-950 ${mobileTab === "matches" ? "flex" : "hidden"} lg:flex`}>
          <div className="px-4 py-2.5 border-b border-zinc-800">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Matches</p>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {matches.map((m) => {
              const isSelected = m.id === selectedMatchId;
              const home = teams[m.home_team_id];
              const away = teams[m.away_team_id];
              const pred = matchPredictions[m.id] ?? FALLBACK_PRED;
              const badge = matchBadge(m.stage, m.round, m.match_number);
              const status = getSlotStatus(m.id, localWagers, m.bestOf);
              const hasPlacedBet =
                localWagers.some((w) => w.match_id === m.id) || parlayMatchIds.has(m.id);
              const hasSelection =
                Object.keys(straightSelections).some((k) => k.startsWith(`${m.id}:`)) ||
                Object.keys(parlaySelections).some((k) => k.startsWith(`${m.id}:`));
              const hasBet = hasPlacedBet || hasSelection;
              const isPool = m.bettingMode === "pool";
              const homeProb = isPool ? poolProb(m.id, "moneyline", "home", betTypeTotals) : pred.homeWinProb;
              const awayProb = isPool ? poolProb(m.id, "moneyline", "away", betTypeTotals) : pred.awayWinProb;
              const homeOdds = isPool ? toPct(homeProb) : toAmericanOdds(homeProb);
              const awayOdds = isPool ? toPct(awayProb) : toAmericanOdds(awayProb);
              const activeSelections = betMode === "straight" ? straightSelections : parlaySelections;
              const homeSelected = activeSelections[`${m.id}:moneyline`]?.betType === "home";
              const awaySelected = activeSelections[`${m.id}:moneyline`]?.betType === "away";

              return (
                <button
                  key={m.id}
                  onClick={() => { setSelectedMatchId(m.id); setShowMyBets(false); setShowLeaderboard(false); setMobileTab("market"); }}
                  className={[
                    "w-full text-left px-4 py-3 border-b border-zinc-800/60 border-l-[3px] transition-colors",
                    hasBet ? "border-l-emerald-400" : "border-l-transparent",
                    hasBet
                      ? isSelected
                        ? "bg-emerald-800/50 hover:bg-emerald-800/60"
                        : "bg-emerald-900/40 hover:bg-emerald-900/55"
                      : isSelected
                        ? "bg-zinc-800"
                        : "hover:bg-zinc-900",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">{badge} · BO{m.bestOf}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {hasPlacedBet && (
                        <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-500/50 rounded px-1 py-0.5 uppercase tracking-wide">
                          Bet
                        </span>
                      )}
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        status === "green" ? "bg-emerald-500" : status === "yellow" ? "bg-amber-500" : "bg-red-500"
                      }`} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    {home?.logo_url && <img src={home.logo_url} alt="" className="w-4 h-4 rounded object-cover shrink-0" />}
                    <span className="text-xs font-semibold text-zinc-200 truncate flex-1">{home?.name ?? "?"}</span>
                    <span className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded ${
                      homeSelected ? "bg-indigo-900/70 text-indigo-300 border border-indigo-600" : "text-amber-400"
                    }`}>{homeOdds}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {away?.logo_url && <img src={away.logo_url} alt="" className="w-4 h-4 rounded object-cover shrink-0" />}
                    <span className="text-xs font-semibold text-zinc-400 truncate flex-1">{away?.name ?? "?"}</span>
                    <span className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded ${
                      awaySelected ? "bg-indigo-900/70 text-indigo-300 border border-indigo-600" : "text-amber-400"
                    }`}>{awayOdds}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Center: Market view or Leaderboard ── */}
        <div className={`flex-1 min-w-0 overflow-y-auto overscroll-contain bg-zinc-900 ${mobileTab === "market" ? "block" : "hidden"} lg:block`}>
          {showLeaderboard ? (
            <LeaderboardView
              entries={leaderboard}
              currentUsername={currentUsername}
              search={leaderboardSearch}
              onSearchChange={setLeaderboardSearch}
            />
          ) : showMyBets ? (
            <MyBetsView
              wagers={localWagers}
              parlays={localParlays}
              matches={matches}
              teams={teams}
              onSelectMatch={(id) => { setSelectedMatchId(id); setShowMyBets(false); setMobileTab("market"); }}
            />
          ) : selectedMatch ? (
            <MatchMarketView
              match={selectedMatch}
              teams={teams}
              pred={matchPredictions[selectedMatch.id] ?? FALLBACK_PRED}
              betTypeTotals={betTypeTotals}
              teamStandings={teamStandings}
              roster={matchRosters[selectedMatch.id]}
              localWagers={localWagers}
              selections={betMode === "straight" ? straightSelections : parlaySelections}
              onSideClick={handleSideClick}
            />
          ) : (
            <div className="p-6">
              <p className="text-zinc-500 text-sm">No matches available for betting right now.</p>
            </div>
          )}
        </div>

        {/* ── Right: Bet slip ── */}
        <BetSlip
          mobileActive={mobileTab === "slip"}
          allSelections={allSelections}
          matches={matches}
          teams={teams}
          matchPredictions={matchPredictions}
          betTypeTotals={betTypeTotals}
          localBalance={localBalance}
          totalCost={totalCost}
          totalPayout={totalPayout}
          hasPoolSelections={hasPoolSelections}
          betMode={betMode}
          onBetModeChange={setBetMode}
          parlayAmount={parlayAmount}
          onParlayAmountChange={setParlayAmount}
          combinedMultiplier={combinedMultiplier}
          parlayPayout={parlayPayout}
          submitting={submitting}
          error={error}
          successMsg={successMsg}
          onAmountChange={handleAmountChange}
          onRemove={handleRemoveBet}
          onSubmit={handleSubmit}
          onParlaySubmit={handleParlaySubmit}
        />

      </div>
      </>
      )}
    </div>
  );
}

// ── Market view ───────────────────────────────────────────────────────────────

function MatchMarketView({
  match, teams, pred, betTypeTotals, teamStandings, roster, localWagers, selections, onSideClick,
}: {
  match: MatchBO;
  teams: Record<string, Team>;
  pred: MatchPrediction;
  betTypeTotals: Record<string, Record<string, number>>;
  teamStandings: Record<string, number>;
  roster?: Record<string, { name: string; rating: number; isSub: boolean }[]>;
  localWagers: MyWager[];
  selections: Record<string, { betType: string; amount: string }>;
  onSideClick: (matchId: string, sk: string, side: string) => void;
}) {
  const home = teams[match.home_team_id];
  const away = teams[match.away_team_id];
  const badge = matchBadge(match.stage, match.round, match.match_number);
  const myMatchWagers = localWagers.filter((w) => w.match_id === match.id);
  const isPool = match.bettingMode === "pool";
  const homeProb = isPool ? poolProb(match.id, "moneyline", "home", betTypeTotals) : pred.homeWinProb;
  const awayProb = isPool ? poolProb(match.id, "moneyline", "away", betTypeTotals) : pred.awayWinProb;
  const homeWinPct = Math.round(homeProb * 100);

  const slots = [
    {
      key: "moneyline",
      label: "MONEYLINE",
      sides: [
        { side: "home", betType: "home", prob: homeProb },
        { side: "away", betType: "away", prob: awayProb },
      ],
    },
    ...pred.ouLines.map((ou) => ({
      key: `ou_${ou.line}`,
      label: `${ou.line} GAMES`,
      sides: [
        {
          side: "under",
          betType: `under_${ou.line}`,
          prob: isPool ? poolProb(match.id, `ou_${ou.line}`, "under", betTypeTotals) : ou.underProb,
        },
        {
          side: "over",
          betType: `over_${ou.line}`,
          prob: isPool ? poolProb(match.id, `ou_${ou.line}`, "over", betTypeTotals) : ou.overProb,
        },
      ],
    })),
  ];

  return (
    <div className="w-full px-6 py-8">
      {/* Match header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-5">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{badge}</span>
          <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest">BO{match.bestOf}</span>
        </div>
        <p className="text-center mb-3">
          <span className="inline-block text-[9px] font-bold uppercase tracking-widest text-purple-300 bg-purple-950/50 border border-purple-700/40 rounded-full px-3 py-1">
            🤖 Algorithm Prediction · {home?.name ?? "Home"} {toPct(pred.homeWinProb)} – {toPct(pred.awayWinProb)} {away?.name ?? "Away"}
          </span>
        </p>
        <div className="flex items-center gap-6 mb-5">
          <div className="flex-1 flex flex-col items-center text-center min-w-0">
            {home?.logo_url && (
              <img src={home.logo_url} alt="" className="w-12 h-12 rounded-lg object-cover mb-2" />
            )}
            {teamStandings[match.home_team_id] != null && (
              <span className="text-[10px] font-bold text-zinc-500 tabular-nums mb-1">#{teamStandings[match.home_team_id]}</span>
            )}
            <p className="font-bold text-white text-lg leading-tight truncate w-full">{home?.name ?? "Home"}</p>
            {roster?.[match.home_team_id] && (
              <ul className="mt-1 space-y-0.5">
                {roster[match.home_team_id].map((p, i) => (
                  <li key={i} className="text-[11px] text-zinc-500 tabular-nums truncate">
                    {p.name}{p.isSub ? " (sub)" : ""} · {Math.round(p.rating)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <span className="text-zinc-600 text-sm shrink-0 font-medium">vs</span>
          <div className="flex-1 flex flex-col items-center text-center min-w-0">
            {away?.logo_url && (
              <img src={away.logo_url} alt="" className="w-12 h-12 rounded-lg object-cover mb-2" />
            )}
            {teamStandings[match.away_team_id] != null && (
              <span className="text-[10px] font-bold text-zinc-500 tabular-nums mb-1">#{teamStandings[match.away_team_id]}</span>
            )}
            <p className="font-bold text-white text-lg leading-tight truncate w-full">{away?.name ?? "Away"}</p>
            {roster?.[match.away_team_id] && (
              <ul className="mt-1 space-y-0.5">
                {roster[match.away_team_id].map((p, i) => (
                  <li key={i} className="text-[11px] text-zinc-500 tabular-nums truncate">
                    {p.name}{p.isSub ? " (sub)" : ""} · {Math.round(p.rating)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 tabular-nums w-10 shrink-0">{isPool ? toPct(homeProb) : toAmericanOdds(homeProb)}</span>
          <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${homeWinPct}%` }} />
          </div>
          <span className="text-[10px] text-zinc-500 tabular-nums w-10 shrink-0 text-right">{isPool ? toPct(awayProb) : toAmericanOdds(awayProb)}</span>
        </div>
        {isPool && (
          <p className="text-center text-[10px] text-amber-500/80 mt-2 uppercase tracking-widest font-semibold">Pool Betting — odds move with the money</p>
        )}
      </div>

      {/* Bet markets */}
      <div className="space-y-8">
        {slots.map((slot) => {
          const placed = myMatchWagers.find((w) => slotKey(w.bet_type) === slot.key);
          const selKey = `${match.id}:${slot.key}`;
          const sel = selections[selKey];

          return (
            <div key={slot.key}>
              {slot.key === "moneyline" ? (
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 text-center">
                  {slot.label}
                </p>
              ) : (
                <div className="flex items-center mb-3 max-w-xl mx-auto">
                  <span className="flex-1 text-xs font-bold text-zinc-500 uppercase tracking-widest text-center">Under</span>
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{slot.label}</span>
                  <span className="flex-1 text-xs font-bold text-zinc-500 uppercase tracking-widest text-center">Over</span>
                </div>
              )}

              {placed ? (
                <div className="flex items-center gap-3 rounded-xl bg-emerald-950/40 border border-emerald-700/40 px-4 py-3 max-w-xl mx-auto">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400 shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="text-sm font-medium text-emerald-300 flex-1">
                    {betDescription(placed.bet_type, home?.name ?? "Home", away?.name ?? "Away")}
                  </span>
                  <span className="text-xs text-zinc-500 shrink-0 tabular-nums">
                    {placed.odds_multiplier == null
                      ? `🪙 ${placed.amount.toLocaleString()} → payout set at close`
                      : `🪙 ${placed.amount.toLocaleString()} → ${Math.round(placed.amount * placed.odds_multiplier).toLocaleString()}`}
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-w-xl mx-auto">
                  {slot.sides.map((s) => {
                    const isSelected = sel?.betType === s.betType;
                    return (
                      <button
                        key={s.side}
                        onClick={() => onSideClick(match.id, slot.key, s.side)}
                        className={[
                          "flex items-center justify-center px-4 py-5 rounded-xl border transition-all",
                          isSelected
                            ? "border-indigo-500 bg-indigo-900/40 shadow-lg shadow-indigo-900/20"
                            : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-500 hover:bg-zinc-800",
                        ].join(" ")}
                      >
                        <div className="flex flex-col items-center">
                          <span className={`text-2xl font-bold tabular-nums ${isSelected ? "text-indigo-300" : "text-amber-400"}`}>
                            {isPool ? toPct(s.prob) : toAmericanOdds(s.prob)}
                          </span>
                          {isPool && (
                            <span className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                              🪙 {(betTypeTotals[match.id]?.[s.betType] ?? 0).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Bet slip ──────────────────────────────────────────────────────────────────

function BetSlip({
  mobileActive,
  allSelections, matches, teams, matchPredictions,
  localBalance, totalCost, totalPayout,
  betMode, onBetModeChange,
  parlayAmount, onParlayAmountChange, combinedMultiplier, parlayPayout,
  submitting, error, successMsg,
  onAmountChange, onRemove, onSubmit, onParlaySubmit,
  betTypeTotals, hasPoolSelections,
}: {
  mobileActive: boolean;
  allSelections: [string, { betType: string; amount: string }][];
  matches: MatchBO[];
  teams: Record<string, Team>;
  matchPredictions: Record<string, MatchPrediction>;
  localBalance: number;
  totalCost: number;
  totalPayout: number;
  betMode: "straight" | "parlay";
  onBetModeChange: (m: "straight" | "parlay") => void;
  parlayAmount: string;
  onParlayAmountChange: (v: string) => void;
  combinedMultiplier: number;
  parlayPayout: number;
  submitting: boolean;
  error: string | null;
  successMsg: string | null;
  onAmountChange: (fullKey: string, value: string) => void;
  onRemove: (fullKey: string) => void;
  onSubmit: () => void;
  onParlaySubmit: () => void;
  betTypeTotals: Record<string, Record<string, number>>;
  hasPoolSelections: boolean;
}) {
  const parlayOdds = allSelections.length >= 2 ? multiplierToAmericanOdds(combinedMultiplier) : null;

  return (
    <div className={`w-full lg:w-[300px] shrink-0 border-l border-zinc-800 flex-col bg-zinc-950 ${mobileActive ? "flex" : "hidden"} lg:flex`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-white">Bet Slip</p>
          {allSelections.length > 0 && (
            <span className="text-xs bg-indigo-600 text-white rounded-full px-2 py-0.5 font-semibold">
              {betMode === "parlay" ? `${allSelections.length}/${MAX_PARLAY_LEGS}` : allSelections.length}
            </span>
          )}
        </div>
        {/* Straight / Parlay toggle */}
        <div className="flex bg-zinc-800 rounded-lg p-0.5 gap-0.5">
          {(["straight", "parlay"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onBetModeChange(mode)}
              className={[
                "flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors capitalize",
                betMode === mode
                  ? "bg-zinc-600 text-white"
                  : "text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Legs */}
      <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
        {allSelections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-700">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="8" y1="10" x2="16" y2="10" />
              <line x1="8" y1="14" x2="13" y2="14" />
            </svg>
            <p className="text-zinc-500 text-sm font-medium">Your slip is empty</p>
            <p className="text-zinc-700 text-xs">Click any odds to add a bet</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {allSelections.map(([key, sel]) => {
              const parts = key.split(":");
              const matchId = parts[0];
              const sk = parts.slice(1).join(":");
              const match = matches.find((m) => m.id === matchId);
              const home = match ? teams[match.home_team_id] : null;
              const away = match ? teams[match.away_team_id] : null;
              const pred = matchPredictions[matchId] ?? FALLBACK_PRED;
              const isPool = match?.bettingMode === "pool";
              const amount = parseInt(sel.amount) || 0;
              const badge = match ? matchBadge(match.stage, match.round, match.match_number) : "";
              const desc = betDescription(sel.betType, home?.name ?? "Home", away?.name ?? "Away");
              const side = sideFromBetType(sel.betType);
              const prob = isPool ? poolProb(matchId, sk, side, betTypeTotals) : getProbForBet(sk, sel.betType, pred);
              const odds = isPool ? toPct(prob) : toAmericanOdds(prob);
              const mult = getSlotMultiplier(sk, side, pred);
              const payout = isPool ? null : Math.round(amount * mult);

              return (
                <div key={key} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-wide mb-0.5">{badge}</p>
                      <p className="text-sm font-semibold text-white leading-tight">{desc}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-base font-bold text-amber-400 tabular-nums">{odds}</span>
                      <button onClick={() => onRemove(key)} className="text-zinc-600 hover:text-zinc-300 transition-colors p-0.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* Per-leg amount input — straight mode only */}
                  {betMode === "straight" && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 min-w-0">
                        <span className="text-xs text-zinc-500 shrink-0">🪙</span>
                        <input
                          type="number"
                          min="10"
                          max={localBalance}
                          value={sel.amount}
                          onChange={(e) => onAmountChange(key, e.target.value)}
                          className="flex-1 bg-transparent text-sm text-white font-medium focus:outline-none min-w-0 w-0"
                          placeholder="100"
                        />
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[9px] text-zinc-600 uppercase tracking-wide">Win</p>
                        <p className="text-sm font-bold text-amber-400 tabular-nums">
                          {payout == null ? "at close" : `🪙 ${payout.toLocaleString()}`}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Parlay combined odds summary */}
            {betMode === "parlay" && allSelections.length >= 2 && (
              <div className="px-4 py-4 bg-zinc-900/60">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-zinc-500 uppercase tracking-widest">Combined Odds</p>
                  <p className="text-2xl font-black text-amber-400 tabular-nums">{parlayOdds}</p>
                </div>
                <p className="text-[10px] text-zinc-600">{allSelections.length}-leg parlay · {combinedMultiplier.toFixed(2)}×</p>
              </div>
            )}
            {betMode === "parlay" && allSelections.length === 1 && (
              <div className="px-4 py-3 text-center">
                <p className="text-xs text-zinc-600">Add at least one more leg to build a parlay</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-800 px-4 py-4 shrink-0 space-y-3">
        {betMode === "straight" ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Total Bet</p>
                <p className={`text-lg font-bold ${totalCost > localBalance ? "text-red-400" : "text-white"}`}>
                  🪙 {totalCost.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Total Payout</p>
                <p className="text-lg font-bold text-amber-400">🪙 {totalPayout.toLocaleString()}</p>
              </div>
            </div>
            {hasPoolSelections && (
              <p className="text-[10px] text-zinc-600">Pool-mode legs aren&apos;t included above — their payout is set when the match closes.</p>
            )}
            {error && <div className="px-3 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-xs text-red-300">{error}</div>}
            {successMsg && <div className="px-3 py-2 bg-emerald-900/40 border border-emerald-700/50 rounded-lg text-xs text-emerald-300">✓ {successMsg}</div>}
            <button
              onClick={onSubmit}
              disabled={submitting || allSelections.length === 0 || totalCost > localBalance || totalCost === 0}
              className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
              {submitting ? "Placing…" : allSelections.length > 0 ? `Place ${allSelections.length} Bet${allSelections.length > 1 ? "s" : ""}` : "No Bets Selected"}
            </button>
          </>
        ) : (
          <>
            {/* Parlay single wager input */}
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 min-w-0">
                <span className="text-xs text-zinc-500 shrink-0">🪙</span>
                <input
                  type="number"
                  min="10"
                  max={localBalance}
                  value={parlayAmount}
                  onChange={(e) => onParlayAmountChange(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-white font-medium focus:outline-none min-w-0 w-0"
                  placeholder="100"
                />
              </div>
              <div className="text-right shrink-0">
                <p className="text-[9px] text-zinc-600 uppercase tracking-wide">Payout</p>
                <p className="text-sm font-bold text-amber-400 tabular-nums">🪙 {parlayPayout.toLocaleString()}</p>
              </div>
            </div>
            {error && <div className="px-3 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-xs text-red-300">{error}</div>}
            {successMsg && <div className="px-3 py-2 bg-emerald-900/40 border border-emerald-700/50 rounded-lg text-xs text-emerald-300">✓ {successMsg}</div>}
            <button
              onClick={onParlaySubmit}
              disabled={submitting || allSelections.length < 2 || (parseInt(parlayAmount) || 0) > localBalance || (parseInt(parlayAmount) || 0) < 10}
              className="w-full py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
              {submitting ? "Placing…" : allSelections.length >= 2 ? `Place Parlay (${allSelections.length} legs)` : "Need 2+ Legs"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── My Bets view ──────────────────────────────────────────────────────────────

function BetStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "text-amber-300 bg-amber-500/15 border-amber-500/40",
    won: "text-emerald-300 bg-emerald-500/15 border-emerald-500/40",
    lost: "text-red-300 bg-red-500/15 border-red-500/40",
    push: "text-zinc-300 bg-zinc-500/15 border-zinc-500/40",
    void: "text-zinc-400 bg-zinc-500/15 border-zinc-500/40",
  };
  const cls = styles[status] ?? styles.pending;
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 ${cls}`}>
      {status}
    </span>
  );
}

function MyBetsView({
  wagers, parlays, matches, teams, onSelectMatch,
}: {
  wagers: MyWager[];
  parlays: MyParlay[];
  matches: MatchBO[];
  teams: Record<string, Team>;
  onSelectMatch: (matchId: string) => void;
}) {
  const matchById = useMemo(
    () => Object.fromEntries(matches.map((m) => [m.id, m])),
    [matches],
  );

  function legLabel(matchId: string, betType: string): { badge: string; desc: string } {
    const m = matchById[matchId];
    const home = m ? teams[m.home_team_id] : null;
    const away = m ? teams[m.away_team_id] : null;
    return {
      badge: m ? matchBadge(m.stage, m.round, m.match_number) : "—",
      desc: betDescription(betType, home?.name ?? "Home", away?.name ?? "Away"),
    };
  }

  if (wagers.length === 0 && parlays.length === 0) {
    return (
      <div className="w-full px-6 py-16 max-w-2xl mx-auto text-center">
        <p className="text-zinc-400 text-sm font-medium">You haven&apos;t placed any bets yet.</p>
        <p className="text-zinc-600 text-xs mt-1">Pick a match and click any odds to get started.</p>
      </div>
    );
  }

  const pendingCount =
    wagers.filter((w) => w.status === "pending").length +
    parlays.filter((p) => p.status === "pending").length;
  const atStake =
    wagers.filter((w) => w.status === "pending").reduce((s, w) => s + w.amount, 0) +
    parlays.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const maxPayout =
    wagers
      .filter((w) => w.status === "pending" && w.odds_multiplier != null)
      .reduce((s, w) => s + Math.round(w.amount * w.odds_multiplier!), 0) +
    parlays.filter((p) => p.status === "pending").reduce((s, p) => s + Math.round(p.amount * p.combinedMultiplier), 0);
  const hasPendingPoolWagers = wagers.some((w) => w.status === "pending" && w.odds_multiplier == null);

  return (
    <div className="w-full px-6 py-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <h2 className="text-base font-bold text-white">My Bets</h2>
        <div className="text-right">
          <p className="text-xs text-zinc-500">
            {pendingCount} pending · <span className="text-amber-400 font-semibold">🪙 {atStake.toLocaleString()}</span> at stake
          </p>
          <p className="text-xs text-zinc-500">
            Max payout · <span className="text-emerald-400 font-semibold">🪙 {maxPayout.toLocaleString()}</span>
            {hasPendingPoolWagers && <span className="text-zinc-600"> (+ pool bets, set at close)</span>}
          </p>
        </div>
      </div>

      {/* Straight bets */}
      {wagers.length > 0 && (
        <section className="space-y-2">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Straight Bets</p>
          {wagers.map((w, i) => {
            const { badge, desc } = legLabel(w.match_id, w.bet_type);
            const isPool = w.odds_multiplier == null;
            const odds = isPool ? "Pool" : multiplierToAmericanOdds(w.odds_multiplier!);
            const payoutLabel = isPool
              ? w.status === "pending"
                ? "payout set at close"
                : `🪙 ${w.amount.toLocaleString()} → ${(w.payout_amount ?? 0).toLocaleString()}`
              : `🪙 ${w.amount.toLocaleString()} → ${Math.round(w.amount * w.odds_multiplier!).toLocaleString()}`;
            return (
              <button
                key={`${w.match_id}:${w.bet_type}:${i}`}
                onClick={() => onSelectMatch(w.match_id)}
                className="w-full text-left flex items-center gap-3 rounded-xl bg-zinc-800/50 border border-zinc-800 hover:border-zinc-700 px-4 py-3 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-wide">{badge}</span>
                    <BetStatusBadge status={w.status} />
                  </div>
                  <p className="text-sm font-semibold text-white truncate">{desc}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-amber-400 tabular-nums">{odds}</p>
                  <p className="text-[11px] text-zinc-500 tabular-nums">{payoutLabel}</p>
                </div>
              </button>
            );
          })}
        </section>
      )}

      {/* Parlays */}
      {parlays.length > 0 && (
        <section className="space-y-2">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Parlays</p>
          {parlays.map((p) => {
            const payout = Math.round(p.amount * p.combinedMultiplier);
            const odds = multiplierToAmericanOdds(p.combinedMultiplier);
            return (
              <div key={p.id} className="rounded-xl bg-zinc-800/50 border border-zinc-800 px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wide">
                      {p.legs.length}-Leg Parlay
                    </span>
                    <BetStatusBadge status={p.status} />
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-amber-400 tabular-nums">{odds}</p>
                    <p className="text-[11px] text-zinc-500 tabular-nums">
                      🪙 {p.amount.toLocaleString()} → {payout.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="space-y-1 border-t border-zinc-800 pt-2">
                  {p.legs.map((leg, li) => {
                    const { badge, desc } = legLabel(leg.matchId, leg.betType);
                    return (
                      <button
                        key={`${p.id}:${li}`}
                        onClick={() => onSelectMatch(leg.matchId)}
                        className="w-full text-left flex items-center justify-between gap-2 hover:bg-zinc-800/60 rounded px-1.5 py-1 transition-colors"
                      >
                        <span className="text-xs text-zinc-300 truncate">
                          <span className="text-[10px] font-bold text-zinc-600 uppercase mr-1.5">{badge}</span>
                          {desc}
                        </span>
                        <span className="text-[11px] text-zinc-500 shrink-0">{multiplierToAmericanOdds(leg.oddsMultiplier)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

