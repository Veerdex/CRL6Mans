export type NavLayout = "sidebar" | "topbar";

export const NAV_LAYOUTS: NavLayout[] = ["sidebar", "topbar"];

export const DEFAULT_NAV_LAYOUT: NavLayout = "topbar";

// Bumped when the default flipped from sidebar to topbar. The preference is
// mirrored into a cookie that lasts a year, so without a new name every
// existing reader would keep rendering the old chrome until their next login —
// the cookie is read before the account row and would win.
export const NAV_LAYOUT_COOKIE = "nav_layout_v2";

export function resolveNavLayout(value: string | null | undefined): NavLayout {
  return value === "sidebar" ? "sidebar" : DEFAULT_NAV_LAYOUT;
}
