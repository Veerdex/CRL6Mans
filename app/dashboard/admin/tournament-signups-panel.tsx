"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeTournamentEntry, removeTeamSignup } from "./tournament-actions";
import { PlayerName } from "@/app/dashboard/player-name";

export type TournamentSignupPlayer = {
  playerId: string;
  discordId: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
};

export type TournamentSignupTeam = {
  id: string;
  name: string;
  members: { playerId: string; status: string; username: string; displayName: string | null }[];
};

export type TournamentSignupData = {
  playerEntries: TournamentSignupPlayer[];
  teamSignups: TournamentSignupTeam[];
};

function Avatar({ discordId, avatar }: { discordId: string; avatar: string | null }) {
  return avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`}
      alt="" width={24} height={24} className="rounded-full shrink-0"
    />
  ) : (
    <div className="w-6 h-6 rounded-full bg-zinc-700 shrink-0" />
  );
}

function PlayerEntryRow({ tournamentId, entry }: { tournamentId: string; entry: TournamentSignupPlayer }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    setError(null);
    startTx(async () => {
      const res = await removeTournamentEntry(tournamentId, entry.playerId);
      if (res.error) { setError(res.error); return; }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 flex-wrap bg-zinc-800/60 border border-zinc-700/60 rounded-lg">
      <Avatar discordId={entry.discordId} avatar={entry.avatar} />
      <span className="flex-1 text-sm text-zinc-200 truncate min-w-0">
        <PlayerName displayName={entry.displayName} username={entry.username} />
      </span>
      {confirming ? (
        <div className="flex items-center gap-2 shrink-0">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button
            onClick={handleRemove}
            disabled={isPending}
            className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "…" : "Confirm"}
          </button>
          <button
            onClick={() => { setConfirming(false); setError(null); }}
            disabled={isPending}
            className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="px-2 py-0.5 bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700/50 text-red-400 text-xs font-medium rounded-lg transition-colors shrink-0"
        >
          Remove
        </button>
      )}
    </div>
  );
}

function TeamSignupRow({ team }: { team: TournamentSignupTeam }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    setError(null);
    startTx(async () => {
      const res = await removeTeamSignup(team.id);
      if (res.error) { setError(res.error); return; }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex-1 text-sm font-medium text-zinc-200 truncate min-w-0">{team.name}</span>
        {confirming ? (
          <div className="flex items-center gap-2 shrink-0">
            {error && <span className="text-xs text-red-400">{error}</span>}
            <button
              onClick={handleRemove}
              disabled={isPending}
              className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? "…" : "Confirm"}
            </button>
            <button
              onClick={() => { setConfirming(false); setError(null); }}
              disabled={isPending}
              className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="px-2 py-0.5 bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700/50 text-red-400 text-xs font-medium rounded-lg transition-colors shrink-0"
          >
            Remove Team
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {team.members.map((m) => (
          <span
            key={m.playerId}
            className={`text-xs px-2 py-0.5 rounded-full border ${
              m.status === "accepted"
                ? "bg-emerald-900/20 border-emerald-700/40 text-emerald-300"
                : "bg-zinc-800 border-zinc-700 text-zinc-400"
            }`}
          >
            <PlayerName displayName={m.displayName} username={m.username} />
            {m.status !== "accepted" && " (invited)"}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TournamentSignupsPanel({ tournamentId, data }: { tournamentId: string; data: TournamentSignupData }) {
  if (data.playerEntries.length === 0 && data.teamSignups.length === 0) {
    return <p className="text-xs text-zinc-500">No sign-ups yet.</p>;
  }

  return (
    <div className="space-y-2">
      {data.playerEntries.map((e) => (
        <PlayerEntryRow key={e.playerId} tournamentId={tournamentId} entry={e} />
      ))}
      {data.teamSignups.map((t) => (
        <TeamSignupRow key={t.id} team={t} />
      ))}
    </div>
  );
}
