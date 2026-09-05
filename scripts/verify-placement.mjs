// Checks computePlacementTiers against hand-built brackets of every shape the
// season formats can produce.
//
//   node scripts/verify-placement.mjs
//
// Placement is derived from match rows alone, and the properties that matter are
// ones code review reads straight past: that a first-round bye isn't an exit,
// that a winners'-bracket loss is a dropdown rather than an elimination, that a
// grand-final bracket reset doesn't rank the loser above the champion, and that
// teams the format never played a match to separate stay tied. There is no live
// event to check against — the matches table is empty until a season finishes —
// so these fixtures are the only thing that says the algorithm generalises.
//
// The modules under test are TypeScript, so they're compiled to a temp dir
// first; nothing here touches the database.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "crl-placement-"));
// Run tsc's entrypoint through node directly rather than the npx shim: Node
// refuses to spawn a .cmd without a shell on Windows.
execFileSync(
  process.execPath,
  [path.join("node_modules", "typescript", "bin", "tsc"),
   "app/lib/placement.ts", "app/lib/career-points.ts",
   "--outDir", outDir, "--module", "esnext", "--target", "es2022",
   "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: "inherit" },
);
fs.writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}');
// tsc keeps extensionless specifiers under --moduleResolution bundler; Node's
// ESM loader needs the .js.
const emitted = path.join(outDir, "placement.js");
fs.writeFileSync(emitted, fs.readFileSync(emitted, "utf8").replace(/from "\.\/bracket"/g, 'from "./bracket.js"'));

const { computePlacementTiers, placementsFromTiers } = await import(pathToFileURL(emitted).href);
const { eventPoints, formatPlacement, prizePoolTotal } = await import(
  pathToFileURL(path.join(outDir, "career-points.js")).href
);

let failures = 0;

// m(stage, round, matchNumber, winner, loser) — winner listed home.
const m = (stage, round, mn, w, l, status = "completed") => ({
  stage, round, match_number: mn,
  home_team_id: w, away_team_id: l,
  home_score: w === null || l === null ? null : 3,
  away_score: w === null || l === null ? null : 1,
  status,
});
const bye = (stage, round, mn, t) => ({
  stage, round, match_number: mn,
  home_team_id: t, away_team_id: null,
  home_score: 1, away_score: 0, status: "completed",
});
const pending = (stage, round, mn) => ({
  stage, round, match_number: mn,
  home_team_id: null, away_team_id: null,
  home_score: null, away_score: null, status: "pending",
});

function check(name, matches, teams, expected) {
  const tiers = computePlacementTiers(matches, teams);
  const got = tiers.map((t) => [...t].sort().join(","));
  const want = expected.map((t) => [...t].sort().join(","));
  const ok = got.length === want.length && got.every((g, i) => g === want[i]);
  if (!ok) {
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`  got   ${JSON.stringify(got)}`);
    console.log(`  want  ${JSON.stringify(want)}`);
    return;
  }
  const placements = placementsFromTiers(tiers);
  const rendered = tiers
    .map((t) => {
      const p = placements.get(t[0]);
      return `${formatPlacement(p.placement, p.tierSize)}=${t.join("/")}`;
    })
    .join("  ");
  console.log(`ok    ${name}\n        ${rendered}`);
}

// ---- 1. Single elimination, 8 teams, higher seed always wins ----------------
{
  const SE = "single_elimination";
  const ms = [
    m(SE, 1, 1, "T1", "T8"), m(SE, 1, 2, "T4", "T5"),
    m(SE, 1, 3, "T2", "T7"), m(SE, 1, 4, "T3", "T6"),
    m(SE, 2, 1, "T1", "T4"), m(SE, 2, 2, "T2", "T3"),
    m(SE, 3, 1, "T1", "T2"),
  ];
  check("SE-8", ms, ["T1","T2","T3","T4","T5","T6","T7","T8"], [
    ["T1"], ["T2"], ["T4","T3"], ["T8","T5","T7","T6"],
  ]);
}

