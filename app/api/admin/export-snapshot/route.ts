import { cookies } from "next/headers";
import { decrypt } from "@/app/lib/session";
import { isDirectorVerified } from "@/app/lib/players";
import { supabaseAdmin } from "@/app/lib/supabase";
import { fetchAllRows } from "@/app/lib/paginate";
import JSZip from "jszip";

// On-demand backup of every live event table, independent of the
// completeTournament()/completeSeason() archive path — that one only runs
// once, right before resetSeason() wipes the tables it snapshots. This route
// can be hit anytime mid-draft/mid-season without touching or resetting
// anything.
const TABLES = [
  "players",
  "teams",
  "tournaments",
  "matches",
  "player_game_stats",
  "sub_requests",
  "tournament_entries",
  "team_signups",
  "team_signup_members",
] as const;

type Row = Record<string, unknown>;

async function fetchTable(table: (typeof TABLES)[number]): Promise<Row[]> {
  return fetchAllRows((from, to) =>
    supabaseAdmin.from(table).select("*").order("id").range(from, to)
  );
}

async function fetchAllTables(): Promise<Record<string, Row[]>> {
  const [tableResults, leagueSettings] = await Promise.all([
    Promise.all(TABLES.map(fetchTable)),
    supabaseAdmin.from("league_settings").select("*").single(),
  ]);

  const tables: Record<string, Row[]> = {};
  TABLES.forEach((name, i) => { tables[name] = tableResults[i]; });
  tables.league_settings = leagueSettings.data ? [leagueSettings.data] : [];
  return tables;
}

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const columns = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((k) => set.add(k));
    return set;
  }, new Set<string>()));

  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => escape(row[c])).join(","));
  return lines.join("\r\n");
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId || !(await isDirectorVerified(session.userId))) {
    return new Response("Forbidden", { status: 403 });
  }

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const tables = await fetchAllTables();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  if (format === "csv") {
    const zip = new JSZip();
    const folder = zip.folder(`crl6mans-snapshot-${stamp}`)!;
    for (const [name, rows] of Object.entries(tables)) {
      folder.file(`${name}.csv`, toCsv(rows));
    }
    const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });
    return new Response(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="crl6mans-snapshot-${stamp}.zip"`,
      },
    });
  }

  const body = JSON.stringify({ exportedAt: new Date().toISOString(), tables });
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="crl6mans-snapshot-${stamp}.json"`,
    },
  });
}
