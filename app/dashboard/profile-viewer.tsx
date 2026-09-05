"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { PlayerProfileModal, type ProfileKey } from "./player-profile-modal";

// The modal is mounted once at the layout root rather than by each PlayerName:
// names are rendered inside scrolling panels, table cells and stacking contexts
// that would clip or mis-layer a dialog opened in place.
//
// null outside the provider, which is deliberate — the sidebar and header chrome
// render outside it, and there a name is just a name.
const ProfileViewer = createContext<((key: ProfileKey) => void) | null>(null);

export function ProfileViewerProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<ProfileKey | null>(null);
  const open = useCallback((key: ProfileKey) => setTarget(key), []);

  return (
    <ProfileViewer.Provider value={open}>
      {children}
      {target && (
        <PlayerProfileModal
          key={"username" in target ? target.username : target.discordId}
          target={target}
          onClose={() => setTarget(null)}
        />
      )}
    </ProfileViewer.Provider>
  );
}

export function useProfileViewer(): ((key: ProfileKey) => void) | null {
  return useContext(ProfileViewer);
}
