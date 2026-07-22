"use client";

import { useState } from "react";

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(true)}
      className={`rounded px-1 cursor-pointer transition-colors ${
        revealed ? "bg-zinc-700 text-zinc-100" : "bg-zinc-950 text-transparent select-none"
      }`}
    >
      {children}
    </span>
  );
}

function matchWrapped(rest: string, marker: string): { content: string; length: number } | null {
  if (!rest.startsWith(marker)) return null;
  const closeIdx = rest.indexOf(marker, marker.length);
  if (closeIdx === -1) return null;
  const content = rest.slice(marker.length, closeIdx);
  if (content.length === 0) return null;
  return { content, length: closeIdx + marker.length };
}

// Ordered longest/most-specific marker first so e.g. ***bold-italic*** is
// caught whole before the plain ** or * rules ever see it, and __**bold**__
// resolves via recursion instead of a hand-written combo for every pairing.
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let buffer = "";
  let i = 0;
  let key = 0;
  const flush = () => {
    if (buffer) {
      nodes.push(buffer);
      buffer = "";
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);
    const k = `${keyPrefix}-${key++}`;

    const escaped = rest.match(/^\\([\\*_~`|])/);
    if (escaped) {
      buffer += escaped[1];
      i += escaped[0].length;
      continue;
    }

    if (rest[0] === "\n") {
      flush();
      nodes.push(<br key={k} />);
      i += 1;
      continue;
    }

    const resolvedMention = rest.match(/^OK([^]*)/);
    if (resolvedMention) {
      flush();
      nodes.push(
        <span
          key={k}
          className="bg-emerald-500/25 text-emerald-300 rounded px-1 font-medium"
          title="Resolves to a real Discord mention"
        >
          {resolvedMention[1]}
        </span>,
      );
      i += resolvedMention[0].length;
      continue;
    }

    const ambiguousMention = rest.match(/^AM([^]*)/);
    if (ambiguousMention) {
      flush();
      nodes.push(
        <span
          key={k}
          className="bg-amber-500/25 text-amber-300 rounded px-1 font-medium"
          title="No exact match — Discord's fuzzy search picked the closest name; verify this is the intended person"
        >
          {ambiguousMention[1]}
        </span>,
      );
      i += ambiguousMention[0].length;
      continue;
    }

    const unresolvedMention = rest.match(/^NO([^]*)/);
    if (unresolvedMention) {
      flush();
      nodes.push(
        <span
          key={k}
          className="bg-zinc-700/40 text-zinc-400 rounded px-1"
          title="No matching role, member, or channel — will post as plain text"
        >
          {unresolvedMention[1]}
        </span>,
      );
      i += unresolvedMention[0].length;
      continue;
    }

    const url = rest.match(/^https?:\/\/[^\s<]+/);
    if (url) {
      let href = url[0];
      const trailing = href.match(/[.,!?;:'")\]}>]+$/);
      if (trailing) href = href.slice(0, href.length - trailing[0].length);
      flush();
      nodes.push(
        <a
          key={k}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 underline decoration-indigo-400/40 hover:decoration-indigo-400 break-all"
        >
          {href}
        </a>,
      );
      i += href.length;
      continue;
    }

    const everyoneOrHere = rest.match(/^@(everyone|here)\b/);
    if (everyoneOrHere) {
      flush();
      nodes.push(
        <span key={k} className="bg-indigo-500/30 text-indigo-300 rounded px-1 font-medium">
          @{everyoneOrHere[1]}
        </span>,
      );
      i += everyoneOrHere[0].length;
      continue;
    }

    const mention = rest.match(/^@[A-Za-z0-9_.-]+/);
    if (mention) {
      flush();
      nodes.push(
        <span key={k} className="bg-indigo-500/30 text-indigo-300 rounded px-1 font-medium">
          {mention[0]}
        </span>,
      );
      i += mention[0].length;
      continue;
    }

    const channelMention = rest.match(/^#[A-Za-z0-9_-]+/);
    if (channelMention) {
      flush();
      nodes.push(
        <span key={k} className="bg-indigo-500/30 text-indigo-300 rounded px-1 font-medium">
          {channelMention[0]}
        </span>,
      );
      i += channelMention[0].length;
      continue;
    }

    const spoiler = matchWrapped(rest, "||");
    if (spoiler) {
      flush();
      nodes.push(<Spoiler key={k}>{parseInline(spoiler.content, k)}</Spoiler>);
      i += spoiler.length;
      continue;
    }

    const code = matchWrapped(rest, "`");
    if (code) {
      flush();
      nodes.push(
        <code key={k} className="bg-zinc-950/60 border border-zinc-700 rounded px-1 py-0.5 text-[0.85em] font-mono text-rose-200">
          {code.content}
        </code>,
      );
      i += code.length;
      continue;
    }

    const boldItalic = matchWrapped(rest, "***");
    if (boldItalic) {
      flush();
      nodes.push(
        <strong key={k}>
          <em>{parseInline(boldItalic.content, k)}</em>
        </strong>,
      );
      i += boldItalic.length;
      continue;
    }

    const underlineItalic = matchWrapped(rest, "___");
    if (underlineItalic) {
      flush();
      nodes.push(
        <u key={k}>
          <em>{parseInline(underlineItalic.content, k)}</em>
        </u>,
      );
      i += underlineItalic.length;
      continue;
    }

    const strike = matchWrapped(rest, "~~");
    if (strike) {
      flush();
      nodes.push(<del key={k}>{parseInline(strike.content, k)}</del>);
      i += strike.length;
      continue;
    }

    const underline = matchWrapped(rest, "__");
    if (underline) {
      flush();
      nodes.push(<u key={k}>{parseInline(underline.content, k)}</u>);
      i += underline.length;
      continue;
    }

    const bold = matchWrapped(rest, "**");
    if (bold) {
      flush();
      nodes.push(<strong key={k}>{parseInline(bold.content, k)}</strong>);
      i += bold.length;
      continue;
    }

    const italicStar = matchWrapped(rest, "*");
    if (italicStar) {
      flush();
      nodes.push(<em key={k}>{parseInline(italicStar.content, k)}</em>);
      i += italicStar.length;
      continue;
    }

    const italicUnderscore = matchWrapped(rest, "_");
    if (italicUnderscore) {
      flush();
      nodes.push(<em key={k}>{parseInline(italicUnderscore.content, k)}</em>);
      i += italicUnderscore.length;
      continue;
    }

    buffer += rest[0];
    i += 1;
  }
  flush();
  return nodes;
}

export function renderDiscordMarkdown(text: string): React.ReactNode[] {
  const codeBlockRegex = /```(?:\w+\n)?([\s\S]*?)```/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...parseInline(text.slice(lastIndex, match.index), `t${key}`));
    }
    nodes.push(
      <pre
        key={`cb${key++}`}
        className="my-1 bg-zinc-950/60 border border-zinc-700 rounded-md px-3 py-2 text-[0.85em] font-mono text-zinc-200 overflow-x-auto whitespace-pre-wrap"
      >
        {match[1].replace(/\n$/, "")}
      </pre>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(...parseInline(text.slice(lastIndex), `t${key}`));
  }
  return nodes;
}
