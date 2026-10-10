"use client";

import { useEffect, useState } from "react";
import { PlayerAvatar } from "./player-avatar";
import { PlayerName } from "./player-name";
import { DefaultLogo } from "@/app/lib/team-logo";
import type { TeamProfile } from "@/app/lib/team-profile";

export function TeamProfileModal({
  teamId,
  onClose,
  /**
   * True while a player profile is stacked on top. Escape has to reach only the
   * topmost dialog, and both modals listen on the window — without this the one
   * keypress would close both.
   */
  covered,
}: {
  teamId: string;
  onClose: () => void;
  covered: boolean;
}) {
  const [profile, setProfile] = useState<TeamProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No state reset: the provider keys this component on teamId, so a different
  // team mounts a fresh one rather than reusing stale state.
  useEffect(() => {
    let live = true;
    fetch(`/api/team-profile?teamId=${encodeURIComponent(teamId)}`)
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) return setError("This team no longer exists.");
        if (!res.ok) return setError("Could not load this team.");
        setProfile(await res.json());
      })
      .catch(() => live && setError("Could not load this team."));
    return () => {
      live = false;
    };
  }, [teamId]);

  useEffect(() => {
    if (covered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [covered, onClose]);

  return (
    // z-[90]: under the player profile at z-[100], so clicking a roster name
    // stacks that profile on top of this rather than behind it.
    <div
      className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">Team</h2>
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
          <>
            <div className="p-5 flex items-center gap-4 border-b border-zinc-800">
              {profile.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.logoUrl}
                  alt={profile.name}
                  width={56}
                  height={56}
                  className="w-14 h-14 rounded-lg object-cover shrink-0"
                  style={{ objectPosition: `${profile.logoOffsetX}% ${profile.logoOffsetY}%` }}
                />
              ) : (
                <DefaultLogo name={profile.name} className="w-14 h-14 rounded-lg text-lg" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white truncate">{profile.name}</h3>
                  {profile.isDisqualified && (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-red-300 bg-red-500/15 border border-red-500/40 rounded px-1.5 py-0.5">
                      DQ
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500">
                  <span title="Team rating — carry-weighted, not a roster average">
                    Team RV {profile.teamRv.toLocaleString()}
                  </span>
                  {profile.isLocked && <span className="ml-2 text-amber-400">🔒</span>}
                </p>
              </div>
            </div>

            <div className="divide-y divide-zinc-800">
              {profile.roster.length === 0 ? (
                <p className="px-5 py-4 text-sm text-zinc-600 italic">No players on this team.</p>
              ) : (
                profile.roster.map((player) => (
                  <div
                    key={player.discordId ?? player.username}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <PlayerAvatar
                      discordId={player.discordId}
                      avatar={player.avatar}
                      username={player.username}
                      className="w-7 h-7"
                    />
                    <span className="flex-1 text-sm text-zinc-200 whitespace-nowrap min-w-0">
                      <PlayerName
                        displayName={player.displayName}
                        username={player.username}
                        discordId={player.discordId}
                      />
                      {player.isCaptain && (
                        <span className="ml-1.5 text-xs font-semibold text-yellow-400">C</span>
                      )}
                    </span>
                    <span className="text-xs text-zinc-500 shrink-0">
                      {player.rankValue.toLocaleString()} <span className="text-zinc-700">RV</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
