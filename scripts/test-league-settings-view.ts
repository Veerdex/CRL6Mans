import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import {
  LEAGUE_SETTINGS_CHANNEL_COLUMNS,
  readyGating,
  channelContext,
  staffRoleIdsFrom,
  type LeagueSettingsRow,
} from "../app/lib/league-settings-view";

type RB = Record<string, unknown>;

// The three selects this replaced, verbatim from the code before the merge.
const OLD_GATING_SELECT = "active_tournament_id, round1_manual_start_pending";
const OLD_CONTEXT_SELECT =
  "match_deadline_day, match_play_day, match_play_hour, rules_channel_id, " +
  "match_category_anchor_id, season_format, active_tournament_id";
const OLD_STAFF_SELECT = "moderator_role_id, director_role_id, ceo_role_id";

const cols = (select: string) => select.split(",").map((c) => c.trim());

// The inline expressions each consumer used before the merge, reproduced here so the
// projections are pinned against the originals rather than against themselves.
const oldGating = (row: Record<string, unknown> | null) => ({
  activeTournamentId: (row?.active_tournament_id as string | null) ?? null,
  round1ManualStartPending: !!row?.round1_manual_start_pending,
});

const oldChannelContext = (row: Record<string, unknown> | null) => {
  const format = row?.season_format as { roundBestOf?: RB } | null;
  return {
    deadlineDay: (row?.match_deadline_day as number | null) ?? 2,
    playDay: (row?.match_play_day as number | null) ?? 0,
    playHour: (row?.match_play_hour as number | null) ?? 19,
    rulesChannelId: (row?.rules_channel_id as string | null) ?? null,
    categoryAnchorId: (row?.match_category_anchor_id as string | null) ?? null,
    roundBestOf: format?.roundBestOf ?? {},
    isTournament: !!(row?.active_tournament_id as string | null | undefined),
  };
};

const oldStaffRoleIds = (row: Record<string, unknown> | null) =>
  [row?.moderator_role_id, row?.director_role_id, row?.ceo_role_id].filter(
    (id): id is string => !!id,
  );

const FULL: LeagueSettingsRow<RB> & Record<string, unknown> = {
  active_tournament_id: "a2dd2a6e-14ec-4605-ac28-ced054a5c7b8",
  round1_manual_start_pending: true,
  match_deadline_day: 4,
  match_play_day: 6,
  match_play_hour: 21,
  rules_channel_id: "1546049241749782588",
  match_category_anchor_id: "1559646003928244266",
  season_format: { roundBestOf: { de_winners: { standard: 3 } } },
  moderator_role_id: "1211541064800927754",
  director_role_id: "1211541064800927755",
  ceo_role_id: "1211541064800927756",
};

// Every column null, which is what a fresh league_settings row looks like — this is
// the case the defaults exist for.
const EMPTY: LeagueSettingsRow<RB> & Record<string, unknown> = {
  active_tournament_id: null,
  round1_manual_start_pending: null,
  match_deadline_day: null,
  match_play_day: null,
  match_play_hour: null,
  rules_channel_id: null,
  match_category_anchor_id: null,
  season_format: null,
  moderator_role_id: null,
  director_role_id: null,
  ceo_role_id: null,
};

const ROWS: Array<[string, (LeagueSettingsRow<RB> & Record<string, unknown>) | null]> = [
  ["a fully populated row", FULL],
  ["every column null", EMPTY],
  ["the row missing entirely (.single() found nothing)", null],
  ["a manual season — no active tournament", { ...FULL, active_tournament_id: null }],
  ["round 1 no longer pending", { ...FULL, round1_manual_start_pending: false }],
  ["a format with no roundBestOf", { ...FULL, season_format: {} }],
  // 0 is a real value for both of these: Sunday, and midnight.
  ["play day and hour both 0", { ...FULL, match_play_day: 0, match_play_hour: 0 }],
  ["deadline day 0", { ...FULL, match_deadline_day: 0 }],
  ["only a moderator role set", { ...EMPTY, moderator_role_id: "1211541064800927754" }],
  ["moderator missing, director and ceo set", { ...FULL, moderator_role_id: null }],
];

