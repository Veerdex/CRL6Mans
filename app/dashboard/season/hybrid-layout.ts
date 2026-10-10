// Hybrid bracket geometry. A pure leaf module — no React, no Supabase, no
// imports at all — so `node --test` can load it and assert that no two cards in
// a column collide. The card height used to be un-changeable because every card
// centre was written down as a pixel constant; now the centres are derived from
// MH, and the gaps below name the clear space between cards rather than the
// distance between their centres.

export const MW = 210;    // match card width
export const MH = 100;    // match card height (header + 2 team rows)
export const HEAD_H = 22; // badge/status header strip
export const LABEL_H = 22; // group label above the first card of a column
export const UNIT = MW + 80; // 290 — one column + gap

const Y0      = MH / 2 + 37;  // first Upper Bracket card, leaving its label room
const UB_GAP  = MH + 34;      // UB M1 → UB M2
const SEC_GAP = MH + 64;      // UB M2 → Lower Bracket R1 M1, that label included
const CH_PAD  = 40;           // below the lowest card

export type Node = {
  key: string;          // `${stage}-${round}-${mn}` — links to the DB match
  x: number;            // left
  y: number;            // center-Y
  badge: string;        // short ID — doubles as the click-to-pan target (data-match-id)
  label?: string;       // group title rendered above this node
  homeFeeder?: string;  // "Winner of X" / "Loser of X" shown when home slot is empty
  awayFeeder?: string;
};
export type Edge = { f: string; t: string };  // f/t are node keys
export type Layout = { nodes: Node[]; edges: Edge[]; CW: number; CH: number };

// LB Round 1 → LB QF → Semifinals → Grand Final are aligned in one horizontal row.
// The Upper Bracket sits on top of the column that feeds the Semifinals, so UB → SF
// lines drop cleanly in the gap. There are deliberately NO lines from the Upper
// Bracket down into the Lower Bracket (the loser drops) — those use clickable
// "Loser of X" labels instead, like Double Elimination.

export function buildLayout12(UB: string, LB: string, SF: string, GF: string): Layout {
  const X = (c: number) => c * UNIT;
  const LB_GAP = MH + 24;
  const ub   = [Y0, Y0 + UB_GAP];
  const lb1  = [0, 1, 2, 3].map((i) => ub[1] + SEC_GAP + i * LB_GAP);
  const lb2  = [(lb1[0] + lb1[1]) / 2, (lb1[2] + lb1[3]) / 2];
  const gf   = (lb2[0] + lb2[1]) / 2;
  const nodes: Node[] = [
    { key: `${UB}-1-1`, x: X(0), y: ub[0], badge: "UB M1", label: "Upper Bracket" },
    { key: `${UB}-1-2`, x: X(0), y: ub[1], badge: "UB M2" },

    { key: `${LB}-1-1`, x: X(0), y: lb1[0], badge: "LB1 M1", label: "Lower Bracket R1" },
    { key: `${LB}-1-2`, x: X(0), y: lb1[1], badge: "LB1 M2" },
    { key: `${LB}-1-3`, x: X(0), y: lb1[2], badge: "LB1 M3" },
    { key: `${LB}-1-4`, x: X(0), y: lb1[3], badge: "LB1 M4" },

    { key: `${LB}-2-1`, x: X(1), y: lb2[0], badge: "LB2 M1", label: "Lower Bracket R2",
      homeFeeder: "Winner of LB1 M1", awayFeeder: "Winner of LB1 M2" },
    { key: `${LB}-2-2`, x: X(1), y: lb2[1], badge: "LB2 M2",
      homeFeeder: "Winner of LB1 M3", awayFeeder: "Winner of LB1 M4" },

    { key: `${LB}-3-1`, x: X(2), y: lb2[0], badge: "LBQF M1", label: "Lower Bracket QF",
      homeFeeder: "Winner of LB2 M1", awayFeeder: "Loser of UB M1" },
    { key: `${LB}-3-2`, x: X(2), y: lb2[1], badge: "LBQF M2",
      homeFeeder: "Winner of LB2 M2", awayFeeder: "Loser of UB M2" },

    { key: `${SF}-1-1`, x: X(3), y: lb2[0], badge: "SF M1", label: "Semifinals",
      homeFeeder: "Winner of UB M1", awayFeeder: "Winner of LBQF M1" },
    { key: `${SF}-1-2`, x: X(3), y: lb2[1], badge: "SF M2",
      homeFeeder: "Winner of UB M2", awayFeeder: "Winner of LBQF M2" },

    { key: `${GF}-1-1`, x: X(4), y: gf, badge: "GF", label: "Grand Final",
      homeFeeder: "Winner of SF M1", awayFeeder: "Winner of SF M2" },
  ];
  const edges: Edge[] = [
    { f: `${LB}-1-1`, t: `${LB}-2-1` },
    { f: `${LB}-1-2`, t: `${LB}-2-1` },
    { f: `${LB}-1-3`, t: `${LB}-2-2` },
    { f: `${LB}-1-4`, t: `${LB}-2-2` },
    { f: `${LB}-2-1`, t: `${LB}-3-1` },
    { f: `${LB}-2-2`, t: `${LB}-3-2` },
    { f: `${LB}-3-1`, t: `${SF}-1-1` },
    { f: `${LB}-3-2`, t: `${SF}-1-2` },
    { f: `${SF}-1-1`, t: `${GF}-1-1` },
    { f: `${SF}-1-2`, t: `${GF}-1-1` },
  ];
  return { nodes, edges, CW: X(4) + MW + 48, CH: lb1[3] + MH / 2 + CH_PAD };
}

