"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { PlayerProfileModal, type ProfileKey } from "./player-profile-modal";
import { TeamProfileModal } from "./team-profile-modal";

// The modal is mounted once at the layout root rather than by each PlayerName:
// names are rendered inside scrolling panels, table cells and stacking contexts
// that would clip or mis-layer a dialog opened in place.
//
// null outside the provider, which is deliberate — the sidebar and header chrome
// render outside it, and there a name is just a name.
const ProfileViewer = createContext<((key: ProfileKey) => void) | null>(null);

/**
 * Separate from the player slot rather than one stacked target list: the two
 * popups layer in exactly one direction. A team opens under a player profile,
 * so clicking a roster name stacks the player on top with the team still
 * behind it, and nothing inside the player profile opens a team.
 */
const TeamViewer = createContext<((teamId: string) => void) | null>(null);

export function ProfileViewerProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<ProfileKey | null>(null);
  const [teamTarget, setTeamTarget] = useState<string | null>(null);
  const open = useCallback((key: ProfileKey) => setTarget(key), []);
  const openTeam = useCallback((teamId: string) => setTeamTarget(teamId), []);

  return (
    <TeamViewer.Provider value={openTeam}>
      <ProfileViewer.Provider value={open}>
        {children}
        {/* Inside the player provider, so a roster name in the team popup is
            itself clickable. */}
        {teamTarget && (
          <TeamProfileModal
            key={teamTarget}
            teamId={teamTarget}
            covered={target !== null}
            onClose={() => setTeamTarget(null)}
          />
        )}
        {target && (
          <PlayerProfileModal
            key={"username" in target ? target.username : target.discordId}
            target={target}
            onClose={() => setTarget(null)}
            onOpen={open}
          />
        )}
      </ProfileViewer.Provider>
    </TeamViewer.Provider>
  );
}

/**
 * Renders team names as plain text instead of popup triggers. The archive
 * viewer reuses the live bracket and standings components, but `resetSeason`
 * keeps team slots while clearing their rosters — so an archived team id
 * resolves to a row that has since been reused by a different roster, and a
 * popup opened from an archive would confidently show the wrong players.
 */
export function TeamViewerDisabled({ children }: { children: React.ReactNode }) {
  return <TeamViewer.Provider value={null}>{children}</TeamViewer.Provider>;
}

export function useProfileViewer(): ((key: ProfileKey) => void) | null {
  return useContext(ProfileViewer);
}

export function useTeamViewer(): ((teamId: string) => void) | null {
  return useContext(TeamViewer);
}
