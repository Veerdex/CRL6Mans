"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DiscordMarkdownPreview } from "./discord-markdown-preview";
import { postAnnouncement, clearAnnouncement, checkAnnouncementMentions, type AnnouncementDestination } from "./announcement-actions";

type MentionCheck =
  | { forText: string; annotated: string }
  | { forText: string; error: string };

const DESTINATIONS: Array<{ value: AnnouncementDestination; label: string }> = [
  { value: "both", label: "Website + Discord" },
  { value: "website", label: "Website only" },
  { value: "discord", label: "Discord only" },
];

const SYNTAX_HINTS: Array<[string, string]> = [
  ["**bold**", "Bold"],
  ["*italic*", "Italic"],
  ["__underline__", "Underline"],
  ["~~strike~~", "Line through"],
  ["`code`", "Code"],
  ["||spoiler||", "Spoiler"],
  ["@RoleOrUser", "Mention"],
  ["#channel-name", "Channel link"],
];

export function AnnouncementManager({
  initialText,
  initialDestination,
  channelConfigured,
  postedAt,
}: {
  initialText: string;
  initialDestination: AnnouncementDestination;
  channelConfigured: boolean;
  postedAt: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [destination, setDestination] = useState<AnnouncementDestination>(initialDestination);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [mentionCheck, setMentionCheck] = useState<MentionCheck | null>(null);
  const [checkingMentions, setCheckingMentions] = useState(false);

  async function handleCheckMentions() {
    setCheckingMentions(true);
    const res = await checkAnnouncementMentions(text);
    setCheckingMentions(false);
    setMentionCheck("error" in res ? { forText: text, error: res.error } : { forText: text, annotated: res.annotated });
  }

  function handlePost() {
    setError(null);
    setStatus(null);
    start(async () => {
      const res = await postAnnouncement(text, destination);
      if (res.error) setError(res.error);
      else {
        setStatus("Announcement posted.");
        router.refresh();
      }
    });
  }

  function handleClear() {
    setError(null);
    setStatus(null);
    start(async () => {
      const res = await clearAnnouncement();
      if (res.error) setError(res.error);
      else {
        setText("");
        setStatus("Announcement cleared.");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {!channelConfigured && (
        <p className="text-xs text-amber-400/90 bg-amber-950/30 border border-amber-700/40 rounded-lg px-3 py-2">
          No announcement channel configured yet — run <code className="font-mono">/setannouncement</code> in the target Discord channel to enable Discord posting. The home-page banner and push notification still work without it.
        </p>
      )}
      {postedAt && (
        <p className="text-xs text-zinc-500">Currently live since {new Date(postedAt).toLocaleString()}.</p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Post to</span>
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
          {DESTINATIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setDestination(value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                destination === value ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {destination !== "website" && (
        <p className="text-xs text-zinc-500">
          Every post to Discord always starts with <code className="text-zinc-400">@everyone</code>. Reference a role or member with <code className="text-zinc-400">@name</code> and a channel with <code className="text-zinc-400">#channel-name</code> — matching ones are converted to real mentions/links.
        </p>
      )}
      <div className={`grid gap-5 ${destination === "website" ? "" : "md:grid-cols-2"}`}>
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={8}
            placeholder="Write your announcement..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {SYNTAX_HINTS.map(([syntax, label]) => (
              <span key={syntax} className="text-xs text-zinc-500">
                <code className="text-zinc-400">{syntax}</code> {label}
              </span>
            ))}
          </div>
        </div>
        {destination !== "website" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Discord Preview</p>
            <button
              type="button"
              onClick={handleCheckMentions}
              disabled={checkingMentions || !text.trim()}
              className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 text-zinc-300 rounded transition-colors"
            >
              {checkingMentions ? "Checking…" : "Check Mentions"}
            </button>
          </div>
          <DiscordMarkdownPreview
            text={
              mentionCheck?.forText === text && "annotated" in mentionCheck
                ? mentionCheck.annotated
                : text.trim() ? `@everyone\n${text}` : ""
            }
          />
          {mentionCheck?.forText === text && "error" in mentionCheck && (
            <p className="text-xs text-red-400">{mentionCheck.error}</p>
          )}
          {mentionCheck && mentionCheck.forText !== text && (
            <p className="text-xs text-zinc-500">Text changed since last check — click &ldquo;Check Mentions&rdquo; to re-verify.</p>
          )}
          {mentionCheck?.forText === text && "annotated" in mentionCheck && (
            <p className="text-xs text-zinc-500">
              <span className="text-emerald-400">green</span> will ping · <span className="text-amber-400">amber</span> fuzzy match, verify the name shown · <span className="text-zinc-400">grey</span> posts as plain text
            </p>
          )}
        </div>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handlePost}
          disabled={pending || !text.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {pending ? "Working…" : "Post Announcement"}
        </button>
        <button
          onClick={handleClear}
          disabled={pending || !initialText}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 text-zinc-200 text-sm font-medium rounded-lg transition-colors"
        >
          Clear Live Announcement
        </button>
        {status && <span className="text-xs text-emerald-400">{status}</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
