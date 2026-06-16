"use client";

import { useState, useTransition } from "react";
import { adminStartDraft, adminAutoBalance, adminEndDraft, adminStartSeason, addTestUser, addBulkTestUsers, removeTestUsers, generateTestTeams, resetSeason, openDraftSignups, closeDraftSignups, saveMatchSettings, saveMinMmr, forceResetDraftState, setTestingMode, setNotificationsEnabled, stripTeamDiscordRoles, forceTrackerUpdate } from "./league-actions";
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
  draftActive: boolean;
  draftPhase: string | null;
  hasPickDeadline: boolean;
  seasonActive: boolean;
  eventActive: boolean;
  testingMode: boolean;
  notificationsEnabled: boolean;
}

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

export function LeagueControls({ draftOpen, matchDeadlineDay, matchPlayDay, matchPlayHour, minMmr2v2, minMmr3v3, draftActive, draftPhase, hasPickDeadline, seasonActive, eventActive, testingMode, notificationsEnabled }: LeagueControlsProps) {
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState<ActionKey | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [localDraftOpen, setLocalDraftOpen] = useState(draftOpen);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmStripRoles, setConfirmStripRoles] = useState(false);
  const [confirmForceReset, setConfirmForceReset] = useState(false);
  const [testingEnabled, setTestingEnabled] = useState(testingMode);
  const [notifsEnabled, setNotifsEnabled]   = useState(notificationsEnabled);
  const [showTestingWarning, setShowTestingWarning] = useState(false);
  const [showTrackerForce, setShowTrackerForce] = useState(false);
  const [deadlineDay, setDeadlineDay] = useState(matchDeadlineDay);
  const [playDay, setPlayDay] = useState(matchPlayDay);
  const [playHour, setPlayHour] = useState(matchPlayHour);
  const [min2v2, setMin2v2] = useState(minMmr2v2 != null ? String(minMmr2v2) : "");
  const [min3v3, setMin3v3] = useState(minMmr3v3 != null ? String(minMmr3v3) : "");

  const showFeedback = (msg: string | undefined, ok: boolean) => {
    setFeedback({ msg: msg ?? "", ok });
    setTimeout(() => setFeedback(null), 5000);
  };

  const openConfirm = (key: ActionKey) => {
    setActive(key);
    setCodeInput("");
  };

  const handleConfirm = () => {
    if (!active) return;
    startTransition(async () => {
      let result: { ok?: boolean; message?: string; error?: string };
      if (active === "startdraft") result = await adminStartDraft(codeInput);
      else if (active === "autodraft") result = await adminAutoBalance(codeInput);
      else if (active === "enddraft") result = await adminEndDraft(codeInput);
      else result = await adminStartSeason(codeInput);

      setActive(null);
      setCodeInput("");
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
            <label className="text-xs text-zinc-500">Default Play Time (PT)</label>
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
          Deadline is always 11:59 pm PT on the selected day. Use <span className="font-mono text-zinc-400">/setmatchcategory</span> and <span className="font-mono text-zinc-400">/setruleschannel</span> in Discord for the remaining settings.
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

      {/* Serious commands */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(Object.entries(COMMANDS) as [ActionKey, typeof COMMANDS[ActionKey]][]).map(([key, cmd]) => (
          <div key={key} className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-white">{cmd.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{cmd.description}</p>
            </div>

            {active === key ? (
              <div className="space-y-2">
                <p className="text-xs text-zinc-400">
                  Type <span className="font-mono text-white">{cmd.code}</span> to confirm:
                </p>
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && codeInput === cmd.code) handleConfirm(); }}
                  placeholder={cmd.code}
                  className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-red-500"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirm}
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

      {feedback && (
        <p className={`text-sm ${feedback.ok ? "text-green-400" : "text-red-400"}`}>
          {feedback.msg}
        </p>
      )}
    </div>
  );
}
