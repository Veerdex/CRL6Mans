"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const THRESHOLD = 72;
const MAX_PULL = 96;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const s = useRef({ startY: 0, active: false, pullY: 0, refreshing: false });
  const router = useRouter();

  useEffect(() => {
    const isPwa = window.matchMedia("(display-mode: standalone)").matches;
    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    if (!isPwa || !isMobile) return;
    const el = scrollRef.current;
    if (!el) return;
    const state = s.current;

    function onTouchStart(e: TouchEvent) {
      if ((scrollRef.current?.scrollTop ?? 0) > 2) return;
      state.startY = e.touches[0].clientY;
      state.active = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!state.active || state.refreshing) return;
      if ((scrollRef.current?.scrollTop ?? 0) > 2) { state.active = false; state.pullY = 0; setPullY(0); return; }
      const dy = e.touches[0].clientY - state.startY;
      if (dy <= 0) { state.pullY = 0; setPullY(0); return; }
      e.preventDefault();
      const pull = Math.min(MAX_PULL, dy * 0.5);
      state.pullY = pull;
      setPullY(pull);
    }

    function onTouchEnd() {
      if (!state.active) return;
      state.active = false;
      if (state.pullY >= THRESHOLD && !state.refreshing) {
        state.refreshing = true;
        setRefreshing(true);
        setPullY(MAX_PULL);
        router.refresh();
        setTimeout(() => {
          state.refreshing = false;
          setRefreshing(false);
          state.pullY = 0;
          setPullY(0);
        }, 700);
      } else {
        state.pullY = 0;
        setPullY(0);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [router]);

  const displayH = refreshing ? MAX_PULL : pullY;
  const progress = Math.min(1, pullY / THRESHOLD);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto pb-24 md:pb-0">
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{
          height: `${displayH}px`,
          transition: s.current.active ? "none" : "height 0.2s ease",
        }}
      >
        {displayH > 4 && (
          <div
            className={`w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shadow-md ${refreshing ? "animate-spin" : ""}`}
            style={{ transform: refreshing ? undefined : `rotate(${progress * 300}deg)` }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-zinc-300">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