describe("the merged select covers all three reads it replaced", () => {
  for (const [name, select] of [
    ["ready gating", OLD_GATING_SELECT],
    ["channel context", OLD_CONTEXT_SELECT],
    ["staff role ids", OLD_STAFF_SELECT],
  ] as const) {
    test(`every column the ${name} read asked for is in the merged list`, () => {
      const merged = cols(LEAGUE_SETTINGS_CHANNEL_COLUMNS);
      for (const c of cols(select)) assert.ok(merged.includes(c), `missing: ${c}`);
    });
  }

  test("and asks for nothing beyond their union — league_settings holds Patreon tokens", () => {
    const union = new Set([
      ...cols(OLD_GATING_SELECT),
      ...cols(OLD_CONTEXT_SELECT),
      ...cols(OLD_STAFF_SELECT),
    ]);
    for (const c of cols(LEAGUE_SETTINGS_CHANNEL_COLUMNS)) {
      assert.ok(union.has(c), `unexpected column: ${c}`);
    }
  });

  test("no column is listed twice", () => {
    const list = cols(LEAGUE_SETTINGS_CHANNEL_COLUMNS);
    assert.equal(new Set(list).size, list.length);
  });
});

describe("readyGating matches the inline expressions it replaced", () => {
  for (const [name, row] of ROWS) {
    test(name, () => assert.deepEqual(readyGating(row), oldGating(row)));
  }

  test("round1ManualStartPending is a boolean even when the column is null", () => {
    assert.equal(readyGating(EMPTY).round1ManualStartPending, false);
    assert.equal(readyGating(null).round1ManualStartPending, false);
  });
});

describe("channelContext matches the inline expressions it replaced", () => {
  for (const [name, row] of ROWS) {
    test(name, () => assert.deepEqual(channelContext<RB>(row), oldChannelContext(row)));
  }

  test("the documented defaults: deadline Tue, play Sun, 19:00", () => {
    const ctx = channelContext<RB>(EMPTY);
    assert.equal(ctx.deadlineDay, 2);
    assert.equal(ctx.playDay, 0);
    assert.equal(ctx.playHour, 19);
    assert.equal(ctx.rulesChannelId, null);
    assert.equal(ctx.categoryAnchorId, null);
    assert.deepEqual(ctx.roundBestOf, {});
    assert.equal(ctx.isTournament, false);
  });

  // The two reads being merged both derived this from active_tournament_id, so the
  // one row has to answer both the same way.
  test("isTournament agrees with readyGating's activeTournamentId", () => {
    for (const [, row] of ROWS) {
      assert.equal(channelContext<RB>(row).isTournament, !!readyGating(row).activeTournamentId);
    }
  });

  test("roundBestOf is passed through untouched", () => {
    const config = { de_winners: { standard: 3 }, se: 5 };
    assert.equal(
      channelContext<RB>({ season_format: { roundBestOf: config } }).roundBestOf,
      config,
    );
  });
});

describe("staffRoleIdsFrom matches getStaffRoleIds' flat list", () => {
  for (const [name, row] of ROWS) {
    test(name, () => assert.deepEqual(staffRoleIdsFrom(row), oldStaffRoleIds(row)));
  }

  test("order is moderator, director, ceo", () => {
    assert.deepEqual(staffRoleIdsFrom(FULL), [
      "1211541064800927754",
      "1211541064800927755",
      "1211541064800927756",
    ]);
  });

  test("nulls are dropped rather than kept as holes", () => {
    assert.deepEqual(staffRoleIdsFrom({ ...EMPTY, ceo_role_id: "7" }), ["7"]);
    assert.deepEqual(staffRoleIdsFrom(EMPTY), []);
  });
});