// ---- 2. Single elimination with first-round byes ----------------------------
// A bye must not read as an elimination for the team that received it.
{
  const SE = "single_elimination";
  const ms = [
    bye(SE, 1, 1, "T1"), m(SE, 1, 2, "T4", "T5"),
    bye(SE, 1, 3, "T2"), m(SE, 1, 4, "T3", "T6"),
    m(SE, 2, 1, "T1", "T4"), m(SE, 2, 2, "T2", "T3"),
    m(SE, 3, 1, "T1", "T2"),
  ];
  check("SE-6-with-byes", ms, ["T1","T2","T3","T4","T5","T6"], [
    ["T1"], ["T2"], ["T4","T3"], ["T5","T6"],
  ]);
}

// ---- 3. Double elimination, 8 teams ----------------------------------------
// Every team's real exit is its second loss, i.e. its LB elimination.
{
  const W = "de_winners", L = "de_losers", G = "de_grand_final";
  const ms = [
    m(W, 1, 1, "T1", "T8"), m(W, 1, 2, "T4", "T5"),
    m(W, 1, 3, "T2", "T7"), m(W, 1, 4, "T3", "T6"),
    m(W, 2, 1, "T1", "T4"), m(W, 2, 2, "T2", "T3"),
    m(W, 3, 1, "T1", "T2"),
    m(L, 1, 1, "T5", "T8"), m(L, 1, 2, "T6", "T7"),
    m(L, 2, 1, "T4", "T5"), m(L, 2, 2, "T3", "T6"),
    m(L, 3, 1, "T3", "T4"),
    m(L, 4, 1, "T2", "T3"),
    m(G, 1, 1, "T1", "T2"),
    pending(G, 1, 2),
  ];
  check("DE-8", ms, ["T1","T2","T3","T4","T5","T6","T7","T8"], [
    ["T1"], ["T2"], ["T3"], ["T4"], ["T5","T6"], ["T8","T7"],
  ]);
}

// ---- 4. Double elimination with a bracket reset -----------------------------
// LB team wins GF match 1, loses the reset. Match 2 has to count as the later one.
{
  const W = "de_winners", L = "de_losers", G = "de_grand_final";
  const ms = [
    m(W, 1, 1, "T1", "T8"), m(W, 1, 2, "T4", "T5"),
    m(W, 1, 3, "T2", "T7"), m(W, 1, 4, "T3", "T6"),
    m(W, 2, 1, "T1", "T4"), m(W, 2, 2, "T2", "T3"),
    m(W, 3, 1, "T1", "T2"),
    m(L, 1, 1, "T5", "T8"), m(L, 1, 2, "T6", "T7"),
    m(L, 2, 1, "T4", "T5"), m(L, 2, 2, "T3", "T6"),
    m(L, 3, 1, "T3", "T4"),
    m(L, 4, 1, "T2", "T3"),
    m(G, 1, 1, "T2", "T1"),   // reset forced
    m(G, 1, 2, "T1", "T2"),   // T1 wins the reset
  ];
  check("DE-8-bracket-reset", ms, ["T1","T2","T3","T4","T5","T6","T7","T8"], [
    ["T1"], ["T2"], ["T3"], ["T4"], ["T5","T6"], ["T8","T7"],
  ]);
}

// ---- 5. Hybrid 12 (4 UB + 8 LB) --------------------------------------------
// A UB loser drops into LB R3; its placement must come from where it finally
// went out (the SF), not from the upper-bracket loss.
{
  const UB = "hybrid_ub", LB = "hybrid_lb", SF = "hybrid_sf", GF = "hybrid_gf";
  const ms = [
    m(UB, 1, 1, "A1", "A4"), m(UB, 1, 2, "A2", "A3"),
    m(LB, 1, 1, "B1", "B8"), m(LB, 1, 2, "B2", "B7"),
    m(LB, 1, 3, "B3", "B6"), m(LB, 1, 4, "B4", "B5"),
    m(LB, 2, 1, "B1", "B4"), m(LB, 2, 2, "B2", "B3"),
    m(LB, 3, 1, "B1", "A3"), m(LB, 3, 2, "A4", "B2"),
    m(SF, 1, 1, "A1", "A4"), m(SF, 1, 2, "A2", "B1"),
    m(GF, 1, 1, "A1", "A2"),
  ];
  const teams = ["A1","A2","A3","A4","B1","B2","B3","B4","B5","B6","B7","B8"];
  check("hybrid-12", ms, teams, [
    ["A1"], ["A2"], ["A4","B1"], ["A3","B2"], ["B4","B3"], ["B8","B7","B6","B5"],
  ]);
}

