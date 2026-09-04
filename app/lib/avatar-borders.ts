import type { CSSProperties } from "react";

export const AVATAR_BORDER_BENEFIT = "avatar-border";

// Border art is hand-drawn and its transparent opening is never perfectly
// centred or perfectly square — a frame exported at 976x980 can have its hole
// offset several pixels off-centre. Rather than nudging each one with bespoke
// CSS, every border carries the opening it was drawn around and the geometry
// below fits the frame to the avatar.
//
// `opening` is the circle where the avatar should show, in pixels of the image
// it was measured on. `measured` is that image's size. The shipped PNG is a
// downscale (256px on its short axis) and does not have to match `measured` —
// only the ratios are used, so the numbers stay valid across re-exports.
//
// Hardcoded rather than admin-managed for the same reason as PATREON_BENEFITS:
// adding a border means shipping an image anyway. To add one, append an entry
// with a stable, never-reused `id`.
export type AvatarBorder = {
  id: string;
  title: string;
  src: string;
  measured: { width: number; height: number };
  opening: { top: number; bottom: number; left: number; right: number };
};

export const AVATAR_BORDERS: readonly AvatarBorder[] = [
  {
    id: "nature",
    title: "Nature",
    src: "/avatar-borders/nature.png",
    measured: { width: 976, height: 980 },
    opening: { top: 71, bottom: 908, left: 74, right: 911 },
  },
  {
    id: "cloud",
    title: "Cloud",
    src: "/avatar-borders/cloud.png",
    measured: { width: 959, height: 942 },
    opening: { top: 70, bottom: 877, left: 77, right: 884 },
  },
  {
    id: "tech",
    title: "Tech",
    src: "/avatar-borders/tech.png",
    measured: { width: 982, height: 997 },
    opening: { top: 45, bottom: 940, left: 45, right: 940 },
  },
];

const BY_ID = new Map(AVATAR_BORDERS.map((b) => [b.id, b]));

export function getAvatarBorder(id: string | null | undefined): AvatarBorder | null {
  return id ? BY_ID.get(id) ?? null : null;
}

// The avatar keeps whatever box the call site already gave it and the frame is
// scaled and offset around it, so adding a border never resizes an avatar or
// reflows a row. Everything is a percentage of that box, which makes the result
// independent of the rendered pixel size — one style object works from a 20px
// table row to a 128px podium.
//
// The opening is a bounding box, so an 837x841 hole is an ellipse. The avatar
// stays a true circle at the larger of the two axes: distorting a face reads far
// worse than a few pixels of overflow, and since the frame paints on top of the
// avatar that overflow disappears under the ring. Undersizing instead would show
// the page background through the gap.
export function avatarBorderFrameStyle(border: AvatarBorder): CSSProperties {
  const { top, bottom, left, right } = border.opening;
  const diameter = Math.max(right - left, bottom - top);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  return {
    position: "absolute",
    width: `${(border.measured.width / diameter) * 100}%`,
    height: `${(border.measured.height / diameter) * 100}%`,
    left: `${(0.5 - centerX / diameter) * 100}%`,
    top: `${(0.5 - centerY / diameter) * 100}%`,
    maxWidth: "none",
    pointerEvents: "none",
  };
}
