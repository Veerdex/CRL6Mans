import type { CSSProperties } from "react";

export const NAME_COLOR_BENEFIT = "colored-username";
export const SUPPORTER_BADGE_BENEFIT = "supporter-badge";

export const DEFAULT_NAME_COLOR = "#e88a24";

// Below this relative luminance a black outline would disappear into the name,
// so the outline flips to white. WCAG relative luminance rather than HSL
// lightness because saturated hues are not equally dark: pure blue lands at
// 0.07 and pure red at 0.21, which matches how they actually read on a page,
// while HSL calls both of them 50%.
const DARK_LUMINANCE = 0.2;

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeNameColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const hex = match[1].toLowerCase();
  return `#${hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex}`;
}

function linearize(byte: number) {
  const c = byte / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * linearize((n >> 16) & 255) +
    0.7152 * linearize((n >> 8) & 255) +
    0.0722 * linearize(n & 255)
  );
}

export function outlineColorFor(hex: string): string {
  return relativeLuminance(hex) < DARK_LUMINANCE ? "#ffffff" : "#000000";
}

// text-shadow rather than -webkit-text-stroke: the stroke is centred on the
// glyph edge and eats into thin weights. Offsets are in em because PlayerName
// renders at everything from text-xs to text-2xl.
const OUTLINE_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const OUTLINE_EM = 0.055;

export function nameOutlineShadow(hex: string): string {
  const outline = outlineColorFor(hex);
  return OUTLINE_OFFSETS.map(
    ([x, y]) => `${(x * OUTLINE_EM).toFixed(3)}em ${(y * OUTLINE_EM).toFixed(3)}em 0 ${outline}`,
  ).join(", ");
}

export function nameColorStyle(color: string | null, outline: boolean): CSSProperties | undefined {
  const hex = normalizeNameColor(color);
  if (!hex) return undefined;
  return outline ? { color: hex, textShadow: nameOutlineShadow(hex) } : { color: hex };
}
