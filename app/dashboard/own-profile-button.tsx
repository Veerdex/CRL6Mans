"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { PlayerAvatar } from "./player-avatar";
import { NameDecorationProvider } from "./name-decoration";
import { PlayerProfileModal, type ProfileKey } from "./player-profile-modal";
import type { NameDecoration } from "@/app/lib/patreon-entitlements";

interface Props {
  discordId: string | null;
  avatar: string | null;
  border: string | null;
  name: string;
  /** Wrapper classes — the two nav layouts space their footers differently. */
  className?: string;
  avatarClassName?: string;
  decorations: [string, NameDecoration][];
  /** Off for guests and players with no roster row, who have no profile to open. */
  clickable?: boolean;
}

// The footer chrome renders outside ProfileViewerProvider, so this mounts its own
// copy of the modal rather than calling into the shared one.
export function OwnProfileButton({
  discordId,
  avatar,
  border,
  name,
  className = "",
  avatarClassName = "w-8 h-8",
  decorations,
  clickable = true,
}: Props) {
  const [target, setTarget] = useState<ProfileKey | null>(null);

  const avatarEl = (
    <PlayerAvatar discordId={discordId} avatar={avatar} border={border} className={avatarClassName} alt="avatar" />
  );

  if (!clickable || !discordId) {
    return (
      <div className={className}>
        {avatarEl}
        <span className="text-sm text-zinc-300 truncate">{name}</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setTarget({ discordId })}
        className={`${className} text-left cursor-pointer group/own`}
        title="View your profile"
      >
        {avatarEl}
        <span className="text-sm text-zinc-300 truncate group-hover/own:underline underline-offset-2">
          {name}
        </span>
      </button>
      {target &&
        createPortal(
          // Portaled to the body because the themes restyle every span inside the
          // sidebar and bottom bar, which would repaint the modal's text.
          <NameDecorationProvider decorations={decorations}>
            <PlayerProfileModal
              key={"username" in target ? target.username : target.discordId}
              target={target}
              onClose={() => setTarget(null)}
              onOpen={(key) => setTarget(key)}
            />
          </NameDecorationProvider>,
          document.body,
        )}
    </>
  );
}
