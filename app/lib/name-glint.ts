import type { CSSProperties } from "react";

import { nameColorStyle, normalizeNameColor } from "@/app/lib/name-color";

export const NAME_GLINT_BENEFIT = "name-glint";

export const GLINT_MIN_COLORS = 2;
export const GLINT_MAX_COLORS = 4;

export const DEFAULT_GLINT_COLORS = ["#e88a24", "#3736ac"];

// Paired with nameGlintStyle at every call site. The sweep is a keyframe
// animation and keyframes cannot be written inline, so the moving part lives in
// globals.css while the colours, which are per-patron, stay in the style object.
export const GLINT_CLASS = "name-glint";

// Anything that is not 2-4 valid hex colours is treated as unset rather than
// repaired. The read path falls back to the solid Colored Name in that case, so
// a half-finished pick must never be allowed to look like a configured glint.
export function normalizeGlintColors(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < GLINT_MIN_COLORS || value.length > GLINT_MAX_COLORS) return null;
  const hexes = value.map((c) => (typeof c === "string" ? normalizeNameColor(c) : null));
  if (hexes.some((hex) => hex === null)) return null;
  return hexes as string[];
}

// background-size is 200%, so a background-position of 100% offsets the
// gradient by exactly one box width -- half the gradient. A seamless loop
// therefore needs every colour to sit exactly half the gradient away from an
// identical copy of itself.
//
// The stop list is the colours twice over plus a repeat of the first, which is
// what buys that: 2n+1 evenly spaced stops sit 1/(2n) apart, so a colour and
// its twin are n/(2n) = 1/2 apart. Doubling alone would space them n/(2n-1),
// which is 1/2 for no n, and the left edge would snap on every restart.
//
// Horizontal (90deg) rather than tilted: with an angled gradient a horizontal
// shift moves along the gradient axis by less than the shift itself, so the
// loop would jump on every repeat.
export function nameGlintStyle(colors: string[]): CSSProperties {
  return {
    backgroundImage: `linear-gradient(90deg, ${[...colors, ...colors, colors[0]].join(", ")})`,
    backgroundSize: "200% 100%",
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
  };
}

// Every place a decorated name renders. Precedence is already settled
// server-side (resolveNameStyleFields nulls the colour when a glint wins), so
// this only picks the matching renderer for whichever field survived.
export function nameStyle(
  color: string | null,
  outline: boolean,
  glint: string[] | null,
): { style: CSSProperties | undefined; className: string } {
  const colors = normalizeGlintColors(glint);
  if (colors) return { style: nameGlintStyle(colors), className: GLINT_CLASS };
  return { style: nameColorStyle(color, outline), className: "" };
}
