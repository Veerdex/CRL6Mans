"use client";

import { useEffect, useState } from "react";
import { PlayerAvatar } from "./player-avatar";
import { PlayerName } from "./player-name";
import { formatPlacement } from "@/app/lib/career-points";
import type { PlayerProfile } from "@/app/lib/player-profile";
import type { EventHistoryEntry } from "@/app/lib/event-results";

export type ProfileKey = { username: string } | { discordId: string };

export function PlayerProfileModal({
  target,
  onClose,
  onOpen,
}: {
  target: ProfileKey;
  onClose: () => void;
  /**
   * Passed down rather than read back from the viewer context: the provider is
   * what renders this component, so importing the context here would make the
   * two modules circular.
   */
  onOpen: (key: ProfileKey) => void;
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const query =
    "username" in target
      ? `username=${encodeURIComponent(target.username)}`
      : `discordId=${encodeURIComponent(target.discordId)}`;

  // No state reset here: the provider keys this component on the target, so a
  // different player mounts a fresh one rather than reusing stale state.
  useEffect(() => {
    let live = true;
    fetch(`/api/player-profile?${query}`)
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) return setError("No profile for this player.");
        if (!res.ok) return setError("Could not load this profile.");
        setProfile(await res.json());
      })
      .catch(() => live && setError("Could not load this profile."));
    return () => {
      live = false;
    };
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The history popup sits on top, so Escape closes that first.
      if (historyOpen) setHistoryOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen, onClose]);

  return (
    <>
      {/*
        The history popup is a sibling of this overlay, not a child: nested
        inside it, a click on the popup's own backdrop would bubble out here and
        close the profile behind it too.
      */}
      <div
        className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 p-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">Player Profile</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-zinc-400 hover:text-white text-xl leading-none px-1"
            >
              ×
            </button>
          </div>

          {error && <p className="p-6 text-sm text-zinc-400">{error}</p>}
          {!error && !profile && <p className="p-6 text-sm text-zinc-500">Loading…</p>}

          {profile && (
            <div className="p-4 grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-4 min-w-0">
                <Identity profile={profile} />
                {/* mt-auto pins the button to the bottom of a column that is as
                    tall as the stats beside it. */}
                <button
                  onClick={() => setHistoryOpen(true)}
                  className="mt-auto w-full rounded-xl border border-zinc-700 bg-zinc-800/60 hover:bg-zinc-800 px-4 py-2.5 text-sm font-medium text-white transition-colors"
                >
                  Event History
                  <span className="ml-1.5 text-zinc-400">({profile.events.length})</span>
                </button>
              </div>

              <div className="flex flex-col gap-4 min-w-0">
                <SixMans profile={profile} />
                <Ranks profile={profile} />
              </div>
            </div>
          )}
        </div>
      </div>

      {profile && historyOpen && (
        <EventHistory
          events={profile.events}
          onClose={() => setHistoryOpen(false)}
          onOpen={onOpen}
        />
      )}
    </>
  );
}

function Identity({ profile }: { profile: PlayerProfile }) {
  const { identity } = profile;
  return (
    <div className="flex flex-col items-center text-center gap-3 rounded-xl bg-zinc-800/40 border border-zinc-800 p-5">
      <PlayerAvatar
        discordId={identity.discordId}
        avatar={identity.avatar}
        username={identity.username}
        className="w-28 h-28"
        cdnSize={256}
      />
      <div className="max-w-full text-lg font-semibold">
        <PlayerName displayName={identity.displayName} username={identity.username} linkToProfile={false} />
      </div>
      {profile.teamName && (
        <p className="text-xs text-zinc-400 -mt-2">
          {profile.teamName}
          {profile.isCaptain && <span className="text-amber-400"> · Captain</span>}
        </p>
      )}
      <div>
        <p className="text-3xl font-bold text-indigo-400 tabular-nums">
          {Math.round(profile.careerPoints).toLocaleString()}
        </p>
        <p className="text-[11px] uppercase tracking-wide text-zinc-500">Career Points</p>
      </div>
    </div>
  );
}

