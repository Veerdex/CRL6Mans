"use client";

import { useRef, useState, useEffect, useCallback } from "react";

type Pos = { x: number; y: number; scale: number };

export function BracketCanvas({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef   = useRef<HTMLDivElement>(null);
  const isDragging   = useRef(false);
  const hasMoved     = useRef(false);
  const lastMouse    = useRef({ x: 0, y: 0 });
  const posRef       = useRef<Pos>({ x: 24, y: 24, scale: 1 });
  const [pos, setPosState] = useState<Pos>({ x: 24, y: 24, scale: 1 });
  const [grabbing, setGrabbing]        = useState(false);
  const [transitioning, setTransition] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cssFull, setCssFull]          = useState(false);

  const isFull = isFullscreen || cssFull;

  function setPos(next: Pos) {
    posRef.current = next;
    setPosState(next);
  }

  // ── Fullscreen ───────────────────────────────────────────────────────────────
  useEffect(() => {
    function onFSChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  // Lock body scroll when using CSS fullscreen fallback
  useEffect(() => {
    if (cssFull) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [cssFull]);

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenEnabled) {
      setCssFull(v => !v);
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen().catch(() => setCssFull(v => !v));
    }
  }

  // ── Mouse drag ───────────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    hasMoved.current   = false;
    lastMouse.current  = { x: e.clientX, y: e.clientY };
    setGrabbing(true);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    if (!hasMoved.current && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) hasMoved.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setPos({ ...posRef.current, x: posRef.current.x + dx, y: posRef.current.y + dy });
  }, []);

  const stopDrag = useCallback(() => {
    isDragging.current = false;
    setGrabbing(false);
  }, []);

  // ── Scroll zoom ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect   = el.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const p      = posRef.current;
      const ns     = Math.min(3, Math.max(0.15, p.scale * factor));
      setPos({ x: mx - (mx - p.x) * (ns / p.scale), y: my - (my - p.y) * (ns / p.scale), scale: ns });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Touch pan / pinch-zoom ───────────────────────────────────────────────────
  const lastTouches   = useRef<{ x: number; y: number }[]>([]);
  const lastPinchDist = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function getPts(touches: TouchList) {
      return Array.from(touches).map(t => ({ x: t.clientX, y: t.clientY }));
    }
    function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
      return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }

    function onTouchStart(e: TouchEvent) {
      const pts = getPts(e.touches);
      lastTouches.current = pts;
      if (pts.length === 2) {
        lastPinchDist.current = dist(pts[0], pts[1]);
        hasMoved.current = true;
      } else {
        hasMoved.current = false;
        lastPinchDist.current = null;
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      const pts  = getPts(e.touches);
      const prev = lastTouches.current;

      if (pts.length === 2 && prev.length >= 1) {
        const newDist = dist(pts[0], pts[1]);
        const oldDist = lastPinchDist.current ?? newDist;
        const factor  = oldDist > 0 ? newDist / oldDist : 1;
        lastPinchDist.current = newDist;

        const cx    = (pts[0].x + pts[1].x) / 2;
        const cy    = (pts[0].y + pts[1].y) / 2;
        const prevCx = prev.length >= 2 ? (prev[0].x + prev[1].x) / 2 : prev[0].x;
        const prevCy = prev.length >= 2 ? (prev[0].y + prev[1].y) / 2 : prev[0].y;

        const rect = el!.getBoundingClientRect();
        const mx = cx - rect.left;
        const my = cy - rect.top;
        const p  = posRef.current;
        const ns = Math.min(3, Math.max(0.15, p.scale * factor));

        setPos({
          x: mx - (mx - p.x) * (ns / p.scale) + (cx - prevCx),
          y: my - (my - p.y) * (ns / p.scale) + (cy - prevCy),
          scale: ns,
        });
        hasMoved.current = true;
      } else if (pts.length === 1 && prev.length >= 1) {
        const dx = pts[0].x - prev[0].x;
        const dy = pts[0].y - prev[0].y;
        if (!hasMoved.current && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) hasMoved.current = true;
        setPos({ ...posRef.current, x: posRef.current.x + dx, y: posRef.current.y + dy });
      }

      lastTouches.current = pts;
    }

    function onTouchEnd() {
      lastTouches.current   = [];
      lastPinchDist.current = null;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, []);

  // ── Click-to-navigate (data-goto → data-match-id) ────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (hasMoved.current) return;

    let el: HTMLElement | null = e.target as HTMLElement;
    while (el && el !== e.currentTarget) {
      if (el.hasAttribute("data-goto")) break;
      el = el.parentElement;
    }
    if (!el || !el.hasAttribute("data-goto")) return;
    const gotoId = el.getAttribute("data-goto");
    if (!gotoId) return;

    const targetEl = document.querySelector(
      `[data-match-id="${gotoId}"]`
    ) as HTMLElement | null;
    if (!targetEl) return;

    e.preventDefault();

    const container = e.currentTarget as HTMLElement;
    const cRect = container.getBoundingClientRect();
    const tRect = targetEl.getBoundingClientRect();
    const p     = posRef.current;

    const cx = (tRect.left + tRect.width  / 2 - cRect.left - p.x) / p.scale;
    const cy = (tRect.top  + tRect.height / 2 - cRect.top  - p.y) / p.scale;

    const ns: number = 1.25;
    const next: Pos  = { x: cRect.width / 2 - cx * ns, y: cRect.height / 2 - cy * ns, scale: ns };

    setTransition(true);
    setPos(next);
    setTimeout(() => setTransition(false), 380);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden bg-zinc-950 ${isFull ? "fixed inset-0 z-[60]" : "relative rounded-xl border border-zinc-800"}`}
      style={{
        height: isFull ? "100dvh" : 580,
        cursor: grabbing ? "grabbing" : "grab",
        userSelect: "none",
        backgroundImage:
          "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px)," +
          "linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
        backgroundSize: `${24 * pos.scale}px ${24 * pos.scale}px`,
        backgroundPosition: `${pos.x}px ${pos.y}px`,
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      onClick={handleClick}
    >
      <div
        ref={contentRef}
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${pos.scale})`,
          transformOrigin: "0 0",
          position: "absolute",
          willChange: "transform",
          transition: transitioning ? "transform 0.35s ease-out" : "none",
        }}
      >
        {children}
      </div>

      <p className="absolute top-3 left-3 text-[11px] text-zinc-700 pointer-events-none select-none">
        Drag to pan · Scroll/pinch to zoom · Tap match to navigate
      </p>

      <div
        className="absolute bottom-3 right-3 flex items-center gap-1 z-10"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="text-[11px] text-zinc-600 mr-1 tabular-nums">{Math.round(pos.scale * 100)}%</span>
        <button
          onClick={() => setPos({ ...posRef.current, scale: Math.min(3, posRef.current.scale * 1.25) })}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 font-bold text-base"
        >+</button>
        <button
          onClick={() => setPos({ ...posRef.current, scale: Math.max(0.15, posRef.current.scale / 1.25) })}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 font-bold text-base"
        >−</button>
        <button
          onClick={() => setPos({ x: 24, y: 24, scale: 1 })}
          className="px-2.5 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 text-xs"
        >Reset</button>
        <button
          onClick={toggleFullscreen}
          title={isFull ? "Exit fullscreen" : "Fullscreen"}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400"
        >
          {isFull ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
