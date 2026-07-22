// One-off manual verification: run the new parser against real .replay files
// and print per-player identity resolution. Not part of the automated suite.
//
// Usage: npx tsx scripts/inspect-replay.ts <path-to-replay> [more paths...]

import { readFileSync } from "node:fs";
import { parseReplay } from "../app/lib/replay-parser";

for (const path of process.argv.slice(2)) {
  console.log(`\n=== ${path} ===`);
  try {
    const buf = readFileSync(path);
    const replay = parseReplay(buf);
    console.log(`gameType=${replay.gameType} major=${replay.majorVersion} minor=${replay.minorVersion} netVersion=${replay.netVersion}`);
    console.log(`map=${replay.mapName} date=${replay.date} replayId=${replay.replayId}`);
    console.log(`score: team0=${replay.team0Score} team1=${replay.team1Score}`);
    for (const p of replay.players) {
      console.log(
        `  team${p.team} ${JSON.stringify(p.name)} platform=${p.platform} `
        + `onlineId=${p.onlineId} source=${p.identitySource} key=${p.identityKey} `
        + `(g${p.goals}/a${p.assists}/s${p.saves}/sh${p.shots}/score${p.score})`,
      );
    }
    if (replay.warnings.length) {
      console.log("warnings:");
      for (const w of replay.warnings) console.log(`  - ${w}`);
    }
  } catch (err) {
    console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
  }
}
