"use client";

import { useState, useTransition } from "react";
import {
  createTeam,
  invitePlayer,
  revokeInvite,
  respondInvite,
  leaveTeam,
  disbandTeam,
} from "./team-signup-actions";
import type { TeamSignupView } from "./team-signup-data";
import { PlayerName } from "@/app/dashboard/player-name";
import { LocalTime } from "./local-time";

export function TeamSignupPanel({
  view,
  tournamentId,
  tournamentName,
  timeline = [],
}: {
  view: TeamSignupView;
  tournamentId: string;
  tournamentName?: string;
  timeline?: { label: string; iso: string }[];
}) {
  const { myTeam, incomingInvites, invitable, registrationOpen } = view;
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [inviteId, setInviteId] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  const flash = (msg: string | undefined, ok: boolean) => {
    setFeedback({ msg: msg ?? "", ok });
    setTimeout(() => setFeedback(null), 4000);
  };
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      flash(res.error ?? res.message, !res.error);
    });

  const acceptedCount = myTeam?.members.filter((m) => m.status === "accepted").length ?? 0;

  return (
    <div className="bg-gradient-to-br from-indigo-950/40 to-zinc-900 border border-indigo-800/40 rounded-xl p-5 space-y-4">
      <div>
        <p className="text-[11px] font-semibold text-indigo-300 uppercase tracking-wider">
          Team Registration{tournamentName ? ` · ${tournamentName}` : ""}
        </p>
        <p className="text-sm text-zinc-400 mt-1">
          {registrationOpen
            ? "Form a team of 3 (plus an optional 4th as substitute)."
            : "Registration is closed."}
        </p>
      </div>

      {/* Already on a team */}
      {myTeam ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-white">{myTeam.name}</span>
            <span className="text-xs text-zinc-500">{acceptedCount}/3 starters{acceptedCount > 3 ? " +sub" : ""}</span>
          </div>

          <ul className="space-y-1.5">
            {myTeam.members.map((m) => (
              <li key={m.memberId} className="flex items-center gap-2 text-sm">
                <span className="text-zinc-200"><PlayerName displayName={m.display_name ?? null} username={m.username} /></span>
                {m.isCreator && <span className="text-[10px] font-bold text-yellow-400">CAPTAIN</span>}
                {m.status === "invited" && (
                  <span className="text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">PENDING</span>
                )}
                {myTeam.isCreator && m.status === "invited" && registrationOpen && (
                  <button
                    onClick={() => run(() => revokeInvite(m.memberId))}
                    disabled={isPending}
                    className="ml-auto text-xs text-zinc-500 hover:text-red-400"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* Creator: invite */}
          {myTeam.isCreator && registrationOpen && myTeam.members.length < 4 && (
            <div className="flex gap-2 pt-1">
              <select
                value={inviteId}
                onChange={(e) => setInviteId(e.target.value)}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Invite a player…</option>
                {invitable.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name ?? p.username}</option>
                ))}
              </select>
              <button
                onClick={() => { if (inviteId) { run(() => invitePlayer(tournamentId, inviteId)); setInviteId(""); } }}
                disabled={isPending || !inviteId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Invite
              </button>
            </div>
          )}

          {/* Leave / disband */}
          <div className="pt-1">
            {myTeam.isCreator ? (
              <button
                onClick={() => run(() => disbandTeam(tournamentId))}
                disabled={isPending}
                className="text-xs text-zinc-500 hover:text-red-400"
              >
                Disband team
              </button>
            ) : (
              <button
                onClick={() => run(() => leaveTeam(tournamentId))}
                disabled={isPending}
                className="text-xs text-zinc-500 hover:text-red-400"
              >
                Leave team
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Incoming invites */}
          {incomingInvites.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400">Invites</p>
              {incomingInvites.map((inv) => (
                <div key={inv.memberId} className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
                  <span className="text-sm text-zinc-200 flex-1">
                    <span className="font-medium text-white">{inv.teamName}</span>
                    <span className="text-zinc-500"> · {inv.creatorName}</span>
                  </span>
                  <button
                    onClick={() => run(() => respondInvite(inv.memberId, true))}
                    disabled={isPending || !registrationOpen}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => run(() => respondInvite(inv.memberId, false))}
                    disabled={isPending}
                    className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg"
                  >
                    Decline
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Create a team */}
          {registrationOpen && (
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your team name"
                maxLength={30}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                onClick={() => { if (name.trim()) run(() => createTeam(tournamentId, name)); }}
                disabled={isPending || !name.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Create team
              </button>
            </div>
          )}
        </div>
      )}

      {feedback && (
        <p className={`text-sm ${feedback.ok ? "text-emerald-400" : "text-red-400"}`}>{feedback.msg}</p>
      )}

      {timeline.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1 border-t border-indigo-800/40">
          {timeline.map(({ label, iso }) => (
            <span key={label} className="text-xs text-zinc-500">
              {label}: <LocalTime iso={iso} className="text-zinc-400" />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
