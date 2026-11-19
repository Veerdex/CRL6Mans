"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { removePlayerFromDraft } from "./league-actions";
import { removeTournamentEntry, removeTeamSignup } from "./tournament-actions";
import { PlayerName } from "@/app/dashboard/player-name";
import { displayRatingFromRow } from "@/app/lib/rating";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";

export type DraftPoolEntry = {
  id: string;
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  peak_2v2: string;
  current_2v2: string;
  peak_3v3: string;
  current_3v3: string; rv_adjustment?: number | null;
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
  members: { playerId: string; status: string; discordId: string; username: string; displayName: string | null }[];
};

export type DraftPoolTournamentGroup = {
  tournamentId: string;
  tournamentName: string;
  /** Activated: its pool is the live draft's, so sign-ups can no longer be edited. */
  running: boolean;
  joinMode: "players" | "teams";
  playerEntries: TournamentSignupPlayer[];
  teamSignups: TournamentSignupTeam[];
};

const rankValue = displayRatingFromRow;

function Avatar({ discordId, avatar, username }: { discordId: string; avatar: string | null; username: string }) {
  return <PlayerAvatar discordId={discordId} avatar={avatar} username={username} className="w-7 h-7" />;
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
      <Avatar discordId={entry.discord_id} avatar={entry.avatar} username={entry.username} />

      <span className="flex-1 text-sm font-medium text-zinc-200 whitespace-nowrap min-w-0">
        <PlayerName displayName={entry.display_name} username={entry.username} discordId={entry.discord_id} />
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

function TournamentEntryRow({ tournamentId, entry, readOnly }: { tournamentId: string; entry: TournamentSignupPlayer; readOnly: boolean }) {
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
      <Avatar discordId={entry.discordId} avatar={entry.avatar} username={entry.username} />
      <span className="flex-1 text-sm text-zinc-200 whitespace-nowrap min-w-0">
        <PlayerName displayName={entry.displayName} username={entry.username} discordId={entry.discordId} />
      </span>
      {readOnly ? null : confirming ? (
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

function TeamSignupRow({ team, readOnly }: { team: TournamentSignupTeam; readOnly: boolean }) {
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
        {readOnly ? null : confirming ? (
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
            <PlayerName displayName={m.displayName} username={m.username} discordId={m.discordId} />
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
  const searching = search.trim() !== "";

  const filteredEntries = entries.filter((e) => matchesSearch(search, e.username, e.display_name));

  const filteredGroups = tournamentGroups.map((g) => ({
    ...g,
    playerEntries: g.playerEntries.filter((e) => matchesSearch(search, e.username, e.displayName)),
    teamSignups: g.teamSignups.filter((t) =>
      matchesSearch(search, t.name) || t.members.some((m) => matchesSearch(search, m.username, m.displayName))
    ),
  }));

  // While searching, an event with no match is noise; otherwise every event
  // keeps its section, so an empty one reads as "nobody yet" rather than missing.
  const visibleGroups = searching
    ? filteredGroups.filter((g) => g.playerEntries.length > 0 || g.teamSignups.length > 0)
    : filteredGroups;
  const showSeason = !searching || filteredEntries.length > 0;

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search sign-ups…"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      {!showSeason && visibleGroups.length === 0 ? (
        <p className="text-zinc-500 text-sm">No sign-ups found.</p>
      ) : (
        <div className="space-y-6">
          {showSeason && (
            <PoolSection title="Season" detail="Player sign-ups" count={entries.length} countLabel="player" empty={filteredEntries.length === 0}>
              {filteredEntries.map(e => <DraftPoolRow key={e.id} entry={e} />)}
            </PoolSection>
          )}

          {visibleGroups.map((g) => {
            const original = tournamentGroups.find((o) => o.tournamentId === g.tournamentId)!;
            const teams = g.joinMode === "teams";
            return (
              <PoolSection
                key={g.tournamentId}
                title={g.tournamentName}
                detail={teams ? "Team sign-ups" : "Player sign-ups"}
                count={teams ? original.teamSignups.length : original.playerEntries.length}
                countLabel={teams ? "team" : "player"}
                running={g.running}
                empty={g.playerEntries.length === 0 && g.teamSignups.length === 0}
              >
                {g.playerEntries.map((e) => (
                  <TournamentEntryRow key={e.playerId} tournamentId={g.tournamentId} entry={e} readOnly={g.running} />
                ))}
                {g.teamSignups.map((t) => (
                  <TeamSignupRow key={t.id} team={t} readOnly={g.running} />
                ))}
              </PoolSection>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PoolSection({
  title,
  detail,
  count,
  countLabel,
  running = false,
  empty,
  children,
}: {
  title: string;
  detail: string;
  count: number;
  countLabel: string;
  running?: boolean;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap border-b border-zinc-800 pb-1.5">
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        <span className="text-xs text-zinc-500">{detail}</span>
        {running && (
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-900/30 border border-emerald-700/40 text-emerald-300">
            Running · read-only
          </span>
        )}
        <span className="ml-auto text-xs text-zinc-500 tabular-nums">
          {count} {countLabel}{count === 1 ? "" : "s"}
        </span>
      </div>
      {empty ? <p className="text-xs text-zinc-500">No sign-ups yet.</p> : <div className="space-y-2">{children}</div>}
    </section>
  );
}