// ---- 6. Group stage into a single-elimination bracket -----------------------
// Non-advancers tier by finishing position inside their own group.
{
  const SE = "single_elimination";
  const g = (n, mn, w, l) => m(`group_${n}`, 1, mn, w, l);
  const ms = [
    // group 1: A > B > C > D
    g(1, 1, "A", "B"), g(1, 2, "A", "C"), g(1, 3, "A", "D"),
    g(1, 4, "B", "C"), g(1, 5, "B", "D"), g(1, 6, "C", "D"),
    // group 2: E > F > G > H
    g(2, 1, "E", "F"), g(2, 2, "E", "G"), g(2, 3, "E", "H"),
    g(2, 4, "F", "G"), g(2, 5, "F", "H"), g(2, 6, "G", "H"),
    m(SE, 1, 1, "A", "F"), m(SE, 1, 2, "E", "B"),
    m(SE, 2, 1, "A", "E"),
  ];
  check("group-SE-8", ms, ["A","B","C","D","E","F","G","H"], [
    ["A"], ["E"], ["F","B"], ["C","G"], ["D","H"],
  ]);
}

// ---- 7. Swiss into a single-elimination bracket -----------------------------
// Swiss non-advancers tier by record only — the format never played a match to
// separate two teams that both went 1-2.
{
  const SW = "swiss", SE = "single_elimination";
  const ms = [
    m(SW, 1, 1, "S1", "S8"), m(SW, 1, 2, "S2", "S7"),
    m(SW, 1, 3, "S3", "S6"), m(SW, 1, 4, "S4", "S5"),
    m(SW, 2, 1, "S1", "S2"), m(SW, 2, 2, "S3", "S4"),
    m(SW, 2, 3, "S5", "S6"), m(SW, 2, 4, "S7", "S8"),
    m(SW, 3, 1, "S2", "S5"), m(SW, 3, 2, "S4", "S7"),
    m(SE, 1, 1, "S1", "S4"), m(SE, 1, 2, "S3", "S2"),
    m(SE, 2, 1, "S1", "S3"),
  ];
  check("swiss-SE-8", ms, ["S1","S2","S3","S4","S5","S6","S7","S8"], [
    ["S1"], ["S3"], ["S4","S2"], ["S5","S7"], ["S6","S8"],
  ]);
}

// ---- 8. Void matches and a team that never played --------------------------
{
  const SE = "single_elimination";
  const ms = [
    m(SE, 1, 1, "T1", "T2"),
    m(SE, 1, 2, "T3", "T4", "void"),
    m(SE, 2, 1, "T1", "T3"),
  ];
  check("void-and-noshow", ms, ["T1","T2","T3","T4","T5"], [
    ["T1"], ["T3"], ["T2"], ["T4"], ["T5"],
  ]);
}

// ---- Points sanity against the numbers verified by hand ---------------------
console.log("\npoints, N=12, tournament, f=500:");
for (const r of [1, 2, 3.5, 6.5, 12]) {
  console.log(`  r=${String(r).padEnd(4)} ${eventPoints({ placement: r, teamCount: 12, prizePool: 500, kind: "tournament" }).toFixed(2)}`);
}
console.log(`  season 1st  ${eventPoints({ placement: 1, teamCount: 12, prizePool: 500, kind: "season" }).toFixed(2)}  (expect 467.8)`);
console.log(`  f=0 1st     ${eventPoints({ placement: 1, teamCount: 12, prizePool: 0, kind: "tournament" }).toFixed(2)}  (expect 9.2)`);
console.log(`  N=1 guard   ${eventPoints({ placement: 1, teamCount: 1, prizePool: 500, kind: "season" })}`);
console.log(`  prizePool   ${prizePoolTotal(1000, 500, 250)}  (expect 2000)`);
console.log(`  band label  ${formatPlacement(12.5, 8)}  (expect 9th-16th)`);

console.log(failures === 0 ? "\nALL FIXTURES PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
