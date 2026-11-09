import { test } from "node:test";
import assert from "node:assert/strict";

import { teamAbbreviation, teamAbbreviations } from "../app/lib/team-abbreviation";

test("a multi-word name takes its initials", () => {
  assert.equal(teamAbbreviation("Tasselled Wobbegong"), "TW");
  assert.equal(teamAbbreviation("Bricked Beyond Belief"), "BBB");
  assert.equal(teamAbbreviation("Shorpify Rebellion"), "SR");
});

test("minor words are skipped and digits kept", () => {
  assert.equal(teamAbbreviation("3 Pickles In a Pod"), "3PP");
  assert.equal(teamAbbreviation("The Of And"), "TOA");
});

test("a one-word name takes its first three letters", () => {
  assert.equal(teamAbbreviation("Stickless"), "STI");
  assert.equal(teamAbbreviation("Bandits"), "BAN");
});

test("punctuation and extra spaces are ignored", () => {
  assert.equal(teamAbbreviation("  Arrh,  Arrh!  Arrh "), "AAA");
  assert.equal(teamAbbreviation("Shrek's Minions"), "SM");
});

test("teams that would share one take more of their last word", () => {
  const out = teamAbbreviations(["Shorpify Rebellion", "Salty Rockets", "Bandits"]);
  assert.equal(out.get("Shorpify Rebellion"), "SRE");
  assert.equal(out.get("Salty Rockets"), "SRO");
  assert.equal(out.get("Bandits"), "BAN");
});

test("one-word clashes take more of the word", () => {
  const out = teamAbbreviations(["Bandits", "Bandicoots"]);
  assert.equal(out.get("Bandits"), "BANDIT");
  assert.equal(out.get("Bandicoots"), "BANDIC");
});

test("names that never separate are numbered", () => {
  const out = teamAbbreviations(["Team A!", "Team A?"]);
  assert.deepEqual(new Set(out.values()).size, 2);
});

test("the answer does not depend on order", () => {
  const names = ["Shorpify Rebellion", "Salty Rockets", "Stickless", "Sticky"];
  assert.deepEqual([...teamAbbreviations(names)].sort(), [...teamAbbreviations([...names].reverse())].sort());
});

const SUMMER_2026 = [
  "Shorpify Rebellion", "Flowerboys", "Sackpack", "Arrh Arrh Arrh", "Stickless", "Los Habibis",
  "Absolutely No Clue", "Santa's Sack", "Beef Brawlers", "Corona with Lime", "Tsukuyomi",
  "Bricked Beyond Belief", "Slot Team 6", "Dream Blunt Rotation", "Shrek's Minions",
  "One in a Krillion", "DUI", "Deep Sea Dominators", "Las Abuelas", "Vacay", "Sweetie Pis",
  "Zouch Oven", "Tasselled Wobbegong", "Reef Raiders", "3 Pickles In a Pod", "Bandits",
  "$2 and an Overpay", "Sophisticated Gentlemen", "Jimmie Johns", "GentleBR8s", "Egoists",
  "Full Send FC",
];

test("a real league's 32 teams all come out distinct and short", () => {
  const out = teamAbbreviations(SUMMER_2026);
  assert.equal(new Set(out.values()).size, 32);
  for (const a of out.values()) assert.ok(a.length <= 4, a);
  assert.equal(out.get("$2 and an Overpay"), "2O");
  assert.equal(out.get("Slot Team 6"), "ST6");
});
