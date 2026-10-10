"use client";

import { useRef } from "react";
import { useTeamViewer } from "./profile-viewer";

interface Props {
  teamId: string;
  /** Only used by the fallback link, which searches the Teams page by name. */
  name: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

/**
 * A team name that opens the team popup.
 *
 * Children rather than the name, because the label a bracket renders is not
 * always `teams[id].name` — and `className`/`title` pass straight through so a
 * call site keeps its own truncation, win/loss colouring and tooltip.
 *
 * Outside a team viewer — the archive viewer, which disables it — this falls
 * back to the navigation these call sites used before: the Teams page filtered
 * to the name, with a Back to Season button.
 */
export function TeamLink({ teamId, name, className = "", title, children }: Props) {
  const openTeam = useTeamViewer();
  const downAt = useRef<{ x: number; y: number } | null>(null);

  if (!openTeam) {
    return (
      <a
        href={`/dashboard/teams?search=${encodeURIComponent(name)}&from=season`}
        title={title}
        className={`hover:underline ${className}`}
      >
        {children}
      </a>
    );
  }

  const open = (e: React.SyntheticEvent) => {
    // Bracket cards and table rows can be clickable themselves; opening the
    // popup must not also navigate away from the page behind it.
    e.preventDefault();
    e.stopPropagation();
    openTeam(teamId);
  };

  return (
    <span
      // A span rather than a button, for the same reason as PlayerName: a real
      // button would centre the label and break the `truncate` these call sites
      // rely on, and would be invalid markup inside an enclosing anchor.
      role="button"
      tabIndex={0}
      onMouseDown={(e) => { downAt.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        const down = downAt.current;
        downAt.current = null;
        // A bracket pan that starts and ends on the same name still fires a
        // click — BracketCanvas only guards its own data-goto navigation, so
        // dragging off a team name would otherwise open the popup. Same 4px
        // threshold the canvas uses to call a drag a drag.
        if (down && (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4)) return;
        open(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open(e);
      }}
      title={title}
      className={`cursor-pointer hover:underline ${className}`}
    >
      {children}
    </span>
  );
}
