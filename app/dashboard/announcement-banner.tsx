"use client";

import { renderDiscordMarkdown } from "@/app/lib/discord-markdown";

export function AnnouncementBanner({ text }: { text: string }) {
  return (
    <div className="bg-indigo-950/40 border border-indigo-700/50 rounded-xl px-4 py-3 space-y-1">
      <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Announcement</p>
      <div className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
        {renderDiscordMarkdown(text)}
      </div>
    </div>
  );
}
