"use client";

import { renderDiscordMarkdown } from "@/app/lib/discord-markdown";

export function DiscordMarkdownPreview({ text }: { text: string }) {
  const now = new Date();
  const timestamp = `Today at ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

  return (
    <div className="rounded-lg bg-[#313338] px-4 py-3 font-sans">
      <div className="flex gap-3">
        <div className="shrink-0 w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold">
          CRL
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-white text-[0.95rem]">CRL 6Mans</span>
            <span className="text-[0.65rem] font-semibold bg-indigo-600 text-white px-1 rounded">APP</span>
            <span className="text-[0.75rem] text-[#949ba4]">{timestamp}</span>
          </div>
          <div className="text-[#dbdee1] text-[0.9375rem] leading-[1.375] whitespace-pre-wrap break-words mt-0.5">
            {text.trim() ? renderDiscordMarkdown(text) : <span className="text-[#6d6f78] italic">Nothing to preview yet — start typing above.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
