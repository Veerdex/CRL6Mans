"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type TopNavItem = { href: string; label: string; icon: React.ReactNode };

function isActive(href: string, pathname: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

const ITEM_CLS =
  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap";
const GAP = 4; // gap-1

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

// Priority-overflow nav: shows as many tabs as fit, the rest collapse into a
// "More" dropdown so the bar never overlaps the right-hand cluster.
export function TopNav({ items }: { items: TopNavItem[] }) {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [open, setOpen] = useState(false);

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

  // Close the dropdown on navigation or outside click.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);
  const overflowActive = overflow.some((i) => isActive(i.href, pathname));

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0 flex items-center gap-1">
      {/* Hidden measurement row — always renders every item + the More button */}
      <div ref={measureRef} aria-hidden className="absolute left-0 top-0 flex items-center gap-1 invisible pointer-events-none">
        {items.map((item) => (
          <span key={item.href} className={ITEM_CLS}>{item.icon}{item.label}</span>
        ))}
        <span className={`${ITEM_CLS} nav-more`}><MoreIcon />More</span>
      </div>

      {/* Visible tabs */}
      {visible.map((item) => {
        const active = isActive(item.href, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${ITEM_CLS} ${active ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"}`}
          >
            {item.icon}{item.label}
          </Link>
        );
      })}

      {/* More dropdown */}
      {overflow.length > 0 && (
        <div ref={moreRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={`nav-more ${ITEM_CLS} ${overflowActive ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"}`}
          >
            <MoreIcon />More
          </button>
          {open && (
            <div className="nav-more-menu absolute right-0 top-full mt-1 min-w-44 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl p-1 z-50">
              {overflow.map((item) => {
                const active = isActive(item.href, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`${ITEM_CLS} w-full ${active ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"}`}
                  >
                    {item.icon}{item.label}
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
