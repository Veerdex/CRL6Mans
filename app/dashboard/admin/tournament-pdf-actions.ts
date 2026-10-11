"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import type { TournamentArchive } from "./tournament-archive";

export type PdfStanding = {
  place: number;
  name: string;
  wins: number;
  losses: number;
  logoUrl: string | null;
};

export type PdfMatch = {
  stage: string;
  round: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
};

export type PdfPlayer = { username: string; displayName: string | null };

export type TournamentPdfData = {
  name: string;
  format: string;
  teamCount: number;
  startedAt: string | null;
  endedAt: string | null;
  champion: string | null;
  championLogoUrl: string | null;
  championPlayers: PdfPlayer[];
  runnerUp: string | null;
  runnerUpLogoUrl: string | null;
  runnerUpPlayers: PdfPlayer[];
  standings: PdfStanding[];
  matches: PdfMatch[];
};

const PRESET_NAMES: Record<string, string> = {
  single_elimination: "Single Elimination",
  double_elimination: "Double Elimination",
  group_single_elimination: "Group → Single Elimination",
  group_swiss_single_elimination: "Group → Swiss → SE",
  se_swiss_single_elimination: "SE Qualifier → Swiss → SE",
  de_swiss_single_elimination: "DE Qualifier → Swiss → SE",
};

async function assertAdmin() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) redirect("/dashboard");
}

export type EventExport = {
  name: string;
  pdf: TournamentPdfData;
  /** Null for a purged event, and for one completed before archives existed. */
  archive: TournamentArchive | null;
};

/**
 * Everything the Export button hands over, from one row read.
 *
 * Both files are built here rather than by two separate actions, because the
 * PDF is assembled partly out of the archive — the report would otherwise lose
 * its match results the moment exporting moved to after completion, where the
 * live matches it used to read are already gone.
 *
 * `tournaments` and `seasons` carry the same column names for everything this
 * needs, so the two kinds share one path.
 */
export async function fetchEventExport(
  kind: "tournament" | "season",
  id: string,
): Promise<EventExport | null> {
  await assertAdmin();

  const table = kind === "season" ? "seasons" : "tournaments";
  const { data: row } = await supabaseAdmin
    .from(table)
    .select("name, season_format, started_at, ended_at, summary, full_archive")
    .eq("id", id)
    .single();

  if (!row) return null;

  const summary = row.summary as {
    champion?: string | null;
    runnerUp?: string | null;
    finalStandings?: { name: string; wins: number; losses: number }[];
    championLogoUrl?: string | null;
    runnerUpLogoUrl?: string | null;
    championPlayers?: PdfPlayer[];
    runnerUpPlayers?: PdfPlayer[];
    formatPreset?: string | null;
  } | null;
  const archive = (row.full_archive as TournamentArchive | null) ?? null;

  // Logos come from the archive, which snapshotted them at completion. Every
  // event ends with a reset that deletes the teams, so matching live rows by
  // name can hand an old event a later team's logo.
  const logoByName = new Map<string, string | null>(
    (archive?.teams ?? []).map((t) => [t.name, t.logoUrl]),
  );
  // Events completed before archives existed have no snapshot to read, so a
  // live name match is all there is for those.
  if (!archive) {
    const { data: liveTeams } = await supabaseAdmin.from("teams").select("name, logo_url");
    for (const t of liveTeams ?? []) {
      logoByName.set(t.name, (t.logo_url as string | null) ?? null);
    }
  }

  const standings: PdfStanding[] = (summary?.finalStandings ?? []).map((r, i) => ({
    place: i + 1,
    name: r.name,
    wins: r.wins,
    losses: r.losses,
    logoUrl: logoByName.get(r.name) ?? null,
  }));

  const teamNameById = new Map((archive?.teams ?? []).map((t) => [t.id, t.name]));
  const matches: PdfMatch[] = (archive?.matches ?? [])
    .filter(
      (m) =>
        m.status === "completed" &&
        m.homeTeamId !== null &&
        m.awayTeamId !== null &&
        m.homeScore !== null &&
        m.awayScore !== null,
    )
    .map((m) => ({
      stage: String(m.stage ?? ""),
      round: `Round ${m.round}`,
      home: teamNameById.get(m.homeTeamId as string) ?? "Unknown",
      away: teamNameById.get(m.awayTeamId as string) ?? "Unknown",
      homeScore: m.homeScore as number,
      awayScore: m.awayScore as number,
    }));

  const preset =
    (row.season_format as { preset?: string } | null)?.preset ??
    archive?.meta?.formatPreset ??
    summary?.formatPreset ??
    null;

  const champion = summary?.champion ?? null;
  const runnerUp = summary?.runnerUp ?? null;

  return {
    name: row.name,
    archive,
    pdf: {
      name: row.name,
      format: preset
        ? (PRESET_NAMES[preset] ?? preset)
        : kind === "season"
          ? "Season"
          : "Tournament",
      teamCount: standings.length,
      startedAt: row.started_at ?? null,
      endedAt: row.ended_at ?? null,
      champion,
      championLogoUrl: champion
        ? (logoByName.get(champion) ?? summary?.championLogoUrl ?? null)
        : null,
      championPlayers: summary?.championPlayers ?? [],
      runnerUp,
      runnerUpLogoUrl: runnerUp
        ? (logoByName.get(runnerUp) ?? summary?.runnerUpLogoUrl ?? null)
        : null,
      runnerUpPlayers: summary?.runnerUpPlayers ?? [],
      standings,
      matches,
    },
  };
}
