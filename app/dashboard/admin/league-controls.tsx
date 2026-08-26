"use client";

import { useState, useTransition, useEffect } from "react";
import { adminStartDraft, adminAutoBalance, adminEndDraft, adminStartSeason, addTestUser, addBulkTestUsers, removeTestUsers, generateTestTeams, resetSeason, openDraftSignups, closeDraftSignups, saveMatchSettings, saveMinMmr, saveSeasonPrizes, forceResetDraftState, setTestingMode, setNotificationsEnabled, stripTeamDiscordRoles, forceTrackerUpdate, setIsTestSeason, setSubsEnabled } from "./league-actions";
import { auditMatchChannels, applyChannelChanges, type ChannelAuditItem, type ChannelAuditResult } from "./channel-debug-actions";
import { ExportAndResetSeasonButton } from "./export-pdf-button";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 24 }, (_, h) => {
  const label = h === 0 ? "12:00 am" : h < 12 ? `${h}:00 am` : h === 12 ? "12:00 pm" : `${h - 12}:00 pm`;
  return { value: h, label };
});

type ActionKey = "startdraft" | "autodraft" | "enddraft" | "startseason";

interface LeagueControlsProps {
  draftOpen: boolean;
  matchDeadlineDay: number;
  matchPlayDay: number;
  matchPlayHour: number;
  minMmr2v2: number | null;
  minMmr3v3: number | null;
  seasonPrize1st: number | null;
  seasonPrize2nd: number | null;
  seasonPrize3rd4th: number | null;
  draftActive: boolean;
  draftPhase: string | null;
  hasPickDeadline: boolean;
  seasonActive: boolean;
  eventActive: boolean;
  testingMode: boolean;
  notificationsEnabled: boolean;
  draftCurrentMax: number;
  teamSlotCount: number;
  draftFormatMax: number | null;
  seasonFormatLabel: string;
  isTestSeason: boolean;
  subsEnabled: boolean;
  isCEO: boolean;
}

const FINAL_CONFIRM_COOLDOWN_SECONDS = 3;

const COMMANDS: Record<ActionKey, { label: string; code: string; description: string }> = {
  startdraft: {
    label: "Start Draft",
    code: "CONFIRM DRAFT",
    description: "Resets all teams, assigns captains, and begins the live snake draft.",
  },
  autodraft: {
    label: "Auto Draft",
    code: "AUTO DRAFT",
    description: "Skips the live draft and auto-balances teams by Rank Value.",
  },
  enddraft: {
    label: "End Draft",
    code: "END DRAFT",
    description: "Locks all rosters. No further picks can be made.",
  },
  startseason: {
    label: "Start Season",
    code: "START SEASON",
    description: "Officially opens the season for match play.",
  },
};

