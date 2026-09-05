"use client";

import { SupporterBadge } from "./supporter-badge";
import { useNameDecoration } from "./name-decoration";
import { useProfileViewer } from "./profile-viewer";
import { nameStyle } from "@/app/lib/name-glint";

interface Props {
  displayName: string | null;
  username: string;
  /**
   * Preferred over the username for opening the profile. A username is a
   * snapshot: anywhere one was stored rather than read live, the player may
   * have renamed on Discord since and no longer resolves by it. The Discord ID
   * never changes, so pass it wherever the caller has one.
   */
  discordId?: string | null;
  className?: string;
  /**
   * Off inside the profile modal itself, and anywhere a name is decoration
   * rather than a reference to a player. Defaults on: every existing call site
   * gets the profile without being touched, which is why the lookup is keyed on
   * the username these already have rather than a discord_id they do not.
   */
  linkToProfile?: boolean;
}

export function PlayerName({
  displayName,
  username,
  discordId = null,
  className = "",
  linkToProfile = true,
}: Props) {
  const name = displayName ?? username;
  const decoration = useNameDecoration(username);
  const openProfile = useProfileViewer();
  const fx = nameStyle(
    decoration?.color ?? null,
    decoration?.outline ?? false,
    decoration?.glint ?? null,
  );

  const clickable = linkToProfile && openProfile !== null;
  const open = (e: React.SyntheticEvent) => {
    if (!clickable) return;
    // Names sit inside rows and cards that are themselves clickable; opening a
    // profile must not also navigate away from the page behind it.
    e.preventDefault();
    e.stopPropagation();
    openProfile!(discordId ? { discordId } : { username });
  };

  return (
    <span className={`relative inline-flex items-center group/pname max-w-full min-w-0 ${className}`}>
      <span
        // A span rather than a button: names are rendered inside anchors and
        // other buttons, where nested interactive elements are invalid markup.
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? open : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") open(e);
              }
            : undefined
        }
        className={`truncate min-w-0 ${fx.className} ${clickable ? "cursor-pointer hover:underline underline-offset-2" : ""}`}
        style={fx.style}
        title={name}
      >
        {name}
      </span>
      <SupporterBadge username={username} />
      <span className="
        absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1
        bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 whitespace-nowrap
        pointer-events-none select-none
        opacity-0 group-hover/pname:opacity-100 transition-opacity duration-150 z-50
      ">
        @{username}
      </span>
    </span>
  );
}
