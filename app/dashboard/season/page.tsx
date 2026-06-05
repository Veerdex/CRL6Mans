import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isAdmin } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { FormatEditor, type SeasonFormatConfig } from "./format-editor";
import { SEBracketView, DEBracketView, DEQualifierBracketView, GroupBracketView } from "./bracket-view";
import { SwissBracketView } from "./swiss-view";
import { SimulateControls } from "./simulate-controls";
import { CollapsibleStage } from "./collapsible-stage";
import { StandingsTable } from "./standings-table";
import { getNumGroups, SWISS_STAGE, SWISS_ADVANCE_WINS, SE_QUALIFIER, DE_QUALIFIER_WINNERS, DE_QUALIFIER_LOSERS } from "@/app/lib/bracket";

export default async function SeasonPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  const userIsAdmin = session?.userId ? isAdmin(session.userId) : false;

  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("season_format, season_participants, season_active, num_teams")
    .single();

  const format = (settings?.season_format as SeasonFormatConfig) ?? null;
  const participants = (settings?.season_participants as number) ?? 16;
  const seasonActive = settings?.season_active ?? false;
  const numTeams = (settings?.num_teams as number) ?? 0;

  const isGroupSE      = format?.preset === "group_single_elimination";
  const isGroupSwissSE = format?.preset === "group_swiss_single_elimination";
  const isSESwissSE    = format?.preset === "se_swiss_single_elimination";
  const isDESwissSE    = format?.preset === "de_swiss_single_elimination";
  const hasGroupStage  = isGroupSE || isGroupSwissSE;
  const hasSwissStage  = isGroupSwissSE || isSESwissSE || isDESwissSE;

  let groupsComplete     = false;
  let seExists           = false;
  let qualifiersPerGroup = 2;

  // Swiss state (shared by group→swiss→SE and SE→swiss→SE)
  let swissExists        = false;
  let swissRoundComplete = false;
  let swissDone          = false;

  // SE qualifier state (SE→swiss→SE only)
  let seqExists   = false;
  let seqComplete = false;

  // DE qualifier state (DE→swiss→SE only)
  let deqExists   = false;
  let deqComplete = false;

  if (seasonActive) {
    const { count: seCount } = await supabaseAdmin
      .from("matches").select("*", { count: "exact", head: true })
      .eq("stage", "single_elimination").then(r => r);
    seExists = (seCount ?? 0) > 0;

    if (hasGroupStage && numTeams > 0) {
      const numGroups = getNumGroups(numTeams);
      if (isGroupSE) {
        const totalAdv = format?.groupMaxAdvancing ?? Math.floor((numTeams * 3) / 4);
        qualifiersPerGroup = Math.max(1, Math.round(totalAdv / numGroups));
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
        .eq("stage", SWISS_STAGE);

      swissExists = (swissMatches?.length ?? 0) > 0;

      if (swissExists && swissMatches) {
        const currentRound = Math.max(...swissMatches.map(m => m.round));
        swissRoundComplete = swissMatches.filter(m => m.round === currentRound && m.status !== "completed").length === 0;

        const teamIds = [...new Set(swissMatches.flatMap(m =>
          [m.home_team_id, m.away_team_id].filter(Boolean) as string[]
        ))];
        const advancedCount = teamIds.filter(id =>
          swissMatches.filter(m => m.status === "completed" && (m.home_team_id === id || m.away_team_id === id))
            .reduce((wins, m) => {
              const homeWon = (m.home_score ?? 0) > (m.away_score ?? 0);
              return wins + ((m.home_team_id === id && homeWon) || (m.away_team_id === id && !homeWon) ? 1 : 0);
            }, 0) >= SWISS_ADVANCE_WINS
        ).length;
        swissDone = advancedCount >= 8;
      }
    }
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Season</h1>
        {seasonActive && (
          <span className="inline-flex items-center gap-1.5 mt-1 text-xs font-medium text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Season in progress
          </span>
        )}
      </div>

      {/* Standings */}
      {seasonActive && (
        <section>
          <h2 className="text-sm font-medium text-zinc-400 mb-3">Standings</h2>
          <StandingsTable />
        </section>
      )}

      {/* Bracket */}
      {seasonActive && (
        <section className="space-y-8">

          {/* Final SE — shown first (most current stage) */}
          {(format?.preset === "single_elimination" ||
            (isGroupSE && seExists) ||
            (isGroupSwissSE && seExists) ||
            (isSESwissSE && seExists) ||
            (isDESwissSE && seExists)) && (
            <CollapsibleStage
              title={format?.preset === "single_elimination" ? "Bracket" : "Single Elimination"}
              controls={userIsAdmin ? <SimulateControls /> : undefined}
            >
              <SEBracketView />
            </CollapsibleStage>
          )}

          {/* DE bracket */}
          {format?.preset === "double_elimination" && (
            <CollapsibleStage
              title="Bracket"
              controls={userIsAdmin ? <SimulateControls /> : undefined}
            >
              <DEBracketView />
            </CollapsibleStage>
          )}

          {/* Swiss stage */}
          {hasSwissStage && swissExists && (
            <CollapsibleStage
              title="Swiss Stage"
              controls={userIsAdmin ? (
                <SimulateControls
                  showNextSwissRound={swissRoundComplete && !swissDone && !seExists}
                  showSwissToSE={swissDone && !seExists}
                />
              ) : undefined}
            >
              <SwissBracketView />
            </CollapsibleStage>
          )}

          {/* SE Qualifier — shown after Swiss (earliest stage in SE→Swiss→SE) */}
          {isSESwissSE && seqExists && (
            <CollapsibleStage
              title="SE Qualifier"
              controls={userIsAdmin ? (
                <SimulateControls
                  showAdvanceSEToSwiss={seqComplete && !swissExists}
                />
              ) : undefined}
            >
              <SEBracketView stage="se_qualifier" />
            </CollapsibleStage>
          )}

          {/* DE Qualifier — shown after Swiss (earliest stage in DE→Swiss→SE) */}
          {isDESwissSE && deqExists && (
            <CollapsibleStage
              title="DE Qualifier"
              controls={userIsAdmin ? (
                <SimulateControls
                  showAdvanceDEToSwiss={deqComplete && !swissExists}
                />
              ) : undefined}
            >
              <DEQualifierBracketView />
            </CollapsibleStage>
          )}

          {/* Group stage — always shown last (earliest stage in group formats) */}
          {hasGroupStage && (
            <CollapsibleStage
              title="Group Stage"
              controls={userIsAdmin ? (
                <SimulateControls
                  showAdvanceToSE={isGroupSE && groupsComplete && !seExists}
                  showAdvanceToSwiss={isGroupSwissSE && groupsComplete && !swissExists}
                />
              ) : undefined}
            >
              <GroupBracketView qualifiersPerGroup={qualifiersPerGroup} />
            </CollapsibleStage>
          )}

          {!hasGroupStage && !isSESwissSE && !isDESwissSE &&
            format?.preset !== "single_elimination" &&
            format?.preset !== "double_elimination" && (
            <p className="text-zinc-500 text-sm">Bracket view for this format is not yet implemented.</p>
          )}

        </section>
      )}

      {/* Format summary */}
      <section>
        <h2 className="text-sm font-medium text-zinc-400 mb-4">Format</h2>
        <FormatEditor
          initialFormat={format}
          initialParticipants={participants}
          isAdmin={false}
        />
      </section>
    </div>
  );
}
