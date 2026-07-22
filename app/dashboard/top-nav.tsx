"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type TopNavLeaf = { href: string; label: string; icon: React.ReactNode };
export type TopNavGroup = { label: string; icon: React.ReactNode; items: TopNavLeaf[] };
export type TopNavEntry = TopNavLeaf | TopNavGroup;

function isGroup(entry: TopNavEntry): entry is TopNavGroup {
  return "items" in entry;
}

function isActive(href: string, pathname: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

function entryActive(entry: TopNavEntry, pathname: string): boolean {
  return isGroup(entry) ? entry.items.some((i) => isActive(i.href, pathname)) : isActive(entry.href, pathname);
}

function entryKey(entry: TopNavEntry): string {
  return isGroup(entry) ? `group:${entry.label}` : entry.href;
}

const ITEM_CLS =
  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap";
const GAP = 4; // gap-1
const CLOSE_DELAY = 150;

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// Priority-overflow nav: shows as many tabs/groups as fit, the rest collapse
// into a "More" dropdown so the bar never overlaps the right-hand cluster.
// Groups open on hover (with a short close delay so moving the cursor into
// the panel doesn't dismiss it) and on click, so keyboard/touch users can
// still reach them without relying on hover.
export function TopNav({ items }: { items: TopNavEntry[] }) {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = (key: string) => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenKey((k) => (k === key ? null : k)), CLOSE_DELAY);
  };

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const avail = container.clientWidth;
    const nodes = Array.from(measure.children) as HTMLElement[];
    const widths = nodes.slice(0, items.length).map((n) => n.offsetWidth);
    const moreW = nodes[items.length]?.offsetWidth ?? 64;

    const fullW = widths.reduce((a, w, i) => a + w + (i ? GAP : 0), 0);
    if (fullW <= avail) { setVisibleCount(items.length); return; }

    const budget = avail - moreW - GAP; // reserve room for the More button
    let used = 0, count = 0;
    for (let i = 0; i < widths.length; i++) {
      const next = used + widths[i] + (count ? GAP : 0);
      if (next <= budget) { used = next; count++; } else break;
    }
    setVisibleCount(count);
  }, [items.length]);

  useEffect(() => {
    recompute();
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [recompute]);

  // Close any open dropdown on navigation or outside click.
  useEffect(() => { setOpenKey(null); }, [pathname]);
  useEffect(() => {
    if (!openKey) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpenKey(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openKey]);

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);
  const overflowActive = overflow.some((e) => entryActive(e, pathname));

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0 flex items-center gap-1">
      {/* Hidden measurement row — always renders every item/group + the More button */}
      <div ref={measureRef} aria-hidden className="absolute left-0 top-0 flex items-center gap-1 invisible pointer-events-none">
        {items.map((entry) => (
          <span key={entryKey(entry)} className={ITEM_CLS}>
            {entry.icon}{entry.label}{isGroup(entry) && <ChevronIcon open={false} />}
          </span>
        ))}
        <span className={`${ITEM_CLS} nav-more`}><MoreIcon />More</span>
      </div>

      {/* Visible tabs / groups */}
      {visible.map((entry) => {
        if (isGroup(entry)) {
          const key = entryKey(entry);
          const open = openKey === key;
          const active = entryActive(entry, pathname);
          return (
            <div
              key={key}
              className="relative shrink-0"
              onMouseEnter={() => { cancelClose(); setOpenKey(key); }}
              onMouseLeave={() => scheduleClose(key)}
            >
              <button
                type="button"
                onClick={() => setOpenKey((k) => (k === key ? null : key))}
                aria-expanded={open}
                className={`${ITEM_CLS} ${active || open ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"}`}
              >
                {entry.icon}{entry.label}<ChevronIcon open={open} />
              </button>
              {open && (
                <div className="absolute left-0 top-full mt-1 min-w-44 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl p-1 z-50">
                  {entry.items.map((item) => {
                    const itemActive = isActive(item.href, pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpenKey(null)}
                        className={`${ITEM_CLS} w-full ${itemActive ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"}`}
                      >
                        {item.icon}{item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }

        const active = isActive(entry.href, pathname);
        return (
          <Link
            key={entry.href}
            href={entry.href}
            className={`${ITEM_CLS} ${active ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"}`}
          >
            {entry.icon}{entry.label}
          </Link>
        );
      })}

      {/* More dropdown */}
      {overflow.length > 0 && (
        <div
          className="relative shrink-0"
          onMouseEnter={() => { cancelClose(); setOpenKey("more"); }}
          onMouseLeave={() => scheduleClose("more")}
        >
          <button
            type="button"
            onClick={() => setOpenKey((k) => (k === "more" ? null : "more"))}
            aria-expanded={openKey === "more"}
            className={`nav-more ${ITEM_CLS} ${overflowActive || openKey === "more" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"}`}
          >
            <MoreIcon />More
          </button>
          {openKey === "more" && (
            <div className="nav-more-menu absolute right-0 top-full mt-1 min-w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl p-1 z-50">
              {overflow.map((entry) => {
                if (isGroup(entry)) {
                  return (
                    <div key={entryKey(entry)} className="py-1">
                      <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{entry.label}</div>
                      {entry.items.map((item) => {
                        const itemActive = isActive(item.href, pathname);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setOpenKey(null)}
                            className={`${ITEM_CLS} w-full ${itemActive ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"}`}
                          >
                            {item.icon}{item.label}
                          </Link>
                        );
                      })}
                    </div>
                  );
                }
                const itemActive = isActive(entry.href, pathname);
                return (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    onClick={() => setOpenKey(null)}
                    className={`${ITEM_CLS} w-full ${itemActive ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"}`}
                  >
                    {entry.icon}{entry.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
