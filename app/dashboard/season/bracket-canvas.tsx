"use client";

import { useRef, useState, useEffect, useCallback } from "react";

type Pos = { x: number; y: number; scale: number };

export function BracketCanvas({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef   = useRef<HTMLDivElement>(null);
  const isDragging   = useRef(false);
  const hasMoved     = useRef(false);   // true if the mouse moved enough to count as a drag
  const lastMouse    = useRef({ x: 0, y: 0 });
  const posRef       = useRef<Pos>({ x: 24, y: 24, scale: 1 });
  const [pos, setPosState] = useState<Pos>({ x: 24, y: 24, scale: 1 });
  const [grabbing, setGrabbing]        = useState(false);
  const [transitioning, setTransition] = useState(false);

  function setPos(next: Pos) {
    posRef.current = next;
    setPosState(next);
  }

  // ── Drag ────────────────────────────────────────────────────────────────────
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
    // Only count as a drag after 4px movement to allow click-in-place
    if (!hasMoved.current && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      hasMoved.current = true;
    }
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

  // ── Click-to-navigate (data-goto → data-match-id) ──────────────────────────
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (hasMoved.current) return;

    // Manually walk up the DOM tree — avoid .closest() which can miss
    // server-rendered (RSC) nodes on some React builds
    let el: HTMLElement | null = e.target as HTMLElement;
    while (el && el !== e.currentTarget) {
      if (el.hasAttribute("data-goto")) break;
      el = el.parentElement;
    }
    if (!el || !el.hasAttribute("data-goto")) return;
    const gotoId = el.getAttribute("data-goto");
    if (!gotoId) return;

    // Use document.querySelector so we never rely on a potentially stale ref
    const targetEl = document.querySelector(
      `[data-match-id="${gotoId}"]`
    ) as HTMLElement | null;
    if (!targetEl) return;

    e.preventDefault();

    // e.currentTarget is always the container div (the element with onClick)
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
      className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"
      style={{ height: 580, cursor: grabbing ? "grabbing" : "grab", userSelect: "none" }}
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
          // pointer-events always on — we gate navigation via hasMoved instead
          transition: transitioning ? "transform 0.35s ease-out" : "none",
        }}
      >
        {children}
      </div>

      <p className="absolute top-3 left-3 text-[11px] text-zinc-700 pointer-events-none select-none">
        Drag to pan · Scroll to zoom · Click match reference to navigate
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
      </div>
    </div>
  );
}