export function LeagueControls({ draftOpen, matchDeadlineDay, matchPlayDay, matchPlayHour, minMmr2v2, minMmr3v3, seasonPrize1st, seasonPrize2nd, seasonPrize3rd4th, draftActive, draftPhase, hasPickDeadline, seasonActive, eventActive, testingMode, notificationsEnabled, draftCurrentMax, teamSlotCount, draftFormatMax, seasonFormatLabel, isTestSeason, subsEnabled, isCEO }: LeagueControlsProps) {
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState<ActionKey | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [maxTeamsInput, setMaxTeamsInput] = useState("");
  const [pendingFinalConfirm, setPendingFinalConfirm] = useState<ActionKey | null>(null);
  const [finalConfirmCooldown, setFinalConfirmCooldown] = useState(0);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [localDraftOpen, setLocalDraftOpen] = useState(draftOpen);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmStripRoles, setConfirmStripRoles] = useState(false);
  const [confirmForceReset, setConfirmForceReset] = useState(false);
  const [testingEnabled, setTestingEnabled] = useState(testingMode);
  const [notifsEnabled, setNotifsEnabled]   = useState(notificationsEnabled);
  const [localIsTestSeason, setLocalIsTestSeason] = useState(isTestSeason);
  const [localSubsEnabled, setLocalSubsEnabled] = useState(subsEnabled);
  const [showTestingWarning, setShowTestingWarning] = useState(false);
  const [showTrackerForce, setShowTrackerForce] = useState(false);
  const [showDebugChannels, setShowDebugChannels] = useState(false);
  const [channelAudit, setChannelAudit] = useState<ChannelAuditResult | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [applyResult, setApplyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [deadlineDay, setDeadlineDay] = useState(matchDeadlineDay);
  const [playDay, setPlayDay] = useState(matchPlayDay);
  const [playHour, setPlayHour] = useState(matchPlayHour);
  const [min2v2, setMin2v2] = useState(minMmr2v2 != null ? String(minMmr2v2) : "");
  const [min3v3, setMin3v3] = useState(minMmr3v3 != null ? String(minMmr3v3) : "");
  const [prize1st, setPrize1st] = useState(seasonPrize1st != null ? String(seasonPrize1st) : "");
  const [prize2nd, setPrize2nd] = useState(seasonPrize2nd != null ? String(seasonPrize2nd) : "");
  const [prize3rd4th, setPrize3rd4th] = useState(seasonPrize3rd4th != null ? String(seasonPrize3rd4th) : "");

  useEffect(() => {
    if (!pendingFinalConfirm) return;
    const id = setInterval(() => {
      setFinalConfirmCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [pendingFinalConfirm]);

  const showFeedback = (msg: string | undefined, ok: boolean) => {
    setFeedback({ msg: msg ?? "", ok });
    setTimeout(() => setFeedback(null), 5000);
  };

  const openConfirm = (key: ActionKey) => {
    setActive(key);
    setCodeInput("");
    setMaxTeamsInput("");
  };

  const requiresFinalWarning = (key: ActionKey) =>
    key === "startdraft" || key === "autodraft" || key === "startseason";

  const requestConfirm = () => {
    if (!active) return;
    if (requiresFinalWarning(active)) {
      setFinalConfirmCooldown(FINAL_CONFIRM_COOLDOWN_SECONDS);
      setPendingFinalConfirm(active);
    } else {
      handleConfirm();
    }
  };

  const effectiveMaxTeams = Math.min(draftCurrentMax, teamSlotCount);

  const pendingDraftTeamCount = (() => {
    const parsed = maxTeamsInput.trim() === "" ? null : parseInt(maxTeamsInput, 10);
    const poolCapped = parsed && parsed > 0 ? Math.min(parsed, draftCurrentMax) : draftCurrentMax;
    return Math.min(poolCapped, teamSlotCount);
  })();

  const handleConfirm = () => {
    if (!active) return;
    startTransition(async () => {
      let result: { ok?: boolean; message?: string; error?: string };
      if (active === "startdraft") result = await adminStartDraft(codeInput, String(pendingDraftTeamCount));
      else if (active === "autodraft") result = await adminAutoBalance(codeInput, String(pendingDraftTeamCount));
      else if (active === "enddraft") result = await adminEndDraft(codeInput);
      else result = await adminStartSeason(codeInput);

      setActive(null);
      setCodeInput("");
      setMaxTeamsInput("");
      if (result.error) showFeedback(result.error, false);
      else showFeedback(result.message ?? "Done.", result.ok ?? true);
    });
  };

  return (
    <div className="space-y-5">

      {/* Draft signups toggle */}
      <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">Draft Signups</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {localDraftOpen ? "Open — players can enter the draft pool" : "Closed — players cannot enter the draft pool"}
          </p>
        </div>
        <button
          onClick={() => startTransition(async () => {
            const result = localDraftOpen ? await closeDraftSignups() : await openDraftSignups();
            if ("error" in result) showFeedback(result.error, false);
            else {
              showFeedback(result.message, result.ok ?? true);
              setLocalDraftOpen(o => !o);
            }
          })}
          disabled={isPending}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 ${
            localDraftOpen
              ? "bg-red-700 hover:bg-red-600 text-white"
              : "bg-emerald-700 hover:bg-emerald-600 text-white"
          }`}
        >
          {localDraftOpen ? "Close Signups" : "Open Signups"}
        </button>
      </div>

      {/* Substitute requests toggle */}
      <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">Substitute Requests</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {localSubsEnabled ? "Enabled — teams can request subs for upcoming matches" : "Disabled — teams cannot submit new sub requests"}
          </p>
        </div>
        <button
          onClick={() => {
            const next = !localSubsEnabled;
            setLocalSubsEnabled(next);
            startTransition(async () => {
              const result = await setSubsEnabled(next);
              showFeedback(result.message, result.ok);
            });
          }}
          disabled={isPending}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
            localSubsEnabled ? "bg-emerald-600 border-emerald-600" : "bg-zinc-700 border-zinc-700"
          }`}
          role="switch"
          aria-checked={localSubsEnabled}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${localSubsEnabled ? "translate-x-4" : "translate-x-0"}`} />
        </button>
      </div>

      {/* Match schedule settings */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-4 space-y-4">
        <p className="text-sm font-medium text-white">Match Schedule</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Default Play Day</label>
            <select
              value={playDay}
              onChange={e => setPlayDay(Number(e.target.value))}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Default Play Time (your local time)</label>
            <select
              value={playHour}
              onChange={e => setPlayHour(Number(e.target.value))}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Match Deadline Day</label>
            <select
              value={deadlineDay}
              onChange={e => setDeadlineDay(Number(e.target.value))}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          Deadline is always 11:59 pm (your local time) on the selected day. Use <span className="font-mono text-zinc-400">/setmatchcategory</span> and <span className="font-mono text-zinc-400">/setruleschannel</span> in Discord for the remaining settings.
        </p>
        <button
          onClick={() => startTransition(async () => {
            const result = await saveMatchSettings(deadlineDay, playDay, playHour);
            showFeedback(result.message, result.ok);
          })}
          disabled={isPending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Save Schedule
        </button>
      </div>

      {/* Minimum MMR to enter the draft */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-white">Minimum MMR to Join</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Peak MMR required to enter the season draft pool. A player qualifies by meeting
            <span className="text-zinc-400"> either</span> threshold. Leave blank or 0 for no minimum.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 max-w-xs">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Min 2v2</label>
            <input
              type="number"
              min={0}
              max={3000}
              value={min2v2}
              onChange={e => setMin2v2(e.target.value)}
              placeholder="None"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Min 3v3</label>
            <input
              type="number"
              min={0}
              max={3000}
              value={min3v3}
              onChange={e => setMin3v3(e.target.value)}
              placeholder="None"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
        <button
          onClick={() => startTransition(async () => {
            const result = await saveMinMmr(
              min2v2.trim() === "" ? null : Number(min2v2),
              min3v3.trim() === "" ? null : Number(min3v3),
            );
            showFeedback(result.message, result.ok);
          })}
          disabled={isPending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Save Minimum MMR
        </button>
      </div>

      {/* Season prize pool */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-white">Season Prize Pool</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            1st, 2nd, and 3rd-4th place payouts for the standalone manual season. Leave blank or 0 for none.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 max-w-md">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">1st place</label>
            <input
              type="number"
              min={0}
              value={prize1st}
              onChange={e => setPrize1st(e.target.value)}
              placeholder="0"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">2nd place</label>
            <input
              type="number"
              min={0}
              value={prize2nd}
              onChange={e => setPrize2nd(e.target.value)}
              placeholder="0"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">3rd-4th (each)</label>
            <input
              type="number"
              min={0}
              value={prize3rd4th}
              onChange={e => setPrize3rd4th(e.target.value)}
              placeholder="0"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
        <button
          onClick={() => startTransition(async () => {
            const result = await saveSeasonPrizes(
              prize1st.trim() === "" ? null : Number(prize1st),
              prize2nd.trim() === "" ? null : Number(prize2nd),
              prize3rd4th.trim() === "" ? null : Number(prize3rd4th),
            );
            showFeedback(result.message, result.ok);
          })}
          disabled={isPending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Save Prize Pool
        </button>
      </div>

      {/* Serious commands */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(Object.entries(COMMANDS) as [ActionKey, typeof COMMANDS[ActionKey]][]).map(([key, cmd]) => (
          <div key={key} className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-white">{cmd.label}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{cmd.description}</p>
              </div>
              {(key === "startdraft" || key === "autodraft") && (
                <span className="text-xs text-zinc-400 whitespace-nowrap shrink-0">{draftCurrentMax} teams</span>
              )}
            </div>

            {active === key ? (
              <div className="space-y-2">
                {(key === "startdraft" || key === "autodraft") && (
                  <div className="space-y-1">
                    <label className="block text-xs text-zinc-400">Max teams</label>
                    <input
                      type="number"
                      min={2}
                      value={maxTeamsInput}
                      onChange={(e) => setMaxTeamsInput(e.target.value)}
                      placeholder={`Max (${effectiveMaxTeams})`}
                      className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <p className="text-[11px] text-zinc-500">
                      {`Leave blank to make the maximum (${effectiveMaxTeams} team${effectiveMaxTeams === 1 ? "" : "s"}) from players currently in the draft.`}
                      {teamSlotCount < draftCurrentMax
                        ? ` Limited by ${teamSlotCount} team slot${teamSlotCount === 1 ? "" : "s"}.`
                        : ""}
                      {draftFormatMax != null && draftFormatMax < effectiveMaxTeams
                        ? ` This format supports at most ${draftFormatMax}.`
                        : ""}
                    </p>
                  </div>
                )}
                <p className="text-xs text-zinc-400">
                  Type <span className="font-mono text-white">{cmd.code}</span> to confirm:
                </p>
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && codeInput === cmd.code) requestConfirm(); }}
                  placeholder={cmd.code}
                  className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-red-500"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={requestConfirm}
                    disabled={isPending || codeInput !== cmd.code}
                    className="flex-1 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    {isPending ? "Running…" : "Confirm"}
                  </button>
                  <button
                    onClick={() => { setActive(null); setCodeInput(""); }}
                    disabled={isPending}
                    className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => openConfirm(key)}
                disabled={isPending}
                className="w-full py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {cmd.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Force tracker update for everyone in the active event */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-4 space-y-2">
        <p className="text-sm font-medium text-white">Force Tracker Update</p>
        <p className="text-xs text-zinc-500">
          Flags everyone who joined the active tournament/season (players and subs) to re-verify their
          tracker. Until they do, they&apos;ll be named and blocked from submitting that match&apos;s replays.
          {!eventActive && " Available only while a tournament or season is active."}
        </p>
        <button
          onClick={() => setShowTrackerForce(true)}
          disabled={!eventActive || isPending}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            eventActive
              ? "bg-emerald-700 hover:bg-emerald-600 text-white"
              : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
          } disabled:opacity-60`}
        >
          Force Tracker Update
        </button>
      </div>

      {/* Test Season toggle */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-sm font-medium text-white">Test Season</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {seasonActive
                ? "Cannot change while a season is active."
                : localIsTestSeason
                  ? "ON — this season will be discarded on completion (no records saved, no Westside Wages)"
                  : "OFF — this season is real and will be archived when completed"}
            </p>
          </div>
          <button
            onClick={() => {
              if (seasonActive) return;
              const next = !localIsTestSeason;
              setLocalIsTestSeason(next);
              startTransition(async () => {
                const result = await setIsTestSeason(next);
                if (result && "error" in result) {
                  setLocalIsTestSeason(!next);
                  showFeedback(result.error ?? "Failed to update.", false);
                }
              });
            }}
            disabled={isPending || seasonActive}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
              localIsTestSeason ? "bg-amber-600 border-amber-600" : "bg-zinc-700 border-zinc-700"
            }`}
            role="switch"
            aria-checked={localIsTestSeason}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${localIsTestSeason ? "translate-x-4" : "translate-x-0"}`} />
          </button>
        </div>
      </div>

      {/* End of season — export report, then reset */}
      {seasonActive && (
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-4 space-y-2">
          <p className="text-sm font-medium text-white">Season Report</p>
          <p className="text-xs text-zinc-500">
            Download a PDF of final standings and match results, then end and reset the season.
          </p>
          <ExportAndResetSeasonButton />
        </div>
      )}

      {/* Force tracker update confirmation modal */}
      {showTrackerForce && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-emerald-700/60 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4 shadow-2xl">
            <h3 className="text-base font-semibold text-emerald-300">Force Tracker Update</h3>
            <p className="text-sm text-zinc-300 leading-relaxed">
              This will force <strong className="text-white">all active players in the tournament/season</strong>{" "}
              (including subs) to re-verify their tracker before they can submit replays. Are you sure you want to do this?
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => {
                  setShowTrackerForce(false);
                  startTransition(async () => {
                    const result = await forceTrackerUpdate();
                    if (result.error) showFeedback(result.error, false);
                    else showFeedback(result.message, result.ok ?? true);
                  });
                }}
                disabled={isPending}
                className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Yes, force update
              </button>
              <button
                onClick={() => setShowTrackerForce(false)}
                className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Final warning modal — gates Start Draft / Auto Draft / Start Season behind a 3-second cooldown */}
      {pendingFinalConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-red-700/60 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4 shadow-2xl">
            <h3 className="text-base font-semibold text-red-300">{COMMANDS[pendingFinalConfirm].label}</h3>
            {(pendingFinalConfirm === "startdraft" || pendingFinalConfirm === "autodraft") ? (
              <p className="text-sm text-zinc-300 leading-relaxed">
                <span className="font-semibold text-white">{pendingDraftTeamCount} teams</span> will be created. Is this right?
              </p>
            ) : (
              <p className="text-sm text-zinc-300 leading-relaxed">
                The season will run as <span className="font-semibold text-white">{seasonFormatLabel}</span>. Is this right?
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setPendingFinalConfirm(null); handleConfirm(); }}
                disabled={isPending || finalConfirmCooldown > 0}
                className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isPending ? "Running…" : finalConfirmCooldown > 0 ? `Confirm (${finalConfirmCooldown})` : "Confirm"}
              </button>
              <button
                onClick={() => setPendingFinalConfirm(null)}
                disabled={isPending}
                className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Testing warning modal */}
      {showTestingWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-amber-700/60 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-900/50 border border-amber-700/60 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <h3 className="text-base font-semibold text-amber-300">Enable Testing Mode</h3>
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed">
              Testing features can modify <strong className="text-white">live data</strong> — adding fake users, generating teams, and resetting the season. These actions affect all players and cannot always be undone.
            </p>
            <p className="text-sm text-amber-400/80">Only enable this on a dev instance or when no active season is running.</p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setTestingEnabled(true); setShowTestingWarning(false); startTransition(() => setTestingMode(true)); }}
                className="flex-1 px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Enable Anyway
              </button>
              <button
                onClick={() => setShowTestingWarning(false)}
                className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notifications toggle */}
      <div className="border-t border-zinc-800 pt-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-zinc-400">Push Notifications</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {notifsEnabled ? "On — users receive push notifications" : "Off — all push notifications suppressed"}
            </p>
          </div>
          <button
            onClick={() => {
              const next = !notifsEnabled;
              setNotifsEnabled(next);
              startTransition(() => setNotificationsEnabled(next));
            }}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none ${notifsEnabled ? "bg-emerald-600 border-emerald-600" : "bg-zinc-700 border-zinc-700"}`}
            role="switch"
            aria-checked={notifsEnabled}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${notifsEnabled ? "translate-x-4" : "translate-x-0"}`} />
          </button>
        </div>
      </div>

      {/* Test users */}
      <div className="border-t border-zinc-800 pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400">Testing</h3>
          <button
            onClick={() => {
              if (testingEnabled) {
                setTestingEnabled(false);
                setConfirmGenerate(false); setConfirmRemove(false); setConfirmReset(false);
                startTransition(() => setTestingMode(false));
              } else {
                setShowTestingWarning(true);
              }
            }}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none ${testingEnabled ? "bg-amber-600 border-amber-600" : "bg-zinc-700 border-zinc-700"}`}
            role="switch"
            aria-checked={testingEnabled}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${testingEnabled ? "translate-x-4" : "translate-x-0"}`} />
          </button>
        </div>
        {testingEnabled && <div className="flex flex-wrap gap-3">
          <button
            onClick={() => startTransition(async () => {
              const result = await addTestUser();
              if ("error" in result) showFeedback(result.error, false);
              else showFeedback(result.message, result.ok ?? true);
            })}
            disabled={isPending}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + Add Test User
          </button>

          <button
            onClick={() => startTransition(async () => {
              const result = await addBulkTestUsers(32);
              if ("error" in result) showFeedback(result.error, false);
              else showFeedback(result.message, result.ok ?? true);
            })}
            disabled={isPending}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + Add 32 Test Users
          </button>

          {confirmGenerate ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Replace all existing teams?</span>
              <button
                onClick={() => startTransition(async () => {
                  const result = await generateTestTeams();
                  setConfirmGenerate(false);
                  if ("error" in result) showFeedback(result.error, false);
                  else showFeedback(result.message, result.ok ?? true);
                })}
                disabled={isPending}
                className="px-3 py-1 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
              >
                Yes, generate
              </button>
              <button
                onClick={() => setConfirmGenerate(false)}
                className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmGenerate(true)}
              disabled={isPending}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Generate Teams
            </button>
          )}

          {confirmRemove ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Remove all test users?</span>
              <button
                onClick={() => startTransition(async () => {
                  const result = await removeTestUsers();
                  setConfirmRemove(false);
                  if ("error" in result) showFeedback(result.error, false);
                  else showFeedback(result.message, result.ok ?? true);
                })}
                disabled={isPending}
                className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
              >
                Yes, remove
              </button>
              <button
                onClick={() => setConfirmRemove(false)}
                className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              disabled={isPending}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Remove Test Users
            </button>
          )}

          {confirmStripRoles ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Remove all team roles from everyone in Discord?</span>
              <button
                onClick={() => startTransition(async () => {
                  const result = await stripTeamDiscordRoles();
                  setConfirmStripRoles(false);
                  if (result.error) showFeedback(result.error, false);
                  else showFeedback(result.message, result.ok ?? true);
                })}
                disabled={isPending}
                className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
              >
                Yes, strip
              </button>
              <button
                onClick={() => setConfirmStripRoles(false)}
                className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmStripRoles(true)}
              disabled={isPending}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Strip Team Roles
            </button>
          )}

          {confirmReset ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Delete all teams and reset the season?</span>
              <button
                onClick={() => startTransition(async () => {
                  const result = await resetSeason();
                  setConfirmReset(false);
                  showFeedback(result.message, result.ok ?? true);
                })}
                disabled={isPending}
                className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
              >
                Yes, reset
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              disabled={isPending}
              className="px-4 py-2 bg-red-900/60 hover:bg-red-800/60 border border-red-700/50 disabled:opacity-50 text-red-300 text-sm font-medium rounded-lg transition-colors"
            >
              Reset Season
            </button>
          )}
        </div>}
      </div>

      {/* Live draft state indicator */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 space-y-1">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Live State</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400 font-mono mt-1">
          <span>draft_active: <span className={draftActive ? "text-amber-400 font-bold" : "text-zinc-500"}>{String(draftActive)}</span></span>
          <span>draft_phase: <span className={draftPhase ? "text-amber-400 font-bold" : "text-zinc-500"}>{draftPhase ?? "null"}</span></span>
          <span>pick_deadline: <span className={hasPickDeadline ? "text-amber-400 font-bold" : "text-zinc-500"}>{hasPickDeadline ? "set" : "null"}</span></span>
        </div>
      </div>

      {/* Emergency controls */}
      <div className="border-t border-red-900/40 pt-5 space-y-3">
        <h3 className="text-sm font-medium text-red-400">Emergency</h3>
        <p className="text-xs text-zinc-500">
          Use if the draft is visibly stuck and normal controls aren&apos;t responding. Clears all draft state flags unconditionally.
        </p>
        {confirmForceReset ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Clear draft_active, draft_phase, and pick_deadline for all players?</span>
            <button
              onClick={() => startTransition(async () => {
                const result = await forceResetDraftState();
                setConfirmForceReset(false);
                if (result.error) showFeedback(result.error, false);
                else showFeedback("Draft state forcefully cleared.", true);
              })}
              disabled={isPending}
              className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
            >
              Yes, force clear
            </button>
            <button
              onClick={() => setConfirmForceReset(false)}
              className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmForceReset(true)}
            disabled={isPending}
            className="px-4 py-2 bg-red-950/60 hover:bg-red-900/60 border border-red-800/50 disabled:opacity-50 text-red-400 text-sm font-medium rounded-lg transition-colors"
          >
            Force Clear Draft State
          </button>
        )}
      </div>

      {/* Debug Channels — CEO only */}
      {isCEO && (
        <div className="border-t border-zinc-700 pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-300">Debug Channels</h3>
            <button
              onClick={async () => {
                if (showDebugChannels) {
                  setShowDebugChannels(false);
                  setChannelAudit(null);
                  setApplyResult(null);
                  return;
                }
                setShowDebugChannels(true);
                setApplyResult(null);
                setAuditLoading(true);
                setChannelAudit(null);
                const result = await auditMatchChannels();
                setChannelAudit(result);
                setAuditLoading(false);
              }}
              disabled={isPending}
              className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 text-xs font-medium rounded-lg transition-colors"
            >
              {showDebugChannels ? "Close" : "Debug Channels"}
            </button>
          </div>

          {showDebugChannels && (
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-4 space-y-4">
              {auditLoading && (
                <p className="text-xs text-zinc-400">Scanning Discord channels…</p>
              )}

              {channelAudit?.error && (
                <p className="text-xs text-red-400">{channelAudit.error}</p>
              )}

              {channelAudit && !channelAudit.error && (
                <>
                  {channelAudit.items.length === 0 ? (
                    <p className="text-xs text-zinc-400">No match channels found to audit.</p>
                  ) : (
                    <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                      {channelAudit.items
                        .slice()
                        .sort((a, b) => {
                          const order = { ok: 0, missing_tracked: 1, missing_untracked: 2, extra: 3 };
                          return order[a.status] - order[b.status];
                        })
                        .map((item, i) => {
                          const isOk = item.status === "ok";
                          const isExtra = item.status === "extra";
                          const label = isOk
                            ? "✓"
                            : isExtra
                              ? "✗ extra"
                              : item.status === "missing_untracked"
                                ? "✗ never created"
                                : "✗ missing";
                          const cls = isOk
                            ? "text-emerald-400"
                            : "text-red-400";
                          const stagePart =
                            item.stage && item.round != null
                              ? ` — ${item.stage.replace(/_/g, " ")} r${item.round}`
                              : "";
                          return (
                            <li key={i} className="flex items-start gap-2 text-xs font-mono">
                              <span className={`shrink-0 font-bold ${cls}`}>{label}</span>
                              <span className="text-zinc-300">
                                #{item.channelName}
                                <span className="text-zinc-500 font-sans">{stagePart}</span>
                              </span>
                            </li>
                          );
                        })}
                    </ul>
                  )}

                  {(() => {
                    const needsAction = channelAudit.items.some(
                      (i) => i.status !== "ok",
                    );
                    if (!needsAction) {
                      return (
                        <p className="text-xs text-emerald-400">All channels are in sync.</p>
                      );
                    }
                    const missingCount = channelAudit.items.filter(
                      (i) => i.status === "missing_tracked" || i.status === "missing_untracked",
                    ).length;
                    const extraCount = channelAudit.items.filter(
                      (i) => i.status === "extra",
                    ).length;
                    return (
                      <div className="space-y-2">
                        <p className="text-xs text-zinc-400">
                          {missingCount > 0 && `${missingCount} channel${missingCount !== 1 ? "s" : ""} will be created.`}
                          {missingCount > 0 && extraCount > 0 && " "}
                          {extraCount > 0 && `${extraCount} channel${extraCount !== 1 ? "s" : ""} will be deleted.`}
                        </p>
                        <button
                          onClick={() => {
                            setApplyResult(null);
                            startTransition(async () => {
                              const res = await applyChannelChanges();
                              setApplyResult({ ok: res.ok, message: res.message });
                              // Re-audit after applying
                              setAuditLoading(true);
                              setChannelAudit(null);
                              const fresh = await auditMatchChannels();
                              setChannelAudit(fresh);
                              setAuditLoading(false);
                            });
                          }}
                          disabled={isPending}
                          className="px-4 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          {isPending ? "Applying…" : "Confirm Changes"}
                        </button>
                      </div>
                    );
                  })()}

                  {applyResult && (
                    <p className={`text-xs ${applyResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                      {applyResult.message}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {feedback && (
        <p className={`text-sm ${feedback.ok ? "text-green-400" : "text-red-400"}`}>
          {feedback.msg}
        </p>
      )}
    </div>
  );
}
