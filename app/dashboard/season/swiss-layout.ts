// Swiss bracket geometry. A pure leaf module — no React, no Supabase, no
// imports at all — so `node --test` can load it (`npm run test:swiss-layout`).
//
// Every Y used to be a hardcoded pixel value read off a screenshot, which is why
// the match row could not be made taller: at MH=35 the 16-team Round 3 column's
// 2-0 box ran 9px into the 1-1 box below it. The whole column layout is in fact
// derivable from GCNT (how many matches each record-group holds) and TRANS (which
// group feeds which), so it is derived here instead:
//
//   * the groups of one round stack in descending-W order with a 12px gap and
//     the stack is centred on the canvas spine, so a taller row can only make
//     the stack taller — never make two boxes meet;
//   * a qualified/eliminated box sits on its connector's exit Y, so the line
//     into it is straight. The one exception is the final column, where a single
//     group feeds both a qualified and an eliminated box: two straight lines
//     would put them 0.4*gH apart and overlap, so they split the group's height;
//   * the spine is then placed far enough down that the tallest column clears
//     the round-label row, and the canvas is twice that.

export const MW = 315;  // match / group box width
export const MH = 35;   // match row height (single horizontal row)
export const MG = 0;    // no gap between match rows (dividers handle separation)
export const GH = 28;   // group header height
export const GP = 6;    // group vertical padding (top + bottom)
export const CG = 48;   // horizontal connector gap between round columns
export const BW = 148;  // badge column width
export const BG = 28;   // gap between badge column and next round column
export const TH = 36;   // top header row height (round labels)

export const UNIT = MW + CG;  // one round-column + connector gap
export const BCOL = BW + BG;  // one badge column + gap

const STACK_GAP = 12;      // clear space between two groups in the same round
const BADGE_GAP = 8;       // clear space between two badge boxes off one group
const BADGE_ROW_H = 24;    // one team line inside a qualified/eliminated box
const GROUP_TOP_PAD = 20;  // clear space between the round label and the tallest group
const BADGE_TOP_PAD = 16;  // clear space above the highest badge box

// A connector leaves its group 20% of the group's height off centre — winners
// above, losers below. The badge placement has to agree with the curve the
// display draws, so both read this.
export const EXIT_FRAC = 0.2;

// group height given n matches. `mh` is injectable only so the test can rebuild
// the layout at the pre-port row height and check it against the pixel values
// that used to be hardcoded; every caller in the app uses the default.
export function gH(n: number, mh: number = MH) { return GH + 2 * GP + n * mh + Math.max(0, n - 1) * MG; }

// badge box height given the match count of the group that feeds it — one team
// line per match, since each match sends exactly one team each way
export function badgeHeight(n: number) { return GH + 16 + n * BADGE_ROW_H; }

export type Trans = {
  sR: number; sW: number; sL: number;
  dR: number; dW: number; dL: number;
  kind: "winner" | "loser";
  badge: boolean;
};

export type SwissSpec = {
  rounds: number[];              // round columns to label
  GCNT: Record<string, number>;  // match count per "round-w-l"
  TRANS: Trans[];
};

export type SwissLayout = SwissSpec & {
  RX: Record<number, number>;        // X by round
  BX: Record<number, number>;        // X of badge column by "after round R"
  GROUP_CY: Record<string, number>;  // group center-Y by "w-l"
  BADGE_CY: Record<string, number>;  // badge center-Y by "w-l"
  CW: number;
  CH: number;
};

export function buildSwissLayout(spec: SwissSpec, mh: number = MH, mw: number = MW): SwissLayout {
  const { rounds, GCNT, TRANS } = spec;
  const last = rounds[rounds.length - 1];
  const unit = mw + CG;
  const h = (n: number) => gH(n, mh);

  // ── Columns ────────────────────────────────────────────────────────────────
  // Walk left to right, inserting a badge column after any round that sends a
  // team out of the bracket. The last badge column needs no trailing gap.
  const badgeAfter = new Set(TRANS.filter((t) => t.badge).map((t) => t.sR));
  const RX: Record<number, number> = {};
  const BX: Record<number, number> = {};
  let x = 0;
  for (const r of rounds) {
    RX[r] = x;
    x += unit;
    if (badgeAfter.has(r)) {
      BX[r] = x;
      if (r !== last) x += BCOL;
    }
  }
  const CW = BX[last] + BW + 20;

  // ── Group stacks, as offsets from the spine ────────────────────────────────
  const byRound = new Map<number, { key: string; w: number; n: number }[]>();
  for (const [key, n] of Object.entries(GCNT)) {
    const [r, w, l] = key.split("-").map(Number);
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r)!.push({ key: `${w}-${l}`, w, n });
  }
  const dGroup: Record<string, number> = {};
  let groupExtent = 0;
  for (const gs of byRound.values()) {
    gs.sort((a, b) => b.w - a.w);
    const total = gs.reduce((s, g) => s + h(g.n), 0) + STACK_GAP * (gs.length - 1);
    groupExtent = Math.max(groupExtent, total / 2);
    let y = -total / 2;
    for (const g of gs) {
      dGroup[g.key] = y + h(g.n) / 2;
      y += h(g.n) + STACK_GAP;
    }
  }

  // ── Badge boxes, as offsets from the spine ─────────────────────────────────
  const byCol = new Map<number, Trans[]>();
  for (const t of TRANS) {
    if (!t.badge) continue;
    if (!byCol.has(t.sR)) byCol.set(t.sR, []);
    byCol.get(t.sR)!.push(t);
  }
  const dBadge: Record<string, number> = {};
  let badgeExtent = 0;
  for (const ts of byCol.values()) {
    for (const t of ts) {
      const n = GCNT[`${t.sR}-${t.sW}-${t.sL}`];
      const src = dGroup[`${t.sW}-${t.sL}`];
      const shared = ts.filter((o) => o.sW === t.sW && o.sL === t.sL).length > 1;
      // Two straight connectors out of one group would land their boxes 0.4*gH
      // apart and overlap, so a shared pair splits the group's height instead —
      // or its own, whichever is the larger, since a short group cannot hold
      // two boxes open on its own.
      const off = shared
        ? Math.max(h(n) / 2, (badgeHeight(n) + BADGE_GAP) / 2)
        : h(n) * EXIT_FRAC;
      const d = t.kind === "winner" ? src - off : src + off;
      dBadge[`${t.dW}-${t.dL}`] = d;
      badgeExtent = Math.max(badgeExtent, Math.abs(d) + badgeHeight(n) / 2);
    }
  }

  // ── Spine ──────────────────────────────────────────────────────────────────
  // Low enough that the tallest group stack clears the round labels and the
  // highest badge box clears the top of the canvas.
  const C = Math.max(TH + GROUP_TOP_PAD + groupExtent, BADGE_TOP_PAD + badgeExtent);
  const GROUP_CY: Record<string, number> = {};
  for (const [k, d] of Object.entries(dGroup)) GROUP_CY[k] = C + d;
  const BADGE_CY: Record<string, number> = {};
  for (const [k, d] of Object.entries(dBadge)) BADGE_CY[k] = C + d;

  return { ...spec, RX, BX, GROUP_CY, BADGE_CY, CW, CH: 2 * C };
}