function SixMans({ profile }: { profile: PlayerProfile }) {
  const { sixMans } = profile;
  return (
    <section className="rounded-xl bg-zinc-800/40 border border-zinc-800 p-4">
      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-3">6mans</h3>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Current MMR" value={fmt(sixMans.currentMmr)} />
        <Stat label="Peak MMR" value={fmt(sixMans.peakMmr)} />
        <Stat label="Wins" value={fmt(sixMans.wins)} />
        <Stat label="Losses" value={fmt(sixMans.losses)} />
      </div>
    </section>
  );
}

function Ranks({ profile }: { profile: PlayerProfile }) {
  const { ranks } = profile;
  return (
    <section className="rounded-xl bg-zinc-800/40 border border-zinc-800 p-4">
      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-3">Rocket League MMR</h3>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Season Peak 2v2" value={fmt(ranks.seasonPeak2v2)} />
        <Stat label="All Time Peak 2v2" value={fmt(ranks.allTimePeak2v2)} />
        <Stat label="Season Peak 3v3" value={fmt(ranks.seasonPeak3v3)} />
        <Stat label="All Time Peak 3v3" value={fmt(ranks.allTimePeak3v3)} />
      </div>
    </section>
  );
}

function EventHistory({
  events,
  onClose,
  onOpen,
}: {
  events: EventHistoryEntry[];
  onClose: () => void;
  onOpen: (key: ProfileKey) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85dvh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-4 border-b border-zinc-800 sticky top-0 bg-zinc-900">
          <h2 className="text-sm font-semibold text-white">Event History</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-zinc-400 hover:text-white text-xl leading-none px-1"
          >
            ×
          </button>
        </div>

        {events.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">No finished events yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {events.map((e) => (
              <li key={`${e.event_kind}:${e.event_id}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white truncate">{e.event_name}</p>
                    <p className="text-xs text-zinc-500">
                      {e.event_kind === "season" ? "Season" : "Tournament"}
                      {e.team_name && ` · ${e.team_name}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-amber-400">
                      {formatPlacement(e.placement, e.placement_tier_size)}
                    </p>
                    <p className="text-xs text-zinc-500 tabular-nums">
                      +{Math.round(e.points).toLocaleString()} pts
                    </p>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <Meta label="Prize Pool" value={`${e.prize_pool.toLocaleString()} coins`} />
                  <Meta label="Teams" value={String(e.team_count)} />
                  <Meta label="Players" value={String(e.participant_count)} />
                </dl>

                {e.teammates.length > 0 && (
                  <p className="mt-2 text-xs text-zinc-400">
                    <span className="text-zinc-500">With </span>
                    {e.teammates.map((m, i) => (
                      <span key={m.discordId ?? m.username}>
                        {i > 0 && ", "}
                        <Teammate mate={m} onOpen={onOpen} />
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * A roster entry opens by discord_id, not by the username stored beside it: the
 * username is a snapshot from the day the event ended, so a player who renamed
 * since would not resolve by it. Archives written before schema version 2 carry
 * no discord_id at all, and there the name stays plain text.
 */
function Teammate({
  mate,
  onOpen,
}: {
  mate: EventHistoryEntry["teammates"][number];
  onOpen: (key: ProfileKey) => void;
}) {
  const name = mate.displayName ?? mate.username;
  const discordId = mate.discordId;
  if (!discordId) return <>{name}</>;
  return (
    <button
      onClick={() => onOpen({ discordId })}
      className="text-zinc-300 hover:text-white hover:underline underline-offset-2"
    >
      {name}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-2">
      <p className="text-base font-semibold text-white tabular-nums">{value}</p>
      <p className="text-[11px] text-zinc-500 leading-tight">{label}</p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-300 tabular-nums">{value}</dd>
    </div>
  );
}

/** A dash, not a zero: a player with no queue-bot row has no measurement at all. */
function fmt(value: number | null): string {
  if (value === null) return "—";
  return Math.round(value).toLocaleString();
}
