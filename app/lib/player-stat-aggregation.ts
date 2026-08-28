// Pure — no server dependencies, safe to import anywhere. Shared by the live
// stats page (keyed by player_id, joined against DB player/team lookups) and
// the client-side archive viewer (keyed by username, already denormalized in
// the archive's playerGameStats).

import type { PlayerStatRow } from "@/app/dashboard/stats/stats-table";

export type StatAggregationInput = {
  key: string; // grouping identity — player_id for live queries, username for archive data
  username: string;
  displayName: string | null;
  teamName: string | null;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  score: number;
  demos: number;
  demoed: number;
};

export function aggregatePlayerGameStats(rows: StatAggregationInput[]): PlayerStatRow[] {
  type Agg = {
    username: string;
    displayName: string | null;
    teamName: string | null;
    totalGoals: number;
    totalAssists: number;
    totalSaves: number;
    totalShots: number;
    totalScore: number;
    totalDemos: number;
    totalDemoed: number;
    games: number;
  };

  const aggMap = new Map<string, Agg>();
  for (const r of rows) {
    const prev = aggMap.get(r.key) ?? {
      username: r.username, displayName: r.displayName, teamName: r.teamName,
      totalGoals: 0, totalAssists: 0, totalSaves: 0, totalShots: 0, totalScore: 0,
      totalDemos: 0, totalDemoed: 0, games: 0,
    };
    aggMap.set(r.key, {
      username: prev.username, displayName: prev.displayName, teamName: prev.teamName,
      totalGoals:   prev.totalGoals   + r.goals,
      totalAssists: prev.totalAssists + r.assists,
      totalSaves:   prev.totalSaves   + r.saves,
      totalShots:   prev.totalShots   + r.shots,
      totalScore:   prev.totalScore   + r.score,
      totalDemos:   prev.totalDemos   + r.demos,
      totalDemoed:  prev.totalDemoed  + r.demoed,
      games:        prev.games        + 1,
    });
  }

  return [...aggMap.entries()].map(([playerId, agg]) => ({
    playerId,
    username: agg.username,
    displayName: agg.displayName,
    teamName: agg.teamName,
    games: agg.games,
    totalGoals: agg.totalGoals,
    totalAssists: agg.totalAssists,
    totalSaves: agg.totalSaves,
    totalShots: agg.totalShots,
    totalScore: agg.totalScore,
    totalDemos: agg.totalDemos,
    totalDemoed: agg.totalDemoed,
  }));
}