// 16-team Swiss: 3 wins qualify, 3 losses eliminate. R1–R5, badges after R3/R4/R5.
export const SPEC_16: SwissSpec = {
  rounds: [1, 2, 3, 4, 5],
  GCNT: {
    "1-0-0": 8,
    "2-1-0": 4, "2-0-1": 4,
    "3-2-0": 2, "3-1-1": 4, "3-0-2": 2,
    "4-2-1": 3, "4-1-2": 3,
    "5-2-2": 3,
  },
  TRANS: [
    { sR:1,sW:0,sL:0, dR:2,dW:1,dL:0, kind:"winner", badge:false },
    { sR:1,sW:0,sL:0, dR:2,dW:0,dL:1, kind:"loser",  badge:false },
    { sR:2,sW:1,sL:0, dR:3,dW:2,dL:0, kind:"winner", badge:false },
    { sR:2,sW:1,sL:0, dR:3,dW:1,dL:1, kind:"loser",  badge:false },
    { sR:2,sW:0,sL:1, dR:3,dW:1,dL:1, kind:"winner", badge:false },
    { sR:2,sW:0,sL:1, dR:3,dW:0,dL:2, kind:"loser",  badge:false },
    { sR:3,sW:2,sL:0, dR:3,dW:3,dL:0, kind:"winner", badge:true  },
    { sR:3,sW:2,sL:0, dR:4,dW:2,dL:1, kind:"loser",  badge:false },
    { sR:3,sW:1,sL:1, dR:4,dW:2,dL:1, kind:"winner", badge:false },
    { sR:3,sW:1,sL:1, dR:4,dW:1,dL:2, kind:"loser",  badge:false },
    { sR:3,sW:0,sL:2, dR:4,dW:1,dL:2, kind:"winner", badge:false },
    { sR:3,sW:0,sL:2, dR:3,dW:0,dL:3, kind:"loser",  badge:true  },
    { sR:4,sW:2,sL:1, dR:4,dW:3,dL:1, kind:"winner", badge:true  },
    { sR:4,sW:2,sL:1, dR:5,dW:2,dL:2, kind:"loser",  badge:false },
    { sR:4,sW:1,sL:2, dR:5,dW:2,dL:2, kind:"winner", badge:false },
    { sR:4,sW:1,sL:2, dR:4,dW:1,dL:3, kind:"loser",  badge:true  },
    { sR:5,sW:2,sL:2, dR:5,dW:3,dL:2, kind:"winner", badge:true  },
    { sR:5,sW:2,sL:2, dR:5,dW:2,dL:3, kind:"loser",  badge:true  },
  ],
};

// 8-team Swiss (hybrid_8): 2 wins qualify, 2 losses eliminate. R1–R3, badges after R2/R3.
export const SPEC_8: SwissSpec = {
  rounds: [1, 2, 3],
  GCNT: {
    "1-0-0": 4,
    "2-1-0": 2, "2-0-1": 2,
    "3-1-1": 2,
  },
  TRANS: [
    { sR:1,sW:0,sL:0, dR:2,dW:1,dL:0, kind:"winner", badge:false },
    { sR:1,sW:0,sL:0, dR:2,dW:0,dL:1, kind:"loser",  badge:false },
    { sR:2,sW:1,sL:0, dR:2,dW:2,dL:0, kind:"winner", badge:true  },
    { sR:2,sW:1,sL:0, dR:3,dW:1,dL:1, kind:"loser",  badge:false },
    { sR:2,sW:0,sL:1, dR:3,dW:1,dL:1, kind:"winner", badge:false },
    { sR:2,sW:0,sL:1, dR:2,dW:0,dL:2, kind:"loser",  badge:true  },
    { sR:3,sW:1,sL:1, dR:3,dW:2,dL:1, kind:"winner", badge:true  },
    { sR:3,sW:1,sL:1, dR:3,dW:1,dL:2, kind:"loser",  badge:true  },
  ],
};

export const LAYOUT_16 = buildSwissLayout(SPEC_16);
export const LAYOUT_8 = buildSwissLayout(SPEC_8);
