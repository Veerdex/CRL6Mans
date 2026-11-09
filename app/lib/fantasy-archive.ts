import type { Schedule, Standing } from "./fantasy-schedule";
import type { LineupSlot } from "./fantasy-draft";
import { ordinal } from "./fantasy-notices";

// The shape a fantasy season is kept in once its event ends (docs/fantasy-rl.md
// §15). Pure, so node --test can load it: the server half is
// fantasy-season-end.ts.

/** Someone as they were at the end: the id is the account id, the discordId survives a rename. */
export type ArchivedPerson = { id: string; discordId: string | null; name: string; username: string | null };

export type ArchivedStanding = Standing & { place: number };

/**
 * A manager's week as the matchup tab drew it (ManagerWeek). Structural here so
 * this module stays free of the server one; fantasy-season-end reads it back typed.
 */
export type ArchivedManagerWeek = { total: number; starters: unknown[]; bench: unknown[] };

/** What the league pages draw an ended league from. Dropped when the event's archive is exported. */
export type FantasyLeagueDetail = {
  schedule: Schedule;
  /** week → manager → lineup, as entries since a Map doesn't survive JSON. */
  lineups: [number, [string, ArchivedManagerWeek][]][];
  rosters: { managerId: string; slot: LineupSlot; player: ArchivedPerson; seasonPoints: number }[];
  draft: { pick: number; managerId: string; player: ArchivedPerson; auto: boolean }[];
};

/** fantasy_leagues.summary: the permanent record, plus the detail until export. */
export type FantasyLeagueSummary = {
  seasonName: string;
  endedAt: string;
  managers: ArchivedPerson[];
  standings: ArchivedStanding[];
  /** Manager account id, or null when the playoffs never finished. */
  champion: string | null;
  detail?: FantasyLeagueDetail;
};

export type FantasyArchiveLeague = { leagueId: string; name: string; visibility: "public" | "private"; summary: FantasyLeagueSummary };

/** The `fantasy` key of an event's full_archive. */
export type FantasyArchive = { seasonId: string; seasonName: string; leagues: FantasyArchiveLeague[] };

export function lineupsToEntries(lineups: Map<number, Map<string, ArchivedManagerWeek>>): FantasyLeagueDetail["lineups"] {
  return [...lineups].map(([week, managers]) => [week, [...managers]]);
}

export function withoutDetail(summary: FantasyLeagueSummary): FantasyLeagueSummary {
  const { detail: _detail, ...rest } = summary;
  void _detail;
  return rest;
}

/** Standings already in finishing order: the champion and runner-up lead, then the regular-season table. */
export function placedStandings(schedule: Schedule): ArchivedStanding[] {
  const final = schedule.weeks.find((w) => w.kind === "final" && w.closed);
  const finalists = final?.matchups[0] && final.matchups[0].b !== null && schedule.champion
    ? [schedule.champion, final.matchups[0].a === schedule.champion ? final.matchups[0].b : final.matchups[0].a]
    : [];
  const ordered = [
    ...finalists.map((id) => schedule.standings.find((s) => s.managerId === id)!).filter(Boolean),
    ...schedule.standings.filter((s) => !finalists.includes(s.managerId)),
  ];
  return ordered.map((s, i) => ({ ...s, place: i + 1 }));
}

/** The one notice each manager gets when the season is complete. */
export function completionNotices(leagueName: string, summary: FantasyLeagueSummary): { to: string; title: string; body: string }[] {
  const name = (id: string) => summary.managers.find((m) => m.id === id)?.name ?? "Unknown";
  return summary.standings.map((s) => {
    if (s.managerId === summary.champion) {
      return { to: s.managerId, title: "Fantasy season complete", body: `${leagueName}: you're the champion of ${summary.seasonName}.` };
    }
    const lead = summary.champion ? `${name(summary.champion)} won ${summary.seasonName}` : `${summary.seasonName} is over`;
    return { to: s.managerId, title: "Fantasy season complete", body: `${leagueName}: ${lead}, and you finished ${ordinal(s.place)}.` };
  });
}
