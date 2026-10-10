import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MW, MH, TH, BW, CG, BCOL, gH, badgeHeight, buildSwissLayout,
  SPEC_16, SPEC_8, LAYOUT_16, LAYOUT_8, type SwissLayout, type SwissSpec,
} from "../app/dashboard/season/swiss-layout";

// The 16-team layout's Y values were hardcoded pixels read off a screenshot.
// Rebuilding at the pre-port row height has to land on them, or the derivation
// is a layout nobody approved rather than the one that shipped. (The 8-team
// values were hand-nudged ~6-12px off the same rules, so they are deliberately
// not a fixture here — the builder regularises them.)
const LEGACY_GROUP_16: Record<string, number> = {
  "0-0": 240,
  "1-0": 158, "0-1": 322,
  "2-0": 104, "1-1": 240, "0-2": 376,
  "2-1": 172, "1-2": 308,
  "2-2": 240,
};
const LEGACY_BADGE_16: Record<string, number> = {
  "3-0": 85, "0-3": 395,
  "3-1": 147, "1-3": 333,
  "3-2": 178, "2-3": 302,
};

test("at the pre-port sizes the 16-team layout matches the values it replaced", () => {
  const L = buildSwissLayout(SPEC_16, 28, 210);
  for (const [k, want] of Object.entries(LEGACY_GROUP_16)) {
    assert.equal(L.GROUP_CY[k], want, `group ${k}`);
  }
  assert.equal(Object.keys(L.GROUP_CY).length, Object.keys(LEGACY_GROUP_16).length);
  for (const [k, want] of Object.entries(LEGACY_BADGE_16)) {
    // the hardcoded values were the connector's exit Y rounded to a whole pixel
    assert.ok(Math.abs(L.BADGE_CY[k] - want) <= 0.5, `badge ${k}: ${L.BADGE_CY[k]} vs ${want}`);
  }
  assert.equal(Object.keys(L.BADGE_CY).length, Object.keys(LEGACY_BADGE_16).length);
});

test("the column walk lands on the known X anchors", () => {
  const l16 = buildSwissLayout(SPEC_16, 28, 210);
  assert.deepEqual(l16.RX, { 1: 0, 2: 258, 3: 516, 4: 950, 5: 1384 });
  assert.deepEqual(l16.BX, { 3: 774, 4: 1208, 5: 1642 });
  assert.equal(l16.CW, 1810);

  const l8 = buildSwissLayout(SPEC_8, 28, 210);
  assert.deepEqual(l8.RX, { 1: 0, 2: 258, 3: 692 });
  assert.deepEqual(l8.BX, { 2: 516, 3: 950 });
  assert.equal(l8.CW, 1118);

  // a badge column always sits one connector gap right of the round it follows,
  // and the round after it clears the badge column entirely
  for (const [label, spec, L] of [["16", SPEC_16, l16], ["8", SPEC_8, l8]] as const) {
    for (const [r, bx] of Object.entries(L.BX)) {
      assert.equal(bx, L.RX[Number(r)] + 210 + CG, `${label}-team badge column after R${r}`);
      const next = L.RX[Number(r) + 1];
      if (next !== undefined) assert.equal(next, bx + BCOL, `${label}-team R${Number(r) + 1} must clear the badge column`);
    }
    assert.equal(Object.keys(L.RX).length, spec.rounds.length);
  }
});

