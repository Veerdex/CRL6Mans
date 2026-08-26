import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { FormatEditor, type SeasonFormatConfig } from "./format-editor";
import { SEBracketView, DEBracketView, DEQualifierBracketView, GroupBracketView } from "./bracket-view";
import { SwissBracketView } from "./swiss-view";
import { HybridBracketView } from "./hybrid-view";
import { SimulateControls } from "./simulate-controls";
import { StandingsClient, type StandingsRow } from "./standings-table";
import { SeasonTabs, type SeasonTab } from "./season-tabs";
import { getNumGroups, SWISS_STAGE, SWISS_ADVANCE_WINS, SWISS8_ADVANCE_WINS, SE_QUALIFIER, DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS, HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF, HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF } from "@/app/lib/bracket";

export default async function SeasonPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  const userIsAdmin = session?.userId ? await isDirectorVerified(session.userId) : false;
  const testingMode = userIsAdmin && cookieStore.get("testing_mode")?.value === "1";

  let myTeamId: string | null = null;
  if (session?.userId) {
    const { data: me } = await supabaseAdmin
      .from("players").select("team_id").eq("discord_id", session.userId).single();
    myTeamId = (me?.team_id as string | null) ?? null;
  }

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("season_format, season_participants, season_active, num_teams, active_tournament_id")
    .single();

  const format = (settings?.season_format as SeasonFormatConfig) ?? null;
  const participants = (settings?.season_participants as number) ?? 16;
  const seasonActive = settings?.season_active ?? false;
  const numTeams = (settings?.num_teams as number) ?? 0;
  const isTournament = !!settings?.active_tournament_id;

  const isGroupSE           = format?.preset === "group_single_elimination";
  const isGroupSwissSE      = format?.preset === "group_swiss_single_elimination";
  const isGroupSwissHybrid  = format?.preset === "group_swiss_hybrid";
  const isGroupSwissHybrid8 = format?.preset === "group_swiss_hybrid_8";
  const isSESwissSE         = format?.preset === "se_swiss_single_elimination";
  const isDESwissSE         = format?.preset === "de_swiss_single_elimination";
  const hasGroupStage       = isGroupSE || isGroupSwissSE || isGroupSwissHybrid || isGroupSwissHybrid8;
  const hasSwissStage       = isGroupSwissSE || isSESwissSE || isDESwissSE || isGroupSwissHybrid || isGroupSwissHybrid8;

  let groupsComplete     = false;
  let seExists           = false;
  let qualifiersPerGroup = 2;

  let swissExists        = false;
  let swissRoundComplete = false;
  let swissDone          = false;

  let seqExists   = false;
  let seqComplete = false;

  let deqExists   = false;
  let deqComplete = false;

  let hybridExists   = false;
  let hybridDone     = false;
  let hybrid8Exists  = false;
  let hybrid8Done    = false;

  let standingsRows: StandingsRow[] = [];

  if (seasonActive) {
    const [{ data: allTeams }, { data: completedMatches }, { data: bracketTeamRefs }] = await Promise.all([
      supabaseAdmin.from("teams").select("id, name, logo_url"),
      supabaseAdmin
        .from("matches")
        .select("home_team_id, away_team_id, home_score, away_score")
        .eq("status", "completed")
        .not("home_score", "is", null)
        .not("away_score", "is", null)
        .not("home_team_id", "is", null)
        .not("away_team_id", "is", null),
      supabaseAdmin.from("matches").select("home_team_id, away_team_id"),
    ]);

    // Teams that were cut at season start (over the format's max) have no matches,
    // so exclude any team that isn't referenced by the bracket from standings.
    const participatingIds = new Set<string>();
    for (const m of bracketTeamRefs ?? []) {
      if (m.home_team_id) participatingIds.add(m.home_team_id as string);
      if (m.away_team_id) participatingIds.add(m.away_team_id as string);
    }
    const seasonTeams = participatingIds.size
      ? (allTeams ?? []).filter((t) => participatingIds.has(t.id))
      : (allTeams ?? []);

    if (seasonTeams.length) {
      const records: Record<string, { wins: number; losses: number }> = {};
      for (const m of completedMatches ?? []) {
        if (!m.home_team_id || !m.away_team_id) continue;
        if (!records[m.home_team_id]) records[m.home_team_id] = { wins: 0, losses: 0 };
        if (!records[m.away_team_id]) records[m.away_team_id] = { wins: 0, losses: 0 };
        if ((m.home_score ?? 0) > (m.away_score ?? 0)) {
          records[m.home_team_id].wins++;
          records[m.away_team_id].losses++;
        } else {
          records[m.away_team_id].wins++;
          records[m.home_team_id].losses++;
        }
      }
      standingsRows = seasonTeams
        .map((t) => ({
          id: t.id,
          name: t.name,
          logo_url: (t as { logo_url?: string | null }).logo_url ?? null,
          wins: records[t.id]?.wins ?? 0,
          losses: records[t.id]?.losses ?? 0,
          gp: (records[t.id]?.wins ?? 0) + (records[t.id]?.losses ?? 0),
        }))
        .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name));
    }

    // "Exists" means a real pairing has been filled in — not merely that a placeholder
    // row was pre-created (rows are scaffolded the moment their stage's size is known,
    // long before real teams are assigned).
    const { count: seCount } = await supabaseAdmin
      .from("matches").select("*", { count: "exact", head: true })
      .eq("stage", "single_elimination").not("home_team_id", "is", null);
    seExists = (seCount ?? 0) > 0;

    if (isGroupSwissHybrid) {
      const { count: hybridCount } = await supabaseAdmin
        .from("matches").select("*", { count: "exact", head: true })
        .in("stage", [HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF])
        .not("home_team_id", "is", null);
      hybridExists = (hybridCount ?? 0) > 0;

      if (hybridExists) {
        const { count: hybridPending } = await supabaseAdmin
          .from("matches").select("*", { count: "exact", head: true })
          .in("stage", [HYBRID_UB, HYBRID_LB, HYBRID_SF, HYBRID_GF])
          .not("home_team_id", "is", null)
          .neq("status", "completed");
        hybridDone = (hybridPending ?? 1) === 0;
      }
    }

    if (isGroupSwissHybrid8) {
      const { count: h8Count } = await supabaseAdmin
        .from("matches").select("*", { count: "exact", head: true })
        .in("stage", [HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF])
        .not("home_team_id", "is", null);
      hybrid8Exists = (h8Count ?? 0) > 0;

      if (hybrid8Exists) {
        const { count: h8Pending } = await supabaseAdmin
          .from("matches").select("*", { count: "exact", head: true })
          .in("stage", [HYBRID8_UB, HYBRID8_LB, HYBRID8_SF, HYBRID8_GF])
          .not("home_team_id", "is", null)
          .neq("status", "completed");
        hybrid8Done = (h8Pending ?? 1) === 0;
      }
    }

    if (hasGroupStage && numTeams > 0) {
      const numGroups = getNumGroups(numTeams);
      if (isGroupSE) {
        const totalAdv = format?.groupMaxAdvancing ?? Math.floor((numTeams * 3) / 4);
        qualifiersPerGroup = Math.max(1, Math.round(totalAdv / numGroups));
      } else if (isGroupSwissHybrid) {
        qualifiersPerGroup = 5; // 1st → UB, 2nd-5th → Swiss
      } else if (isGroupSwissHybrid8) {
        qualifiersPerGroup = 3; // 1st → UB, 2nd-3rd → Swiss
      } else {
        qualifiersPerGroup = Math.floor(16 / numGroups);
      }
      const { count: pendingGroup } = await supabaseAdmin
        .from("matches").select("*", { count: "exact", head: true })
        .like("stage", "group_%").neq("status", "completed");
      groupsComplete = (pendingGroup ?? 1) === 0;
    }

    if (isSESwissSE) {
      const { data: seqMatches } = await supabaseAdmin
        .from("matches").select("round, status")
        .eq("stage", SE_QUALIFIER);
      seqExists   = (seqMatches?.length ?? 0) > 0;
      seqComplete = seqExists && (seqMatches?.every(m => m.status === "completed") ?? false);
    }

    if (isDESwissSE) {
      const { data: deqMatches } = await supabaseAdmin
        .from("matches").select("round, status")
        .in("stage", [DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS]);
      deqExists   = (deqMatches?.length ?? 0) > 0;
      deqComplete = deqExists && (deqMatches?.every(m => m.status === "completed") ?? false);
    }

    if (hasSwissStage) {
      const { data: swissMatches } = await supabaseAdmin
        .from("matches")
        .select("round, home_team_id, away_team_id, home_score, away_score, status")
        .eq("stage", SWISS_STAGE)
        .not("home_team_id", "is", null);

      swissExists = (swissMatches?.length ?? 0) > 0;

      if (swissExists && swissMatches) {
        const currentRound = Math.max(...swissMatches.map(m => m.round));
        swissRoundComplete = swissMatches.filter(m => m.round === currentRound && m.status !== "completed").length === 0;

        const teamIds = [...new Set(swissMatches.flatMap(m =>
          [m.home_team_id, m.away_team_id].filter(Boolean) as string[]
        ))];
        const swissAdvanceWins = isGroupSwissHybrid8 ? SWISS8_ADVANCE_WINS : SWISS_ADVANCE_WINS;
        const advancedCount = teamIds.filter(id =>
          swissMatches.filter(m => m.status === "completed" && (m.home_team_id === id || m.away_team_id === id))
            .reduce((wins, m) => {
              const homeWon = (m.home_score ?? 0) > (m.away_score ?? 0);
              return wins + ((m.home_team_id === id && homeWon) || (m.away_team_id === id && !homeWon) ? 1 : 0);
            }, 0) >= swissAdvanceWins
        ).length;
        swissDone = advancedCount >= (isGroupSwissHybrid8 ? 4 : 8);
      }
    }
  }

  // Build tabs
  const tabs: SeasonTab[] = [];

  if (seasonActive) {
    tabs.push({
      key: "standings",
      label: "Standings",
      content: <StandingsClient rows={standingsRows} highlightTeamId={myTeamId} />,
    });

    // Bracket tab — SE or DE
    const showSE = format?.preset === "single_elimination" ||
      (isGroupSE && seExists) ||
      (isGroupSwissSE && seExists) ||
      (isSESwissSE && seExists) ||
      (isDESwissSE && seExists);

    if (showSE) {
      tabs.push({
        key: "bracket",
        label: "Bracket",
        content: (
          <div className="space-y-4">
            {userIsAdmin && (
              <div className="flex justify-end">
                <SimulateControls testingMode={testingMode} />
              </div>
            )}
            <SEBracketView />
          </div>
        ),
      });
    }

    if (format?.preset === "double_elimination") {
      tabs.push({
        key: "bracket",
        label: "Bracket",
        content: (
          <div className="space-y-4">
            {userIsAdmin && (
              <div className="flex justify-end">
                <SimulateControls testingMode={testingMode} />
              </div>
            )}
            <DEBracketView />
          </div>
        ),
      });
    }

    if (hasSwissStage && swissExists) {
      tabs.push({
        key: "swiss",
        label: "Swiss",
        content: (
          <div className="space-y-4">
            {userIsAdmin && (
              <div className="flex justify-end">
                <SimulateControls
                  testingMode={testingMode}
                  showNextSwissRound={swissRoundComplete && !swissDone && !seExists && !hybridExists && !hybrid8Exists}
                  showSwissToSE={swissDone && !seExists && !isGroupSwissHybrid && !isGroupSwissHybrid8}
                  showSwissToHybrid={isGroupSwissHybrid && swissDone && !hybridExists}
                  showSwissToHybrid8={isGroupSwissHybrid8 && swissDone && !hybrid8Exists}
                />
              </div>
            )}
            <SwissBracketView />
          </div>
        ),
      });
    }

    if (isGroupSwissHybrid && hybridExists) {
      tabs.push({
        key: "hybrid",
        label: "Hybrid",
        content: (
          <div className="space-y-4">
            {userIsAdmin && (
              <div className="flex justify-end">
                <SimulateControls testingMode={testingMode} />
              </div>
            )}
            <HybridBracketView />
          </div>
        ),
      });
    }

    if (isGroupSwissHybrid8 && hybrid8Exists) {
      tabs.push({
        key: "hybrid",
        label: "Hybrid",
        content: (
          <div className="space-y-4">
            {userIsAdmin && (
              <div className="flex justify-end">
                <SimulateControls testingMode={testingMode} />
              </div>
            )}
            <HybridBracketView variant="8" />
          </div>
        ),
      });
    }

    if (isSESwissSE && seqExists) {
      tabs.push({
        key: "se-qualifier",
        label: "SE Qualifier",
        content: (
          <div className="space-y-4">
            {userIsAdmin && (
              <div className="flex justify-end">
                <SimulateControls testingMode={testingMode} showAdvanceSEToSwiss={seqComplete && !swissExists} />
              </div>
            )}
            <SEBracketView stage="se_qualifier" />
          </div>
        ),
      });
    }

    if (isDESwissSE && deqExists) {
      tabs.push({
        key: "de-qualifier",
        label: "DE Qualifier",
        content: (
          <div className="space-y-4">
            {userIsAdmin && (
              <div className="flex justify-end">
                <SimulateControls testingMode={testingMode} showAdvanceDEToSwiss={deqComplete && !swissExists} />
              </div>
            )}
            <DEQualifierBracketView />
          </div>
        ),
      });
    }

    if (hasGroupStage) {
      tabs.push({
        key: "groups",
        label: "Groups",
        content: (
          <div className="space-y-4">
            {userIsAdmin && (
              <div className="flex justify-end">
                <SimulateControls
                  testingMode={testingMode}
                  showAdvanceToSE={isGroupSE && groupsComplete && !seExists}
                  showAdvanceToSwiss={isGroupSwissSE && groupsComplete && !swissExists}
                  showAdvanceToSwissHybrid={isGroupSwissHybrid && groupsComplete && !swissExists}
                  showAdvanceToSwissHybrid8={isGroupSwissHybrid8 && groupsComplete && !swissExists}
                />
              </div>
            )}
            <GroupBracketView
                qualifiersPerGroup={qualifiersPerGroup}
                topDirectQualifiers={isGroupSwissHybrid || isGroupSwissHybrid8 ? 1 : qualifiersPerGroup}
              />
          </div>
        ),
      });
    }
  }

  tabs.push({
    key: "format",
    label: "Format",
    content: (
      <FormatEditor
        initialFormat={format}
        initialParticipants={participants}
        isAdmin={false}
      />
    ),
  });

  // Default to the most current active stage
  const defaultTab = seasonActive ? "standings" : "format";

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{isTournament ? "Tournament" : "Season"}</h1>
        {seasonActive && (
          <span className="inline-flex items-center gap-1.5 mt-1 text-xs font-medium text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            {isTournament ? "Tournament in progress" : "Season in progress"}
          </span>
        )}
      </div>

      <SeasonTabs tabs={tabs} defaultTab={defaultTab} />
    </div>
  );
}

