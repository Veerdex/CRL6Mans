import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RL_SEASONS,
  EARLY_SEASON_DAYS,
  currentRlSeason,
  daysIntoRlSeason,
  earlySeasonNotice,
  earlySeasonPrompt,
  seasonPeakLabel,
} from "../app/lib/rl-season";

const S24 = "2026-09-23T16:00:00Z";
const at = (iso: string) => new Date(iso);
const daysAfter = (iso: string, days: number) =>
  new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000);

// ─── The table itself ───────────────────────────────────────────────────────────

test("seasons are listed oldest first, which currentRlSeason's scan relies on", () => {
  const times = RL_SEASONS.map((s) => new Date(s.startedAt).getTime());
  assert.deepEqual([...times].sort((a, b) => a - b), times);
  assert.ok(times.every(Number.isFinite), "every startedAt must parse");
});

test("season numbers run consecutively, so previousSeason is really the previous one", () => {
  RL_SEASONS.forEach((s, i) => {
    if (i > 0) assert.equal(s.season, RL_SEASONS[i - 1].season + 1);
  });
});

// ─── Which season is in progress ────────────────────────────────────────────────

test("a season starts exactly at its published timestamp, not a moment before", () => {
  assert.equal(currentRlSeason(at(S24))?.season, 24);
  assert.equal(currentRlSeason(new Date(new Date(S24).getTime() - 1))?.season, 23);
});

test("before the table there is no answer, rather than the oldest season", () => {
  assert.equal(currentRlSeason(at("2020-01-01T00:00:00Z")), null);
  assert.equal(daysIntoRlSeason(at("2020-01-01T00:00:00Z")), null);
});

test("a stale table degrades to the newest season rather than to null", () => {
  const newest = RL_SEASONS[RL_SEASONS.length - 1];
  const wayLater = daysAfter(newest.startedAt, 400);
  assert.equal(currentRlSeason(wayLater)?.season, newest.season);
  assert.equal(daysIntoRlSeason(wayLater), 400);
});

// ─── The early-season window ────────────────────────────────────────────────────

test("the window covers the reset and closes on the day it runs out", () => {
  assert.ok(earlySeasonNotice(at(S24)));
  assert.ok(earlySeasonNotice(daysAfter(S24, EARLY_SEASON_DAYS - 1)));
  assert.equal(earlySeasonNotice(daysAfter(S24, EARLY_SEASON_DAYS)), null);
});

test("a stale table reads as late in the season — the permissive answer", () => {
  const newest = RL_SEASONS[RL_SEASONS.length - 1];
  assert.equal(earlySeasonNotice(daysAfter(newest.startedAt, 400)), null);
});

test("the notice names the season to enter, which is the one before the live one", () => {
  const notice = earlySeasonNotice(daysAfter(S24, 3));
  assert.deepEqual(notice, {
    season: 24,
    previousSeason: 23,
    startedAt: S24,
    daysIn: 3,
  });
});

test("the oldest season in the table has no previous one to name", () => {
  const oldest = RL_SEASONS[0];
  assert.equal(earlySeasonNotice(at(oldest.startedAt))?.previousSeason, null);
});

// ─── Copy ───────────────────────────────────────────────────────────────────────

test("the prompt names last season, never the live one, as the value to enter", () => {
  const prompt = earlySeasonPrompt(earlySeasonNotice(daysAfter(S24, 5))!);
  assert.match(prompt, /Season 24 started 5 days ago/);
  assert.match(prompt, /Put your Season 23 peaks in the Last Season Peak boxes/);
});

test("the prompt names the boxes, so nobody lowers their all-time peak", () => {
  const prompt = earlySeasonPrompt(earlySeasonNotice(daysAfter(S24, 5))!);
  assert.match(prompt, /All Time Peak is still your all-time best/);
});

test("day zero and day one read as English, not as a count", () => {
  assert.match(earlySeasonPrompt(earlySeasonNotice(at(S24))!), /started today/);
  assert.match(earlySeasonPrompt(earlySeasonNotice(daysAfter(S24, 1))!), /started yesterday/);
});

test("with no previous season named, the prompt still asks for last season's", () => {
  const oldest = RL_SEASONS[0];
  const prompt = earlySeasonPrompt(earlySeasonNotice(at(oldest.startedAt))!);
  assert.match(prompt, /Put your last season peaks in the Last Season Peak boxes/);
});

test("the input label switches to last season and back", () => {
  assert.equal(seasonPeakLabel("3v3", true), "Last Season Peak 3v3");
  assert.equal(seasonPeakLabel("3v3", false), "Season Peak 3v3");
  assert.equal(seasonPeakLabel("2v2", true), "Last Season Peak 2v2");
});
