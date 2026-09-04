"use client";

import { SupporterBadge } from "./supporter-badge";
import { useNameDecoration } from "./name-decoration";
import { nameStyle } from "@/app/lib/name-glint";

interface Props {
  displayName: string | null;
  username: string;
  className?: string;
}

export function PlayerName({ displayName, username, className = "" }: Props) {
  const name = displayName ?? username;
  const decoration = useNameDecoration(username);
  const fx = nameStyle(
    decoration?.color ?? null,
    decoration?.outline ?? false,
    decoration?.glint ?? null,
  );

  return (
    <span className={`relative inline-flex items-center group/pname max-w-full min-w-0 ${className}`}>
      <span
        className={`truncate min-w-0 ${fx.className}`}
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
