"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { DEFAULT_CROP, type CropKind, type MediaCrop } from "@/app/lib/media-crop";

const CROP_KIND_LABEL: Record<CropKind, string> = {
  logo: "Logo",
  topNav: "Top nav image",
  sideNav: "Side nav image",
  background: "Tournament card background",
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

// The clear "window" is drawn to the real on-site shape/position of each
// placement — a full-width strip at the top for topNav, a full-height strip
// on the left for sideNav, a centered squircle for the logo — inside a 16:9
// mock of the page.
function windowStyle(kind: CropKind): CSSProperties {
  switch (kind) {
    case "topNav":
      return { top: 0, left: 0, width: "100%", height: "9%", borderRadius: 0 };
    case "sideNav":
      return { top: 0, left: 0, width: "20%", height: "100%", borderRadius: 0 };
    case "logo":
      return {
        top: "50%",
        left: "50%",
        width: "24%",
        aspectRatio: "1 / 1",
        borderRadius: "28%",
        transform: "translate(-50%, -50%)",
      };
    case "background":
      return { top: 0, left: 0, width: "100%", height: "100%", borderRadius: 0 };
  }
}

type Rect = { left: number; top: number; width: number; height: number };
type NaturalSize = { w: number; h: number };
type ImgTransform = { left: number; top: number; scale: number };

// Same formula the browser uses for `object-fit: cover` — the smallest
// uniform scale that still fully covers the window on both axes, taking
// whichever axis (width or height) needs more scale. A tiny multiplicative
// margin guards against the rendered box landing a hair under the window
// due to floating-point rounding in the pixel math below (the real site
// doesn't need this since object-fit: cover is computed natively by the
// browser's layout engine, not JS arithmetic).
const COVER_MARGIN = 1.002;
function coverScale(natural: NaturalSize, win: Rect): number {
  return Math.max(win.width / natural.w, win.height / natural.h) * COVER_MARGIN;
}

// Replicates exactly what cropStyle() does on the real site (object-fit:
// cover sized/positioned by x%/y%, then transform: scale(zoom) around that
// same x%/y% origin) but as an absolute pixel translate+scale against the
// *window's* box, so the same image element can be drawn continuously
// across the whole 16:9 frame — extending past the window, dimmed, instead
// of being clipped to it. That's what lets the dim area show real image
// content and lets dragging/zooming work from anywhere in the frame, not
// just inside the (usually tiny) window.
//
// The image is always rendered at its natural pixel size with a single
// `scale()` transform applied — never independent width/height — so the
// two axes can't desync and stretch the image.
function computeImgTransform(crop: MediaCrop, natural: NaturalSize, frame: Rect, win: Rect): ImgTransform | null {
  const baseScale = coverScale(natural, win);
  if (!isFinite(baseScale) || baseScale <= 0) return null;
  const scale = baseScale * crop.zoom;
  const denomX = win.width - scale * natural.w;
  const denomY = win.height - scale * natural.h;
  return {
    left: win.left - frame.left + (crop.x / 100) * denomX,
    top: win.top - frame.top + (crop.y / 100) * denomY,
    scale,
  };
}

// Inverse of computeImgTransform's position math — given where the image is
// now sitting (in frame-relative px) and the window/natural geometry,
// recovers the x%/y% that produced it. Used to convert a 1:1 pixel drag
// back into the stored percent-based crop.
function imgPosToCrop(left: number, top: number, zoom: number, natural: NaturalSize, frame: Rect, win: Rect) {
  const baseScale = coverScale(natural, win);
  const scale = baseScale * zoom;
  const denomX = win.width - scale * natural.w;
  const denomY = win.height - scale * natural.h;
  const finalLeftInWindow = left - (win.left - frame.left);
  const finalTopInWindow = top - (win.top - frame.top);
  const x = denomX !== 0 ? clamp((finalLeftInWindow / denomX) * 100, 0, 100) : 50;
  const y = denomY !== 0 ? clamp((finalTopInWindow / denomY) * 100, 0, 100) : 50;
  return { x, y };
}

export function MediaCropModal({
  kind,
  url,
  initialCrop,
  onClose,
  onSave,
}: {
  kind: CropKind;
  url: string;
  initialCrop: MediaCrop | undefined;
  onClose: () => void;
  onSave: (crop: MediaCrop) => Promise<{ error?: string } | void>;
}) {
  const [crop, setCrop] = useState<MediaCrop>(() => {
    const c = initialCrop ?? DEFAULT_CROP;
    return { x: clamp(c.x, 0, 100), y: clamp(c.y, 0, 100), zoom: clamp(c.zoom, MIN_ZOOM, MAX_ZOOM) };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  const [rects, setRects] = useState<{ frame: Rect; win: Rect } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    natural: NaturalSize;
    frame: Rect;
    win: Rect;
  } | null>(null);

  useEffect(() => {
    function measure() {
      const frame = frameRef.current?.getBoundingClientRect();
      const win = windowRef.current?.getBoundingClientRect();
      if (!frame || !win) return;
      setRects({
        frame: { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
        win: { left: win.left, top: win.top, width: win.width, height: win.height },
      });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const imgTransform = natural && rects ? computeImgTransform(crop, natural, rects.frame, rects.win) : null;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!natural || !rects || !imgTransform) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startLeft: imgTransform.left,
        startTop: imgTransform.top,
        natural,
        frame: rects.frame,
        win: rects.win,
      };
    },
    [natural, rects, imgTransform]
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const newLeft = drag.startLeft + (e.clientX - drag.startX);
    const newTop = drag.startTop + (e.clientY - drag.startY);
    setCrop((c) => ({ ...c, ...imgPosToCrop(newLeft, newTop, c.zoom, drag.natural, drag.frame, drag.win) }));
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setCrop((c) => ({ ...c, zoom: clamp(c.zoom - e.deltaY * 0.0015, MIN_ZOOM, MAX_ZOOM) }));
  }, []);

  async function handleSave() {
    setError(null);
    setSaving(true);
    const res = await onSave(crop);
    setSaving(false);
    if (res?.error) setError(res.error);
    else onClose();
  }

  const win = windowStyle(kind);

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 w-full max-w-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">Preview — {CROP_KIND_LABEL[kind]}</p>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-sm">
            Close
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          Drag or scroll anywhere below to pan and zoom. Everything dimmed is outside the visible area on the site.
        </p>

        <div
          ref={frameRef}
          className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-800 border border-zinc-700 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute top-0 left-0 select-none pointer-events-none"
            style={
              imgTransform && natural
                ? {
                    width: natural.w,
                    height: natural.h,
                    transformOrigin: "0 0",
                    transform: `translate(${imgTransform.left}px, ${imgTransform.top}px) scale(${imgTransform.scale})`,
                  }
                : { opacity: 0, width: 1, height: 1 }
            }
          />
          {/* window sizing anchor, invisible — used only to measure the real on-site box */}
          <div ref={windowRef} className="absolute pointer-events-none" style={win} />
          {/* Dim mask — transparent over the window's own box, its huge spread shadow covers everything else */}
          <div className="absolute pointer-events-none" style={{ ...win, boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)" }} />
          <div className="absolute pointer-events-none border-2 border-white/80" style={win} />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500 w-10">Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
            className="flex-1"
          />
          <button
            onClick={() => setCrop(DEFAULT_CROP)}
            className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            Reset
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
