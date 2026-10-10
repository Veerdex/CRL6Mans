import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MH, MW, LABEL_H, UNIT, buildLayout12, buildLayout8, type Layout,
} from "../app/dashboard/season/hybrid-layout";

const L12 = (mh?: number) => buildLayout12("hybrid_ub", "hybrid_lb", "hybrid_sf", "hybrid_gf", mh);
const L8 = (mh?: number) => buildLayout8("hybrid8_ub", "hybrid8_lb", "hybrid8_sf", "hybrid8_gf", mh);

const yOf = (L: Layout, key: string) => {
  const n = L.nodes.find((n) => n.key === key);
  assert.ok(n, `missing node ${key}`);
  return n!.y;
};

// Every card centre used to be a hardcoded pixel value, which is what made the
// card height un-changeable. Rebuilding at the old height has to land on those
// exact values, or the derivation is a new layout rather than the old one.
const LEGACY_66_12: Record<string, number> = {
  "hybrid_ub-1-1": 70, "hybrid_ub-1-2": 170,
  "hybrid_lb-1-1": 300, "hybrid_lb-1-2": 390, "hybrid_lb-1-3": 480, "hybrid_lb-1-4": 570,
  "hybrid_lb-2-1": 345, "hybrid_lb-2-2": 525,
  "hybrid_lb-3-1": 345, "hybrid_lb-3-2": 525,
  "hybrid_sf-1-1": 345, "hybrid_sf-1-2": 525,
  "hybrid_gf-1-1": 435,
};
const LEGACY_66_8: Record<string, number> = {
  "hybrid8_ub-1-1": 70, "hybrid8_ub-1-2": 170,
  "hybrid8_lb-1-1": 300, "hybrid8_lb-1-2": 410,
  "hybrid8_lb-2-1": 300, "hybrid8_lb-2-2": 410,
  "hybrid8_sf-1-1": 300, "hybrid8_sf-1-2": 410,
  "hybrid8_gf-1-1": 355,
};

test("at the pre-port card height every centre matches the value it replaced", () => {
  for (const [variant, legacy, L] of [
    ["12-team", LEGACY_66_12, L12(66)],
    ["8-team", LEGACY_66_8, L8(66)],
  ] as const) {
    for (const [key, want] of Object.entries(legacy)) {
      assert.equal(yOf(L, key), want, `${variant} ${key}`);
    }
    assert.equal(L.nodes.length, Object.keys(legacy).length, `${variant}: legacy table must cover every node`);
  }
});

// A column's cards are stacked by hand, so the only thing standing between a
// taller card and an overlap is the arithmetic. A card carrying a group label
// needs LABEL_H of clear space above it as well.
function auditColumns(label: string, L: Layout, mh: number) {
  const cols = new Map<number, typeof L.nodes>();
  for (const n of L.nodes) {
    if (!cols.has(n.x)) cols.set(n.x, []);
    cols.get(n.x)!.push(n);
  }
  for (const [x, nodes] of cols) {
    nodes.sort((a, b) => a.y - b.y);
    const topOf = (n: typeof nodes[number]) => n.y - mh / 2 - (n.label ? LABEL_H : 0);
    assert.ok(topOf(nodes[0]) >= 0, `${label} x=${x}: ${nodes[0].badge} starts above the canvas`);
    for (let i = 1; i < nodes.length; i++) {
      const gap = topOf(nodes[i]) - (nodes[i - 1].y + mh / 2);
      assert.ok(gap >= 0, `${label} x=${x}: ${nodes[i].badge} overlaps ${nodes[i - 1].badge} by ${-gap}px`);
    }
    assert.ok(nodes[nodes.length - 1].y + mh / 2 <= L.CH, `${label} x=${x}: last card hangs below CH ${L.CH}`);
    assert.ok(x + MW <= L.CW, `${label} x=${x}: column runs past CW ${L.CW}`);
  }
}

test("no card collides with the card or label above it, at the old height or the new", () => {
  auditColumns("12-team @66", L12(66), 66);
  auditColumns("8-team @66", L8(66), 66);
  auditColumns(`12-team @${MH}`, L12(), MH);
  auditColumns(`8-team @${MH}`, L8(), MH);
});

test("every edge resolves to a node, and columns are one UNIT apart", () => {
  for (const [label, L] of [["12-team", L12()], ["8-team", L8()]] as const) {
    const keys = new Set(L.nodes.map((n) => n.key));
    for (const e of L.edges) {
      assert.ok(keys.has(e.f), `${label}: edge from unknown node ${e.f}`);
      assert.ok(keys.has(e.t), `${label}: edge to unknown node ${e.t}`);
    }
    const xs = [...new Set(L.nodes.map((n) => n.x))].sort((a, b) => a - b);
    xs.forEach((x, i) => assert.equal(x, i * UNIT, `${label}: column ${i} is not on the UNIT grid`));
  }
});
