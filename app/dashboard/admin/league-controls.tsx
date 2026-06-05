"use client";

import { useState, useTransition } from "react";
import { adminStartDraft, adminEndDraft, adminStartSeason, adminSetNumTeams, addTestUser, addBulkTestUsers, removeTestUsers, generateTestTeams, resetSeason, openDraftSignups, closeDraftSignups, saveMatchSettings } from "./league-actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 24 }, (_, h) => {
  const label = h === 0 ? "12:00 am" : h < 12 ? `${h}:00 am` : h === 12 ? "12:00 pm" : `${h - 12}:00 pm`;
  return { value: h, label };
});

type ActionKey = "startdraft" | "enddraft" | "startseason";

interface LeagueControlsProps {
  draftOpen: boolean;
  currentNumTeams: number;
  matchDeadlineDay: number;
  matchPlayDay: number;
  matchPlayHour: number;
}

const COMMANDS: Record<ActionKey, { label: string; code: string; description: string }> = {
  startdraft: {
    label: "Start Draft",
    code: "CONFIRM DRAFT",
    description: "Resets all teams, assigns captains, and begins the snake draft.",
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

export function LeagueControls({ draftOpen, currentNumTeams, matchDeadlineDay, matchPlayDay, matchPlayHour }: LeagueControlsProps) {
  const [isPending, startTransition] = useTransition();
  const [numTeams, setNumTeams] = useState("");
  const [active, setActive] = useState<ActionKey | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [localDraftOpen, setLocalDraftOpen] = useState(draftOpen);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deadlineDay, setDeadlineDay] = useState(matchDeadlineDay);
  const [playDay, setPlayDay] = useState(matchPlayDay);
  const [playHour, setPlayHour] = useState(matchPlayHour);

  const showFeedback = (msg: string, ok: boolean) => {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 5000);
  };

  const handleSetTeams = () => {
    startTransition(async () => {
      const result = await adminSetNumTeams(numTeams);
      if ("error" in result) showFeedback(result.error, false);
      else showFeedback(result.message, result.ok);
      setNumTeams("");
    });
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

      {/* Set number of teams */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs text-zinc-500">Set number of teams (enter a number or &quot;max&quot;)</p>
          {currentNumTeams > 0 && (
            <span className="text-xs font-semibold text-indigo-400 bg-indigo-400/10 px-2 py-0.5 rounded-full">
              Current: {currentNumTeams}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={numTeams}
            onChange={(e) => setNumTeams(e.target.value)}
            placeholder="e.g. 4 or max"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={handleSetTeams}
            disabled={isPending || !numTeams.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Set
          </button>
        </div>
      </div>

      {/* Draft signups toggle */}
      <div className="flex items-center justify-between bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-3">
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
      <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-4 space-y-4">
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

      {/* Test users */}
      <div className="border-t border-zinc-800 pt-5 space-y-3">
        <h3 className="text-sm font-medium text-zinc-400">Testing</h3>
        <div className="flex flex-wrap gap-3">
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

          <button
            onClick={() => startTransition(async () => {
              const result = await adminSetNumTeams("max");
              if ("error" in result) showFeedback(result.error, false);
              else showFeedback(result.message, result.ok ?? true);
            })}
            disabled={isPending}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Set Max Teams
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

          {confirmReset ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Delete all teams and reset the season?</span>
              <button
                onClick={() => startTransition(async () => {
                  const result = await resetSeason();
                  setConfirmReset(false);
                  if ("error" in result) showFeedback(result.error, false);
                  else showFeedback(result.message, result.ok ?? true);
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
        </div>
      </div>

      {feedback && (
        <p className={`text-sm ${feedback.ok ? "text-green-400" : "text-red-400"}`}>
          {feedback.msg}
        </p>
      )}
    </div>
  );
}
