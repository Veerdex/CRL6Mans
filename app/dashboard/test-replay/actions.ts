"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { isModeratorVerified } from "@/app/lib/players";
import { parseReplay } from "@/app/lib/replay-parser";
import { supabaseAdmin } from "@/app/lib/supabase";
import { resolveTrackerName, normalizeName } from "@/app/lib/tracker-name";
import { fetchGlobalVerifiedAccounts } from "@/app/lib/replay-identity-context";
import { resolveReplayParticipants } from "@/app/lib/replay-identity-resolver";

export type MatchSource = "tracker" | "username" | "display";

export type PlayerMatchInfo = {
  replayName: string;
  normalizedKey: string;
  replayTeam: number;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  discordUsername: string | null;
  teamId: string | null;
  teamName: string | null;
  matchSource: MatchSource | null;
};

export type TrackerDirectoryEntry = {
  username: string;
  trackerName: string | null;
  normalizedKey: string | null;
};

export type ReplayAnalysis = {
  team0Score: number;
  team1Score: number;
  date: string | null;
  mapName: string | null;
  players: PlayerMatchInfo[];
  badReplay: boolean;
  unmatchedNames: string[];
  directory: TrackerDirectoryEntry[];
  _rawProps?: Record<string, unknown>;
};

export async function analyzeReplayFile(
  formData: FormData,
): Promise<{ data?: ReplayAnalysis; error?: string }> {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isModeratorVerified(session.userId))) redirect("/dashboard");

  const file = formData.get("replay") as File | null;
  if (!file) return { error: "No file provided." };
  if (!file.name.toLowerCase().endsWith(".replay"))
    return { error: "File must be a Rocket League .replay file." };
  if (file.size > 5 * 1024 * 1024)
    return { error: "File too large (max 5 MB)." };

  let replayData;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    replayData = parseReplay(buf, true);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to parse replay." };
  }

  const [{ data: allPlayers }, { data: allTeams }] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select("username, display_name, tracker_url, team_id")
      .eq("status", "approved"),
    supabaseAdmin.from("teams").select("id, name"),
  ]);

  const teamNameById: Record<string, string> = {};
  for (const t of allTeams ?? []) {
    teamNameById[t.id] = t.name;
  }

  // Build a normalized key → player map. Tracker names win; Discord username and
  // display name are added as fallbacks so a replay can still be matched when a
  // player's in-game name matches their Discord identity but not their tracker.
  type Entry = { username: string; teamId: string | null; source: MatchSource };
  const keyMap = new Map<string, Entry>();
  const directory: TrackerDirectoryEntry[] = [];

  // Resolve tracker names (may hit the network for Steam) in parallel.
  const resolved = await Promise.all(
    (allPlayers ?? []).map(async (p) => ({
      ...p,
      trackerName: p.tracker_url ? await resolveTrackerName(p.tracker_url) : null,
    })),
  );

  const addKey = (name: string | null | undefined, entry: Entry) => {
    if (!name) return;
    const key = normalizeName(name);
    if (!key) return;
    // Don't let a weaker source (username/display) overwrite a tracker match.
    const existing = keyMap.get(key);
    if (existing && existing.source === "tracker" && entry.source !== "tracker") return;
    keyMap.set(key, entry);
  };

  // Pass 1: tracker names (highest priority).
  for (const p of resolved) {
    addKey(p.trackerName, { username: p.username, teamId: p.team_id ?? null, source: "tracker" });
    if (p.tracker_url) {
      directory.push({
        username: p.username,
        trackerName: p.trackerName,
        normalizedKey: p.trackerName ? normalizeName(p.trackerName) : null,
      });
    }
  }
  // Pass 2: Discord username + display name fallbacks.
  for (const p of resolved) {
    addKey(p.username, { username: p.username, teamId: p.team_id ?? null, source: "username" });
    addKey(p.display_name, { username: p.username, teamId: p.team_id ?? null, source: "display" });
  }

  const unmatchedNames: string[] = [];
  const players: PlayerMatchInfo[] = replayData.players.map((p) => {
    const key = normalizeName(p.name);
    const match = keyMap.get(key);
    if (!match) unmatchedNames.push(p.name);
    return {
      replayName: p.name,
      normalizedKey: key,
      replayTeam: p.team,
      score: p.score,
      goals: p.goals,
      assists: p.assists,
      saves: p.saves,
      shots: p.shots,
      discordUsername: match?.username ?? null,
      teamId: match?.teamId ?? null,
      teamName: match?.teamId ? (teamNameById[match.teamId] ?? null) : null,
      matchSource: match?.source ?? null,
    };
  });

  // Shadow-mode identity resolution (Step 6): this tool has no matchId, so it
  // can only report global platform-account ownership, never eligibility —
  // there is no expected lineup or kickoff time to check accounts against.
  try {
    const activePlayers = replayData.players.filter(p => p.score > 0);
    const globalVerifiedAccounts = await fetchGlobalVerifiedAccounts(activePlayers);
    const resolution = resolveReplayParticipants({
      replayPlayers: activePlayers,
      expectedLineup: null,
      currentlyEligiblePlayerIds: new Set(),
      kickoffAt: null,
      globalVerifiedAccounts,
    });
    // "unexpected-account" will fire for nearly every player until verification
    // rolls out league-wide, so it's not useful signal yet — only log the
    // genuinely surprising case: the same verified account claimed twice.
    const flagged = resolution.players.filter(p => p.type === "duplicate-player");
    if (flagged.length) {
      console.warn("[identity-resolver][shadow] test-replay:", JSON.stringify(flagged));
    }
  } catch (err) {
    console.error("[identity-resolver][shadow] failed for test-replay:", err);
  }

  return {
    data: {
      team0Score: replayData.team0Score,
      team1Score: replayData.team1Score,
      date: replayData.date,
      mapName: replayData.mapName,
      players,
      badReplay: unmatchedNames.length > 0,
      unmatchedNames,
      directory: directory.sort((a, b) => a.username.localeCompare(b.username)),
      _rawProps: replayData._rawProps,
    },
  };
}
