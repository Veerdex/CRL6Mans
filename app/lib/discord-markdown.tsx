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
