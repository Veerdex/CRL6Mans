"use client";

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
      onClick={open}
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
