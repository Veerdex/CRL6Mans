import Link from "next/link";

// Mobile-only bell for the home page's top-right corner. The bottom tab bar can
// bury the notifications tab behind "More" once enough tabs are visible, so the
// count needs a fixed place on the one page everyone lands on. Desktop already
// has the tab in the sidebar, where the same count rides the nav item.
export function NotificationsBell({ count }: { count: number }) {
  return (
    <Link
      href="/dashboard/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      className="md:hidden relative shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
