// Red circle, white exclamation point — sits next to a nav label to say the tab
// behind it is waiting on the player. No hooks, so it renders from the server
// component that builds the nav as well as from the client nav components.
//
// Size is a prop rather than an appended class: Tailwind emits h-3 before h-4,
// so a caller-supplied override would lose to the default regardless of the
// order they appear in the class attribute.
const SIZES = {
  md: "h-4 w-4 text-[10px]",
  sm: "h-3 w-3 text-[8px]",
};

export function NavAlertBadge({ size = "md" }: { size?: keyof typeof SIZES }) {
  return (
    <span
      role="img"
      aria-label="Action needed"
      className={`nav-alert-badge inline-flex shrink-0 items-center justify-center rounded-full bg-red-500 font-bold leading-none text-white ${SIZES[size]}`}
    >
      !
    </span>
  );
}

// Same red pill, but sized to a number instead of a single "!". The fixed w-*
// above can't be reused: a two-digit count would overflow it, so this one sets a
// min-width and lets horizontal padding carry the rest. Counts past 99 render as
// 99+ so the pill can't grow wide enough to push a nav label around.
const COUNT_SIZES = {
  md: "h-4 min-w-4 px-1 text-[10px]",
  sm: "h-3.5 min-w-3.5 px-1 text-[8px]",
};

export function NavCountBadge({
  count,
  size = "md",
}: {
  count: number;
  size?: keyof typeof COUNT_SIZES;
}) {
  if (count <= 0) return null;
  return (
    <span
      role="status"
      aria-label={`${count} unread notification${count === 1 ? "" : "s"}`}
      className={`nav-alert-badge inline-flex shrink-0 items-center justify-center rounded-full bg-red-500 font-bold leading-none text-white ${COUNT_SIZES[size]}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
