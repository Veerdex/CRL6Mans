export type RulesContext = {
  scope: "season" | "tournament";
  joinMode?: "players" | "teams" | null;
  teamAssignment?: "snake_draft" | "auto_balance" | null;
  hasPlayoffs?: boolean;
  minMmr2v2?: number | null;
  minMmr3v3?: number | null;
};

export function seasonRulesContext(minMmr2v2: number | null, minMmr3v3: number | null): RulesContext {
  return { scope: "season", minMmr2v2, minMmr3v3 };
}

export function tournamentRulesContext(
  t: {
    join_mode: "players" | "teams";
    team_assignment: "snake_draft" | "auto_balance" | null;
    min_mmr_2v2: number | null;
    min_mmr_3v3: number | null;
  },
  hasPlayoffs: boolean
): RulesContext {
  return {
    scope: "tournament",
    joinMode: t.join_mode,
    teamAssignment: t.team_assignment,
    hasPlayoffs,
    minMmr2v2: t.min_mmr_2v2,
    minMmr3v3: t.min_mmr_3v3,
  };
}

// Keyed by the leading section/subsection number in each heading. A missing
// entry means "always visible." Section-level hides (e.g. "3") don't need to
// be mirrored on every child — each child that should follow suit lists its
// own equivalent predicate, since blocks are filtered independently.
const SECTION_VISIBILITY: Record<string, (ctx: RulesContext) => boolean> = {
  "3": (ctx) => ctx.joinMode !== "teams",
  "3.1": (ctx) => ctx.joinMode !== "teams",
  "3.2": (ctx) => ctx.joinMode !== "teams" && ctx.teamAssignment !== "auto_balance",
  "3.3": (ctx) => ctx.joinMode !== "teams" && ctx.teamAssignment === "auto_balance",
  "3.4": (ctx) => ctx.joinMode !== "teams",
  "5": (ctx) => ctx.joinMode !== "teams",
  "5.1": (ctx) => ctx.joinMode !== "teams",
  "5.2": (ctx) => ctx.joinMode !== "teams",
  "5.3": (ctx) => ctx.joinMode !== "teams",
  "5.4": (ctx) => ctx.joinMode !== "teams",
  "5.5": (ctx) => ctx.joinMode !== "teams" && ctx.hasPlayoffs !== false,
  "6": (ctx) => ctx.scope === "season",
  "6.1": (ctx) => ctx.scope === "season",
  "6.2": (ctx) => ctx.scope === "season",
  "7.2": (ctx) => ctx.scope === "season",
  "7.3": (ctx) => ctx.scope === "season",
};

const HEADING_RE = /^(#{2,3})\s+(?:Section\s+)?(\d+(?:\.\d+)?)\b/;
const MMR_NOTE_TOKEN = "{{MMR_NOTE}}";

// Splits the document into blocks at every heading boundary, drops blocks
// whose section number fails its visibility rule, then reassembles the
// survivors with a "---" divider re-inserted between top-level sections
// (rather than trusting the original trailing dividers, which would go
// missing whenever the section carrying them gets filtered out).
export function filterRulesMarkdown(markdown: string, ctx: RulesContext): string {
  const blocks = markdown.split(/\n(?=#{2,3}\s)/);
  const kept: string[] = [];
  let sawTopLevel = false;

  for (const block of blocks) {
    const newlineIdx = block.indexOf("\n");
    const headingLine = newlineIdx === -1 ? block : block.slice(0, newlineIdx);
    const match = headingLine.match(HEADING_RE);
    const number = match?.[2] ?? null;
    const visible = number ? (SECTION_VISIBILITY[number]?.(ctx) ?? true) : true;
    if (!visible) continue;

    const isTopLevel = headingLine.startsWith("## ");
    const content = block.replace(/\n+---\s*$/, "").trim();
    if (isTopLevel) {
      if (sawTopLevel) kept.push("---");
      sawTopLevel = true;
    }
    kept.push(content);
  }

  let result = kept.join("\n\n");

  const subject = ctx.scope === "tournament" ? "This tournament" : "This season";
  if (ctx.minMmr2v2 || ctx.minMmr3v3) {
    const reqs = [
      ctx.minMmr2v2 ? `**${ctx.minMmr2v2}** 2v2 peak MMR` : null,
      ctx.minMmr3v3 ? `**${ctx.minMmr3v3}** 3v3 peak MMR` : null,
    ]
      .filter(Boolean)
      .join(" or ");
    result = result.replace(MMR_NOTE_TOKEN, `${subject} requires at least ${reqs}.`);
  } else {
    result = result.replace(MMR_NOTE_TOKEN, `${subject} currently has no minimum MMR requirement.`);
  }

  return result;
}