export function buildLayout8(UB: string, LB: string, SF: string, GF: string): Layout {
  const X = (c: number) => c * UNIT;
  const LB_GAP = MH + 44;
  const ub  = [Y0, Y0 + UB_GAP];
  const lb1 = [ub[1] + SEC_GAP, ub[1] + SEC_GAP + LB_GAP];
  const gf  = (lb1[0] + lb1[1]) / 2;
  const nodes: Node[] = [
    { key: `${UB}-1-1`, x: X(0), y: ub[0], badge: "UB M1", label: "Upper Bracket" },
    { key: `${UB}-1-2`, x: X(0), y: ub[1], badge: "UB M2" },

    { key: `${LB}-1-1`, x: X(0), y: lb1[0], badge: "LB1 M1", label: "Lower Bracket R1" },
    { key: `${LB}-1-2`, x: X(0), y: lb1[1], badge: "LB1 M2" },

    { key: `${LB}-2-1`, x: X(1), y: lb1[0], badge: "LBQF M1", label: "Lower Bracket QF",
      homeFeeder: "Winner of LB1 M1", awayFeeder: "Loser of UB M1" },
    { key: `${LB}-2-2`, x: X(1), y: lb1[1], badge: "LBQF M2",
      homeFeeder: "Winner of LB1 M2", awayFeeder: "Loser of UB M2" },

    { key: `${SF}-1-1`, x: X(2), y: lb1[0], badge: "SF M1", label: "Semifinals",
      homeFeeder: "Winner of UB M1", awayFeeder: "Winner of LBQF M1" },
    { key: `${SF}-1-2`, x: X(2), y: lb1[1], badge: "SF M2",
      homeFeeder: "Winner of UB M2", awayFeeder: "Winner of LBQF M2" },

    { key: `${GF}-1-1`, x: X(3), y: gf, badge: "GF", label: "Grand Final",
      homeFeeder: "Winner of SF M1", awayFeeder: "Winner of SF M2" },
  ];
  const edges: Edge[] = [
    { f: `${LB}-1-1`, t: `${LB}-2-1` },
    { f: `${LB}-1-2`, t: `${LB}-2-2` },
    { f: `${LB}-2-1`, t: `${SF}-1-1` },
    { f: `${LB}-2-2`, t: `${SF}-1-2` },
    { f: `${SF}-1-1`, t: `${GF}-1-1` },
    { f: `${SF}-1-2`, t: `${GF}-1-1` },
  ];
  return { nodes, edges, CW: X(3) + MW + 48, CH: lb1[1] + MH / 2 + CH_PAD };
}
