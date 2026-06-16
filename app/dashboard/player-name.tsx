"use client";

interface Props {
  displayName: string | null;
  username: string;
  className?: string;
}

export function PlayerName({ displayName, username, className = "" }: Props) {
  const name = displayName ?? username;

  return (
    <span className={`relative inline-flex items-center group/pname max-w-full min-w-0 ${className}`}>
      <span className="truncate min-w-0" title={name}>{name}</span>
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
