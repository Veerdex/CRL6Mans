"use client";

import { useState } from "react";
import {
  SWISS_STAGE, GROUP_STAGE_PREFIX,
  DE_WINNERS, DE_LOSERS, DE_GF,
  SE_QUALIFIER, DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS,
  HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF,
  HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF,
} from "@/app/lib/bracket";
import { getNumGroups } from "@/app/dashboard/season/format-constants";
import { SEBracketDisplay, DEBracketDisplay, DEQualifierBracketDisplay } from "@/app/dashboard/season/bracket-display";
import { SwissBracketDisplay } from "@/app/dashboard/season/swiss-display";
import { HybridBracketDisplay } from "@/app/dashboard/season/hybrid-display";
import { GroupStageClient } from "@/app/dashboard/season/group-stage-client";
import { StandingsClient, type StandingsRow } from "@/app/dashboard/season/standings-table";
import { SeasonTabs, type SeasonTab } from "@/app/dashboard/season/season-tabs";
import { StatsTable } from "@/app/dashboard/stats/stats-table";
import { aggregatePlayerGameStats, type StatAggregationInput } from "@/app/lib/player-stat-aggregation";
import { LocalTime } from "@/app/dashboard/local-time";
import type { TournamentArchive } from "../tournament-archive";
import { ARCHIVE_SCHEMA_VERSION } from "../archive-schema";
import { toDbMatch, toTeamMap, toHybridTeamMap, toGroupMatches, buildArchiveTeamTitles } from "./archive-mappers";
import { ArchiveRosterGrid } from "./archive-roster-grid";

function isValidArchive(value: unknown): value is TournamentArchive {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === ARCHIVE_SCHEMA_VERSION &&
    (v.kind === "tournament" || v.kind === "season") &&
    typeof v.meta === "object" && v.meta !== null &&
    Array.isArray(v.teams) &&
    Array.isArray(v.matches) &&
    Array.isArray(v.playerGameStats)
  );
}

