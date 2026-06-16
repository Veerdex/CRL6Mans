"use client";

import { useState, useTransition } from "react";
import { addTeamSlot, updateTeamRoleId, deleteLastTeamSlot, deleteAllTeamSlots } from "./league-actions";

type TeamSlot = { id: string; name: string; discord_role_id: string | null; slot_number: number | null };

export function TeamSlotsManager({ teams: initialTeams }: { teams: TeamSlot[] }) {
  const [isPending, startTransition] = useTransition();
  const [teams, setTeams] = useState(initialTeams);
  const [newRoleId, setNewRoleId] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  const showFeedback = (msg: string | undefined, ok: boolean) => {
    setFeedback({ msg: msg ?? "", ok });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Sort: assigned slots ascending by slot_number, then any non-slot teams alphabetically
  const sorted = [...teams].sort((a, b) => {
    if (a.slot_number !== null && b.slot_number !== null) return a.slot_number - b.slot_number;
    if (a.slot_number !== null) return -1;
    if (b.slot_number !== null) return 1;
    return a.name.localeCompare(b.name);
  });

  const nums = teams
    .map(t => t.slot_number)
    .filter((n): n is number => n !== null);
  const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1;

  const numbered = sorted.filter(t => t.slot_number !== null);
  const lastId = numbered[numbered.length - 1]?.id;
  const missingCount = sorted.filter(t => !t.discord_role_id).length;

  return (
    <div className="space-y-4">
      {/* Status summary */}
      {sorted.length > 0 && (
        <div className={`text-xs px-3 py-1.5 rounded-lg w-fit border ${
          missingCount === 0
            ? "bg-emerald-900/30 text-emerald-400 border-emerald-700/40"
            : "bg-amber-900/30 text-amber-400 border-amber-700/40"
        }`}>
          {missingCount === 0
            ? `✓ All ${sorted.length} teams have Discord role IDs`
            : `⚠ ${missingCount} of ${sorted.length} team${sorted.length !== 1 ? "s" : ""} missing a role ID`}
        </div>
      )}

      {/* Team list */}
      {sorted.length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <button
              onClick={() => {
                if (!confirm("Delete ALL team slots? This will also unassign all players and delete all matches.")) return;
                startTransition(async () => {
                  const res = await deleteAllTeamSlots();
                  if ("error" in res) { showFeedback(res.error, false); return; }
                  setTeams([]);
                  showFeedback(res.message!, true);
                });
              }}
              disabled={isPending}
              className="px-3 py-1 bg-red-900/60 hover:bg-red-800/60 border border-red-700/50 text-red-300 text-xs rounded shrink-0 disabled:opacity-50"
            >
              Delete All
            </button>
          </div>
          {sorted.map(team => (
            <div key={team.id} className="flex items-center gap-3 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
              <span className="text-xs font-mono text-zinc-500 w-6 shrink-0 text-right">
                {team.slot_number ?? "—"}
              </span>
              <span className="text-sm font-medium text-white w-28 shrink-0 truncate">{team.name}</span>

              {editId === team.id ? (
                <>
                  <input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    placeholder="Discord role ID"
                    className="flex-1 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    autoFocus
                  />
                  <button
                    onClick={() => startTransition(async () => {
                      const res = await updateTeamRoleId(team.id, editValue.trim());
                      if ("error" in res) { showFeedback(res.error, false); return; }
                      setTeams(ts => ts.map(t => t.id === team.id ? { ...t, discord_role_id: editValue.trim() || null } : t));
                      setEditId(null);
                      showFeedback("Role ID updated.", true);
                    })}
                    disabled={isPending}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs rounded shrink-0"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded shrink-0"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-xs font-mono truncate ${team.discord_role_id ? "text-zinc-400" : "text-amber-400"}`}>
                    {team.discord_role_id ?? "⚠ no role ID set"}
                  </span>
                  <button
                    onClick={() => { setEditId(team.id); setEditValue(team.discord_role_id ?? ""); }}
                    className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded shrink-0"
                  >
                    Edit
                  </button>
                  {team.id === lastId && (
                    <button
                      onClick={() => startTransition(async () => {
                        const res = await deleteLastTeamSlot();
                        if ("error" in res) { showFeedback(res.error, false); return; }
                        setTeams(ts => ts.filter(t => t.id !== team.id));
                        showFeedback(res.message!, true);
                      })}
                      disabled={isPending}
                      className="px-3 py-1 bg-red-900/60 hover:bg-red-800/60 border border-red-700/50 text-red-300 text-xs rounded shrink-0"
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add team */}
      <div className="space-y-1.5">
        <p className="text-xs text-zinc-500">
          Next slot: <span className="text-zinc-300 font-medium">Team {nextNum}</span> — paste the role ID from Discord Server Settings → Roles.
        </p>
        <div className="flex gap-2">
          <input
            value={newRoleId}
            onChange={e => setNewRoleId(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newRoleId.trim() && !isPending) e.currentTarget.closest("div")?.querySelector("button")?.click(); }}
            placeholder="Discord role ID (e.g. 1234567890123456789)"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={() => startTransition(async () => {
              const res = await addTeamSlot(newRoleId.trim());
              if ("error" in res) { showFeedback(res.error, false); return; }
              setTeams(ts => [...ts, res.team]);
              setNewRoleId("");
              showFeedback(`${res.team.name} added.`, true);
            })}
            disabled={isPending || !newRoleId.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isPending ? "Adding…" : "+ Add Team"}
          </button>
        </div>
      </div>

      {feedback && (
        <p className={`text-sm ${feedback.ok ? "text-emerald-400" : "text-red-400"}`}>{feedback.msg}</p>
      )}
    </div>
  );
}
