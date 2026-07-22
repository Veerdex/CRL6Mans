"use client";

import { useEffect, useRef, useState } from "react";
import { renderDiscordMarkdown } from "@/app/lib/discord-markdown";

const CLAMPED_CLASS = "line-clamp-[7]";

export function AnnouncementBanner({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div className="bg-indigo-950/40 border border-indigo-700/50 rounded-xl px-4 py-3 space-y-1">
      <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Announcement</p>
      <div
        ref={contentRef}
        className={`text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap break-words ${expanded ? "" : CLAMPED_CLASS}`}
      >
        {renderDiscordMarkdown(text)}
      </div>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-xs font-medium text-indigo-300 hover:text-indigo-200 underline decoration-indigo-400/40"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
