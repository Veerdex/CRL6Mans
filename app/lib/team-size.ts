import { supabaseAdmin } from "@/app/lib/supabase";

export const DEFAULT_TEAM_SIZE = 3;

// Seasons never author a team size, and neither did any tournament created
// before the column existed, so anything missing or out of range is the classic
// 3v3 league. Every call site goes through here rather than spelling `?? 3`
// locally — the same discipline playerRatingFromRow enforces for ratings.
export function normalizeTeamSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : DEFAULT_TEAM_SIZE;
}

// The size the live runtime is configured for. activateTournamentRuntime
// mirrors the active tournament's value in; tournament teardown resets it, so a
// 1v1 tournament can't leave the next season drafting one player per team.
export async function resolveTeamSize(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("league_settings")
    .select("team_size")
    .maybeSingle();
  return normalizeTeamSize(data?.team_size);
}

export function teamSizeLabel(teamSize: number): string {
  return `${teamSize}v${teamSize}`;
}
