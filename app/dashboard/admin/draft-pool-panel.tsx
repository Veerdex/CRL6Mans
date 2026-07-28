"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removePlayerFromDraft } from "./league-actions";
import { removeTournamentEntry, removeTeamSignup } from "./tournament-actions";
import { PlayerName } from "@/app/dashboard/player-name";
import { calculatePlayerRating } from "@/app/lib/rating";

export type DraftPoolEntry = {
  id: string;
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string;
  peak_1v1: string | null;
  current_1v1: string | null;
  draft_entered_at: string | null;
};

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

export type DraftPoolTournamentGroup = {
  tournamentId: string;
  tournamentName: string;
  joinMode: "players" | "teams";
  playerEntries: TournamentSignupPlayer[];
  teamSignups: TournamentSignupTeam[];
};

function rankValue(p: DraftPoolEntry): number {
  return calculatePlayerRating({
    at_1v1: Number(p.peak_1v1 ?? 0), season_1v1: Number(p.current_1v1 ?? 0),
    at_2v2: Number(p.peak_2v2 ?? 0), season_2v2: Number(p.current_2v2 ?? 0),
    at_3v3: Number(p.peak_3v3 ?? 0), season_3v3: Number(p.current_3v3 ?? 0),
  });
}

function Avatar({ discordId, avatar }: { discordId: string; avatar: string | null }) {
  return avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`}
      alt="" width={28} height={28} className="rounded-full shrink-0"
    />
  ) : (
    <div className="w-7 h-7 rounded-full bg-zinc-700 shrink-0" />
  );
}

function DraftPoolRow({ entry }: { entry: DraftPoolEntry }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    setError(null);
    startTx(async () => {
      const res = await removePlayerFromDraft(entry.id);
      if (res.error) { setError(res.error); return; }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 flex-wrap bg-zinc-900 border border-zinc-800 rounded-xl">
      <Avatar discordId={entry.discord_id} avatar={entry.avatar} />

      <span className="flex-1 text-sm font-medium text-zinc-200 truncate min-w-0">
        <PlayerName displayName={entry.display_name} username={entry.username} />
      </span>

      <span className="text-xs text-zinc-500 tabular-nums shrink-0">
        {Math.round(rankValue(entry)).toLocaleString()} RV
      </span>

      {entry.draft_entered_at && (
        <span className="text-xs text-zinc-500 tabular-nums hidden sm:block shrink-0">
          Entered {new Date(entry.draft_entered_at).toLocaleDateString()}
        </span>
      )}

      {confirming ? (
        <div className="flex items-center gap-2 shrink-0">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button
            onClick={handleRemove}
            disabled={isPending}
            className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "…" : "Confirm"}
          </button>
          <button
            onClick={() => { setConfirming(false); setError(null); }}
            disabled={isPending}
            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="px-3 py-1 bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700/50 text-red-400 text-xs font-medium rounded-lg transition-colors shrink-0"
        >
          Remove
        </button>
      )}
    </div>
  );
}

function TournamentEntryRow({ tournamentId, entry }: { tournamentId: string; entry: TournamentSignupPlayer }) {
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

function matchesSearch(search: string, ...haystack: (string | null)[]): boolean {
  const q = search.toLowerCase();
  return haystack.some((h) => (h ?? "").toLowerCase().includes(q));
}

export function DraftPoolPanel({
  entries,
  tournamentGroups = [],
}: {
  entries: DraftPoolEntry[];
  tournamentGroups?: DraftPoolTournamentGroup[];
}) {
  const [search, setSearch] = useState("");

  const filteredEntries = entries.filter((e) => matchesSearch(search, e.username, e.display_name));

  const filteredGroups = tournamentGroups
    .map((g) => ({
      ...g,
      playerEntries: g.playerEntries.filter((e) => matchesSearch(search, e.username, e.displayName)),
      teamSignups: g.teamSignups.filter((t) =>
        matchesSearch(search, t.name) || t.members.some((m) => matchesSearch(search, m.username, m.displayName))
      ),
    }))
    .filter((g) => g.playerEntries.length > 0 || g.teamSignups.length > 0);

  const isEmpty = filteredEntries.length === 0 && filteredGroups.length === 0;
  const hasMultipleSources = entries.length > 0 && tournamentGroups.length > 0;

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search sign-ups…"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      {isEmpty ? (
        <p className="text-zinc-500 text-sm">No sign-ups found.</p>
      ) : (
        <div className="space-y-5">
          {filteredEntries.length > 0 && (
            <div className="space-y-2">
              {hasMultipleSources && (
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Season Pool</p>
              )}
              {filteredEntries.map(e => <DraftPoolRow key={e.id} entry={e} />)}
            </div>
          )}

          {filteredGroups.map((g) => (
            <div key={g.tournamentId} className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                {g.tournamentName} · {g.joinMode === "teams" ? "Team Sign-ups" : "Player Sign-ups"}
              </p>
              <div className="space-y-2">
                {g.playerEntries.map((e) => (
                  <TournamentEntryRow key={e.playerId} tournamentId={g.tournamentId} entry={e} />
                ))}
                {g.teamSignups.map((t) => (
                  <TeamSignupRow key={t.id} team={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
