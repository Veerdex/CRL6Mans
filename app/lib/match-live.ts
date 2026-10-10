// Pure leaf — no Supabase import, so the client-side archive viewer can pull it in
// through the display components. The server-side fetch lives in match-live-server.ts,
// the same split as bracket.ts / bracket-server.ts.

export type LiveMatch = {
  status: string;
  home_score: number | null;
  away_score: number | null;
  started_at?: string | null;
};

// A match is live from the moment both teams have checked in until a score exists.
// Scores are what end it — started_at is never cleared — so a reported result, a
// forfeit from an expired check-in window and an admin-entered score all drop it
// out of this on their own. Archive rows carry no started_at and so are never live.
export function isMatchLive(m: LiveMatch): boolean {
  return !!m.started_at && m.status === "scheduled" && m.home_score === null && m.away_score === null;
}

// m:ss, or h:mm:ss once it has been going an hour. A viewer's clock can sit behind
// the server's, so a just-started match would otherwise count down from -0:03.
export function formatElapsed(startedAt: string, now: number): string {
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
