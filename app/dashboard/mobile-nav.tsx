"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoutButton } from "./logout-button";
import { NavLeafContent, PodiumGlowIcon, PODIUM_HREF, podiumTabClass, podiumLabelClass } from "./podium-glow";

type Item = { href: string; label: string; icon: React.ReactNode };

type Props = {
  items: Item[];
  username: string;
  displayName?: string | null;
  avatarUrl: string;
  status: "approved" | "pending" | "rejected" | "unregistered";
  priorityHrefs?: string[];
};

function isActive(href: string, pathname: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export default function MobileNav({ items, username, displayName, avatarUrl, status, priorityHrefs = [] }: Props) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Reorder: Home first, then priority items (if present in the user's nav), then the rest.
  const ordered = (() => {
    const home = items.filter((i) => i.href === "/dashboard");
    const priority = priorityHrefs
      .map((href) => items.find((i) => i.href === href))
      .filter((i): i is Item => !!i);
    const prioritySet = new Set(["/dashboard", ...priorityHrefs]);
    const rest = items.filter((i) => !prioritySet.has(i.href));
    return [...home, ...priority, ...rest];
  })();

  // Up to 4 primary tabs in the bar; the rest live behind "More".
  const showMore = ordered.length > 5;
  const primary = showMore ? ordered.slice(0, 4) : ordered;
  const overflow = showMore ? ordered.slice(4) : [];
  const moreActive = overflow.length > 0 && overflow.some((i) => isActive(i.href, pathname));

  // Close the sheet on Escape.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <>
      {/* Bottom tab bar — mobile only */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex bg-zinc-900/95 backdrop-blur border-t border-zinc-800 pb-[env(safe-area-inset-bottom)]">
        {primary.map((item) => {
          const active = isActive(item.href, pathname);
          const podium = item.href === PODIUM_HREF;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-20 text-[10px] font-medium transition-colors ${podium ? podiumTabClass + " " : ""}${
                active ? "text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {podium ? <PodiumGlowIcon>{item.icon}</PodiumGlowIcon> : item.icon}
              <span className={`truncate max-w-full px-1 ${podium ? podiumLabelClass : ""}`}>{item.label}</span>
            </Link>
          );
        })}

        {showMore && (
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-20 text-[10px] font-medium transition-colors ${
              moreActive || moreOpen ? "text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
            aria-label="More"
            aria-expanded={moreOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            <span>More</span>
          </button>
        )}
      </nav>

      {/* "More" sheet */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto bg-zinc-900 border-t border-zinc-800 rounded-t-2xl p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-sm font-semibold text-zinc-300">Menu</span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1">
              {overflow.map((item) => {
                const active = isActive(item.href, pathname);
                const podium = item.href === PODIUM_HREF;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${podium ? podiumTabClass + " " : ""}${
                      active
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"
                    }`}
                  >
                    <NavLeafContent item={item} />
                  </Link>
                );
              })}
            </div>

            {status === "pending" && (
              <div className="mt-3 px-3 py-2 bg-yellow-900/40 border border-yellow-700/50 rounded-lg text-xs text-yellow-300">
                Registration pending admin review.
              </div>
            )}
            {status === "rejected" && (
              <div className="mt-3 px-3 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-xs text-red-300">
                Registration rejected. You may re-submit.
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-3 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarUrl} alt="avatar" width={32} height={32} className="rounded-full shrink-0" />
                <span className="text-sm text-zinc-300 truncate">{displayName ?? username}</span>
              </div>
              <LogoutButton className="shrink-0" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
