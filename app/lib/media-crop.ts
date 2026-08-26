import type { CSSProperties } from "react";

export type MediaCrop = { x: number; y: number; zoom: number };
export type CropKind = "logo" | "topNav" | "sideNav" | "background";
export type ContentCrop = Partial<Record<CropKind, MediaCrop>>;

export const DEFAULT_CROP: MediaCrop = { x: 50, y: 50, zoom: 1 };

export function cropStyle(crop: MediaCrop | undefined | null): CSSProperties {
  const c = crop ?? DEFAULT_CROP;
  return {
    objectFit: "cover",
    objectPosition: `${c.x}% ${c.y}%`,
    transform: c.zoom !== 1 ? `scale(${c.zoom})` : undefined,
    transformOrigin: `${c.x}% ${c.y}%`,
  };
}