function buildTabs(archive: TournamentArchive): SeasonTab[] {
  const format = archive.meta.formatPreset;
  const matches = archive.matches;
  const teamMap = toTeamMap(archive.teams);
  const hybridTeamMap = toHybridTeamMap(archive.teams);
  const teamTitles = buildArchiveTeamTitles(archive.teams);

  const isGroupSE           = format === "group_single_elimination";
  const isGroupSwissSE      = format === "group_swiss_single_elimination";
  const isGroupSwissHybrid  = format === "group_swiss_hybrid";
  const isGroupSwissHybrid8 = format === "group_swiss_hybrid_8";
  const isSESwissSE         = format === "se_swiss_single_elimination";
  const isDESwissSE         = format === "de_swiss_single_elimination";
  const hasGroupStage       = isGroupSE || isGroupSwissSE || isGroupSwissHybrid || isGroupSwissHybrid8;
  const hasSwissStage       = isGroupSwissSE || isSESwissSE || isDESwissSE || isGroupSwissHybrid || isGroupSwissHybrid8;

  const seMatches      = matches.filter((m) => m.stage === "single_elimination");
  const deMatches       = matches.filter((m) => m.stage === DE_WINNERS || m.stage === DE_LOSERS || m.stage === DE_GF);
  const swissMatches   = matches.filter((m) => m.stage === SWISS_STAGE);
  const hybridMatches  = matches.filter((m) => m.stage === HYBRID_UB || m.stage === HYBRID_LB || m.stage === HYBRID_SF || m.stage === HYBRID_GF);
  const hybrid8Matches = matches.filter((m) => m.stage === HYBRID8_UB || m.stage === HYBRID8_LB || m.stage === HYBRID8_SF || m.stage === HYBRID8_GF);
  const seqMatches     = matches.filter((m) => m.stage === SE_QUALIFIER);
  const deqMatches     = matches.filter((m) => m.stage === DE_QUALIFIER_WINNERS || m.stage === DE_QUALIFIER_LOSERS);
  const groupMatches   = matches.filter((m) => (m.stage ?? "").startsWith(GROUP_STAGE_PREFIX));

  const seExists      = seMatches.length > 0;
  const swissExists   = swissMatches.length > 0;
  const hybridExists  = isGroupSwissHybrid && hybridMatches.length > 0;
  const hybrid8Exists = isGroupSwissHybrid8 && hybrid8Matches.length > 0;
  const seqExists     = isSESwissSE && seqMatches.length > 0;
  const deqExists     = isDESwissSE && deqMatches.length > 0;

  const tabs: SeasonTab[] = [];

  const standingsRows: StandingsRow[] = archive.teams
    .map((t) => ({ id: t.id, name: t.name, logo_url: t.logoUrl, wins: t.wins, losses: t.losses, gp: t.wins + t.losses }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name));

  tabs.push({
    key: "standings",
    label: "Standings",
    content: <StandingsClient rows={standingsRows} />,
  });

  const showSE = format === "single_elimination" ||
    (isGroupSE && seExists) ||
    (isGroupSwissSE && seExists) ||
    (isSESwissSE && seExists) ||
    (isDESwissSE && seExists);

  if (showSE) {
    tabs.push({
      key: "bracket",
      label: "Bracket",
      content: <SEBracketDisplay matches={seMatches.map(toDbMatch)} teams={teamMap} />,
    });
  }

  if (format === "double_elimination" && deMatches.length > 0) {
    tabs.push({
      key: "bracket",
      label: "Bracket",
      content: <DEBracketDisplay matches={deMatches.map(toDbMatch)} teams={teamMap} />,
    });
  }

  if (hasSwissStage && swissExists) {
    tabs.push({
      key: "swiss",
      label: "Swiss",
      content: (
        <SwissBracketDisplay
          matches={swissMatches.map(toDbMatch)}
          teams={teamMap}
          teamTitles={teamTitles}
          isHybrid8={isGroupSwissHybrid8}
        />
      ),
    });
  }

  if (isGroupSwissHybrid && hybridExists) {
    tabs.push({
      key: "hybrid",
      label: "Hybrid",
      content: (
        <HybridBracketDisplay variant="12" matches={hybridMatches.map(toDbMatch)} teams={hybridTeamMap} teamTitles={teamTitles} />
      ),
    });
  }

  if (isGroupSwissHybrid8 && hybrid8Exists) {
    tabs.push({
      key: "hybrid",
      label: "Hybrid",
      content: (
        <HybridBracketDisplay variant="8" matches={hybrid8Matches.map(toDbMatch)} teams={hybridTeamMap} teamTitles={teamTitles} />
      ),
    });
  }

  if (isSESwissSE && seqExists) {
    tabs.push({
      key: "se-qualifier",
      label: "SE Qualifier",
      content: <SEBracketDisplay matches={seqMatches.map(toDbMatch)} teams={teamMap} />,
    });
  }

  if (isDESwissSE && deqExists) {
    tabs.push({
      key: "de-qualifier",
      label: "DE Qualifier",
      content: <DEQualifierBracketDisplay matches={deqMatches.map(toDbMatch)} teams={teamMap} />,
    });
  }

  if (hasGroupStage && groupMatches.length > 0) {
    const numTeams = archive.meta.teamCount;
    const numGroups = getNumGroups(numTeams);
    const seasonFormat = archive.meta.seasonFormat as { groupMaxAdvancing?: number | null } | null;
    let qualifiersPerGroup: number;
    if (isGroupSE) {
      const totalAdv = seasonFormat?.groupMaxAdvancing ?? Math.floor((numTeams * 3) / 4);
      qualifiersPerGroup = Math.max(1, Math.round(totalAdv / numGroups));
    } else if (isGroupSwissHybrid) {
      qualifiersPerGroup = 5;
    } else if (isGroupSwissHybrid8) {
      qualifiersPerGroup = 3;
    } else {
      qualifiersPerGroup = Math.floor(16 / numGroups);
    }
    const groupNums = [...new Set(groupMatches.map((m) => m.stage ?? "")
      .map((s) => Number(s.replace(GROUP_STAGE_PREFIX, "")))
      .filter((n) => !Number.isNaN(n)))].sort((a, b) => a - b);

    tabs.push({
      key: "groups",
      label: "Groups",
      content: (
        <GroupStageClient
          groupNums={groupNums}
          matches={toGroupMatches(groupMatches)}
          teams={teamMap}
          qualifiersPerGroup={qualifiersPerGroup}
          topDirectQualifiers={isGroupSwissHybrid || isGroupSwissHybrid8 ? 1 : qualifiersPerGroup}
          teamTitles={teamTitles}
        />
      ),
    });
  }

  tabs.push({
    key: "rosters",
    label: "Rosters",
    content: <ArchiveRosterGrid teams={archive.teams} />,
  });

  const statInputs: StatAggregationInput[] = archive.playerGameStats.map((s) => ({
    key: s.username,
    username: s.username,
    displayName: s.displayName,
    teamName: s.teamName,
    goals: s.goals, assists: s.assists, saves: s.saves, shots: s.shots, score: s.score,
    demos: s.demos ?? 0, demoed: s.demoed ?? 0,
  }));

  tabs.push({
    key: "stats",
    label: "Stats",
    content: <StatsTable rows={aggregatePlayerGameStats(statInputs)} />,
  });

  return tabs;
}

export function ArchiveViewerClient() {
  const [archive, setArchive] = useState<TournamentArchive | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!isValidArchive(parsed)) {
          setError("Unsupported or corrupted archive file.");
          setArchive(null);
          return;
        }
        setArchive(parsed);
      } catch {
        setError("Unsupported or corrupted archive file.");
        setArchive(null);
      }
    };
    reader.onerror = () => setError("Could not read the selected file.");
    reader.readAsText(file);
  }

  if (!archive) {
    return (
      <div className="space-y-3">
        <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors">
          Choose Archive File
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">{archive.meta.name}</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Archived view · {archive.meta.teamCount} teams · exported <LocalTime iso={archive.exportedAt} />
          </p>
        </div>
        <button
          onClick={() => { setArchive(null); setError(null); }}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
        >
          Load a different file
        </button>
      </div>

      <SeasonTabs tabs={buildTabs(archive)} defaultTab="standings" />
    </div>
  );
}
