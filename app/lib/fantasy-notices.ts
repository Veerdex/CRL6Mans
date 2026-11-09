// Pure fantasy notice wording and the derived-notice rules (docs/fantasy-rl.md
// §12). No Supabase import, so node --test can load it. The server side
// (fantasy-notices-server.ts) decides which of these are new; this decides what
// each one says and who it goes to.

import { FROZEN_NOTE, type Matchup, type Schedule, type ScheduleWeek } from "./fantasy-schedule";

export type Notice = { to: string[]; title: string; body: string };

/** A notice keyed for the sent log, so each fires once per league. */
export type KeyedNotices = { key: string; notices: Notice[] };

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const pts = (n: number) => n.toFixed(1);

export type WaiverResultLine = { status: "won" | "lost" | "failed"; player: string; drop: string; note: string | null };

export function waiverNotice(leagueName: string, lines: WaiverResultLine[]): { title: string; body: string } {
  const won = lines.filter((l) => l.status === "won");
  const title =
    won.length === lines.length
      ? won.length === 1
        ? "Waiver claim won"
        : "Waiver claims won"
      : won.length
        ? "Waiver results"
        : lines.length === 1
          ? "Waiver claim missed"
          : "Waiver claims missed";
  const sentence = (l: WaiverResultLine) => {
    if (l.status === "won") return `You got ${l.player} and dropped ${l.drop}.`;
    if (l.status === "lost") return `${l.player} went to a manager ahead of you in the waiver order.`;
    return `Your claim for ${l.player} didn't go through${l.note ? `: ${l.note.replace(/\.$/, "")}` : ""}.`;
  };
  return { title, body: `${leagueName}: ${lines.map(sentence).join(" ")}` };
}

export function lineupNotice(
  leagueName: string,
  week: string,
  items: { player: string; reason: "bye" | "ineligible" }[],
): { title: string; body: string } {
  const why = (i: { player: string; reason: "bye" | "ineligible" }) =>
    i.reason === "bye" ? `${i.player} has a bye` : `${i.player} isn't on a team`;
  const list = items.map(why);
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return {
    title: items.length === 1 ? "A starter won't score" : "Starters won't score",
    body: `${leagueName}, ${week}: ${joined}, so ${items.length === 1 ? "that slot scores" : "those slots score"} nothing unless you swap them out.`,
  };
}

type Names = (managerId: string) => string;

function score(m: Matchup, me: string): { mine: number; theirs: number; them: string } {
  return me === m.a ? { mine: m.aPoints, theirs: m.bPoints, them: m.b! } : { mine: m.bPoints, theirs: m.aPoints, them: m.a };
}

function weekResult(week: ScheduleWeek, league: string, name: Names, everyone: string[]): Notice[] {
  const notices: Notice[] = [];
  for (const m of week.matchups) {
    if (m.b === null) continue;
    for (const me of [m.a, m.b]) {
      const { mine, theirs, them } = score(m, me);
      const line = `${pts(mine)}–${pts(theirs)}`;
      const tiebreak = mine === theirs && week.kind !== "regular" ? " The tie went to the higher seed." : "";
      const won = m.winner === me;
      if (week.kind === "regular") {
        notices.push({
          to: [me],
          title: m.winner === null ? `Week ${week.week}: a tie` : won ? `Week ${week.week}: you won` : `Week ${week.week}: you lost`,
          body:
            m.winner === null
              ? `${league}: you tied ${name(them)} ${line}.`
              : won
                ? `${league}: you beat ${name(them)} ${line}.`
                : `${league}: ${name(them)} beat you ${line}.`,
        });
      } else if (week.kind === "semifinal") {
        notices.push(
          won
            ? { to: [me], title: "Through to the final", body: `${league}: you beat ${name(them)} ${line} in the semifinals.${tiebreak} The final is next week.` }
            : { to: [me], title: "Out in the semifinals", body: `${league}: ${name(them)} beat you ${line}.${tiebreak} ${FROZEN_NOTE}` },
        );
      } else {
        notices.push(
          won
            ? { to: [me], title: "Fantasy champion!", body: `${league}: you beat ${name(them)} ${line} in the final.${tiebreak} You're the champion.` }
            : { to: [me], title: "Runner-up", body: `${league}: ${name(them)} beat you ${line} in the final.${tiebreak}` },
        );
      }
    }
  }
  if (week.kind === "final") {
    const m = week.matchups[0];
    if (m?.winner && m.b !== null) {
      const loser = m.winner === m.a ? m.b : m.a;
      const { mine, theirs } = score(m, m.winner);
      const rest = everyone.filter((id) => id !== m.a && id !== m.b);
      if (rest.length) {
        notices.push({
          to: rest,
          title: `${league} has a champion`,
          body: `${name(m.winner)} beat ${name(loser)} ${pts(mine)}–${pts(theirs)} in the final.`,
        });
      }
    }
  }
  return notices;
}

function seeding(schedule: Schedule, first: ScheduleWeek, league: string, name: Names): Notice[] {
  const opponent = new Map<string, string>();
  for (const m of first.matchups) {
    if (m.b === null) continue;
    opponent.set(m.a, m.b);
    opponent.set(m.b, m.a);
  }
  const round = first.kind === "semifinal" ? "semifinals" : "final";
  return schedule.standings.map((s, i) => {
    const them = opponent.get(s.managerId);
    return them
      ? {
          to: [s.managerId],
          title: "You made the playoffs",
          body: `${league}: you finished ${ordinal(i + 1)} and face ${name(them)} in the ${round}.`,
        }
      : {
          to: [s.managerId],
          title: "Your season is over",
          body: `${league}: you finished ${ordinal(i + 1)}, outside the playoff spots. ${FROZEN_NOTE}`,
        };
  });
}

/** Every result and seeding notice the schedule has made due, keyed for the sent log. */
export function scheduleNotices(schedule: Schedule, league: string, name: Names): KeyedNotices[] {
  const everyone = schedule.standings.map((s) => s.managerId);
  const out: KeyedNotices[] = [];
  for (const week of schedule.weeks) {
    if (!week.closed || week.pending) continue;
    out.push({ key: `result:${week.week}`, notices: weekResult(week, league, name, everyone) });
  }
  const first = schedule.weeks.find((w) => w.kind !== "regular");
  if (first && !first.pending) out.push({ key: "seeding", notices: seeding(schedule, first, league, name) });
  return out;
}
