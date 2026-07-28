// Pure mapping helpers — convert the archive's camelCase, DB-agnostic shape
// back into the snake_case, DB-column-shaped props the existing live bracket
// *Display components expect, so this viewer can render them unmodified.

import type { TournamentArchive } from "../tournament-archive";
import type { DBMatch as BracketDBMatch, Team as BracketTeam } from "@/app/dashboard/season/bracket-display";
import type { GroupMatchRow } from "@/app/dashboard/season/group-stage-client";
import { parseGroupNum } from "@/app/lib/bracket";

export function toDbMatch(m: TournamentArchive["matches"][number]): BracketDBMatch {
  return {
    id: m.id,
    round: m.round,
    match_number: m.matchNumber,
    stage: m.stage ?? "",
    status: m.status,
    home_team_id: m.homeTeamId,
    away_team_id: m.awayTeamId,
    home_score: m.homeScore,
    away_score: m.awayScore,
  };
}

export function toTeamMap(teams: TournamentArchive["teams"]): Record<string, BracketTeam> {
  const out: Record<string, BracketTeam> = {};
  for (const t of teams) out[t.id] = { id: t.id, name: t.name, logo_url: t.logoUrl };
  return out;
}

export function toHybridTeamMap(teams: TournamentArchive["teams"]): Record<string, { name: string; logo_url: string | null }> {
  const out: Record<string, { name: string; logo_url: string | null }> = {};
  for (const t of teams) out[t.id] = { name: t.name, logo_url: t.logoUrl };
  return out;
}

export function toGroupMatches(matches: TournamentArchive["matches"]): GroupMatchRow[] {
  return matches.map((m) => ({
    ...toDbMatch(m),
    groupNum: parseGroupNum(m.stage ?? "") ?? 0,
  }));
}

// Mirrors buildTeamTitles (app/lib/team-titles.ts) but reads ratings already
// baked into the archive's roster entries instead of recomputing from live MMR.
export function buildArchiveTeamTitles(teams: TournamentArchive["teams"]): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const t of teams) {
    titles[t.id] = [...t.roster]
      .sort((a, b) => b.rating - a.rating)
      .map((p) => `${p.displayName ?? p.username} (${p.rating})`)
      .join("\n");
  }
  return titles;
}