// Nothing in a column may touch anything else in it, nor the round-label row,
// nor the canvas edges. This is the check the hardcoded values failed: at MH=35
// the 16-team Round 3 column's 2-0 box ran 9px into the 1-1 box below it.
function audit(label: string, L: SwissLayout, mh: number, mw: number) {
  type Box = { col: number; top: number; bottom: number; what: string; round: boolean };
  const boxes: Box[] = [];

  for (const [key, n] of Object.entries(L.GCNT)) {
    const [r, w, l] = key.split("-").map(Number);
    const cy = L.GROUP_CY[`${w}-${l}`];
    assert.ok(cy !== undefined, `${label}: group ${w}-${l} has no centre`);
    const h = gH(n, mh);
    boxes.push({ col: L.RX[r], top: cy - h / 2, bottom: cy + h / 2, what: `R${r} ${w}-${l}`, round: true });
  }
  for (const t of L.TRANS.filter((t) => t.badge)) {
    const n = L.GCNT[`${t.sR}-${t.sW}-${t.sL}`];
    const cy = L.BADGE_CY[`${t.dW}-${t.dL}`];
    assert.ok(cy !== undefined, `${label}: badge ${t.dW}-${t.dL} has no centre`);
    const h = badgeHeight(n);
    boxes.push({ col: L.BX[t.sR], top: cy - h / 2, bottom: cy + h / 2, what: `badge ${t.dW}-${t.dL}`, round: false });
  }

  const cols = new Map<number, Box[]>();
  for (const b of boxes) {
    if (!cols.has(b.col)) cols.set(b.col, []);
    cols.get(b.col)!.push(b);
  }
  for (const [col, bs] of cols) {
    bs.sort((a, b) => a.top - b.top);
    // a round column's top TH is the "Round N" label; a badge column has no label
    const floor = bs[0].round ? TH : 0;
    assert.ok(bs[0].top >= floor, `${label} x=${col}: ${bs[0].what} top ${bs[0].top} intrudes on ${floor}`);
    for (let i = 1; i < bs.length; i++) {
      const gap = bs[i].top - bs[i - 1].bottom;
      assert.ok(gap >= 0, `${label} x=${col}: ${bs[i].what} overlaps ${bs[i - 1].what} by ${-gap}px`);
    }
    assert.ok(bs[bs.length - 1].bottom <= L.CH, `${label} x=${col}: ${bs[bs.length - 1].what} hangs below CH ${L.CH}`);
    assert.ok(col + (bs[0].round ? mw : BW) <= L.CW, `${label} x=${col}: column runs past CW ${L.CW}`);
  }
}

test("no box overlaps another, the round label, or the canvas edge", () => {
  audit(`16-team @${MW}x${MH}`, LAYOUT_16, MH, MW);
  audit(`8-team @${MW}x${MH}`, LAYOUT_8, MH, MW);
  audit("16-team @210x28", buildSwissLayout(SPEC_16, 28, 210), 28, 210);
  audit("8-team @210x28", buildSwissLayout(SPEC_8, 28, 210), 28, 210);
  // a row height nobody has asked for yet, to show the derivation is general
  for (const mh of [24, 42, 56]) {
    audit(`16-team @${MW}x${mh}`, buildSwissLayout(SPEC_16, mh), mh, MW);
    audit(`8-team @${MW}x${mh}`, buildSwissLayout(SPEC_8, mh), mh, MW);
  }
});

test("every transition joins a real group to a real destination, moving right", () => {
  for (const [label, L] of [["16-team", LAYOUT_16], ["8-team", LAYOUT_8]] as const) {
    for (const t of L.TRANS) {
      assert.ok(L.GCNT[`${t.sR}-${t.sW}-${t.sL}`] !== undefined,
        `${label}: transition out of unknown group ${t.sR}-${t.sW}-${t.sL}`);
      const dstY = t.badge ? L.BADGE_CY[`${t.dW}-${t.dL}`] : L.GROUP_CY[`${t.dW}-${t.dL}`];
      assert.ok(dstY !== undefined, `${label}: transition into unknown ${t.badge ? "badge" : "group"} ${t.dW}-${t.dL}`);
      const dstX = t.badge ? L.BX[t.sR] : L.RX[t.dR];
      assert.ok(dstX > L.RX[t.sR], `${label}: transition ${t.sR}->${t.dR} does not move right`);
    }
    // each group sends its winners one way and its losers the other
    for (const key of Object.keys(L.GCNT)) {
      const [sR, sW, sL] = key.split("-").map(Number);
      const out = L.TRANS.filter((t) => t.sR === sR && t.sW === sW && t.sL === sL);
      assert.equal(out.filter((t) => t.kind === "winner").length, 1, `${label}: group ${key} winners`);
      assert.equal(out.filter((t) => t.kind === "loser").length, 1, `${label}: group ${key} losers`);
    }
  }
});

test("the canvas is symmetric about the spine the columns are centred on", () => {
  for (const [label, spec] of [["16-team", SPEC_16], ["8-team", SPEC_8]] as const) {
    for (const mh of [28, MH, 48]) {
      const L: SwissLayout = buildSwissLayout(spec as SwissSpec, mh);
      const single = Object.entries(L.GCNT).filter(([k]) => {
        const r = Number(k.split("-")[0]);
        return Object.keys(L.GCNT).filter((o) => Number(o.split("-")[0]) === r).length === 1;
      });
      // a round holding one group puts it dead on the spine
      for (const [k] of single) {
        const [, w, l] = k.split("-").map(Number);
        assert.equal(L.GROUP_CY[`${w}-${l}`], L.CH / 2, `${label} @${mh}: lone group ${k} off the spine`);
      }
    }
  }
});
