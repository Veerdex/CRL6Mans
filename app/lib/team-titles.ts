// Pure — no server dependencies, safe to import anywhere (live bracket fetch
// wrappers and the client-side archive viewer both call this).

import { playerRatingFromRow } from "./rating";

export type TeamTitlePlayer = {
  team_id: string | null;
  display_name: string | null;
  username: string;
  peak_2v2: string | null;
  current_2v2: string | null;
  peak_3v3: string | null;
  current_3v3: string | null;
  peak_1v1?: string | null;
  current_1v1?: string | null;
};

// Builds the "Name (rating)\nName (rating)..." hover-tooltip text per team,
// roster sorted by rating descending — the exact tooltip bracket views show
// on a team name.
export function buildTeamTitles(players: TeamTitlePlayer[]): Record<string, string> {
  const ratingOf = (p: TeamTitlePlayer) => Math.round(playerRatingFromRow(p));

  const byTeam = new Map<string, TeamTitlePlayer[]>();
  for (const p of players) {
    if (!p.team_id) continue;
    const list = byTeam.get(p.team_id);
    if (list) list.push(p);
    else byTeam.set(p.team_id, [p]);
  }

  const titles: Record<string, string> = {};
  for (const [tid, roster] of byTeam) {
    titles[tid] = roster
      .sort((a, b) => ratingOf(b) - ratingOf(a))
      .map((p) => `${p.display_name ?? p.username} (${ratingOf(p)})`)
      .join("\n");
  }
  return titles;
}
