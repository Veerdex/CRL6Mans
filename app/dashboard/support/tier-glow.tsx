"use client";

import { useEffect, useRef } from "react";

export type GlowSpec = {
  // The halo color. Kept separate from borderRgb because a border dark enough
  // to sit well against the fill is usually too dark to read as light.
  rgb: [number, number, number];
  borderRgb: [number, number, number];
  minBlur: number;
  maxBlur: number;
  minAlpha: number;
  maxAlpha: number;
  // How far toward white the glow drifts at full intensity. Light reads as
  // white at its brightest, so the colored halo alone never looks lit.
  white: number;
  // Whether the border rides the pulse too, or only the halo around it.
  borderPulse: boolean;
  // Cycles per second through the noise field. Low enough that the panel
  // breathes rather than flickers.
  speed: number;
  seed: number;
};

// Value noise rather than true Perlin: with fbm layered on top the two are
// indistinguishable at this scale, and this needs no gradient table.
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f);
  return hash(i) * (1 - t) + hash(i + 1) * t;
}

// Three octaves: the first sets the slow swell, the rest add the flicker that
// keeps it from reading as a sine wave.
function fbm(x: number): number {
  return valueNoise(x) * 0.6 + valueNoise(x * 2.3 + 11.7) * 0.3 + valueNoise(x * 4.7 + 31.3) * 0.1;
}

function shadowAt(glow: GlowSpec, t: number): { boxShadow: string; borderColor: string } {
  const toWhite = t * glow.white;
  const mix = (c: number, amount: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = glow.rgb;
  const [br, bg, bb] = glow.borderRgb;
  const blur = glow.minBlur + (glow.maxBlur - glow.minBlur) * t;
  const alpha = glow.minAlpha + (glow.maxAlpha - glow.minAlpha) * t;
  return {
    boxShadow: `0 0 ${blur.toFixed(1)}px ${(t * 2.5).toFixed(1)}px rgba(${mix(r, toWhite)}, ${mix(g, toWhite)}, ${mix(b, toWhite)}, ${alpha.toFixed(3)})`,
    // The border whitens at half the rate so the edge itself looks lit rather
    // than just the air around it, without losing the tier's color.
    borderColor: glow.borderPulse
      ? `rgb(${mix(br, toWhite / 2)}, ${mix(bg, toWhite / 2)}, ${mix(bb, toWhite / 2)})`
      : `rgb(${br}, ${bg}, ${bb})`,
  };
}


// A drifting 2D field of light across the panel: Perlin noise in x and y, with
// time as the third axis so the bright patches wander and dissolve into each
// other instead of sliding across as a fixed pattern.
export type FieldSpec = {
  rgb: [number, number, number];
  // Blobs across the panel's width. Low numbers read as a couple of broad
  // pools, high numbers as mottling.
  scale: number;
  // How fast the field moves through the third axis, in units per second.
  speed: number;
  maxAlpha: number;
  white: number;
  seed: number;
};

const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let state = 1337;
  for (let i = 255; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function grad(h: number, x: number, y: number, z: number): number {
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
  return (g & 1 ? -u : u) + (g & 2 ? -v : v);
}

function perlin3(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;
  return lerp(
    lerp(
      lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u),
      v,
    ),
    lerp(
      lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u),
      v,
    ),
    w,
  );
}

function fbm3(x: number, y: number, z: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < 3; i++) {
    sum += amp * perlin3(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

// Deliberately tiny. The browser's bilinear upscale to panel size is what makes
// the field smooth, and it costs nothing — computing this per screen pixel
// would be thousands of times the work for a blurrier result.
const FIELD_W = 56;
const FIELD_H = 28;

function NoiseField({ field }: { field: FieldSpec }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const image = ctx.createImageData(FIELD_W, FIELD_H);
    const data = image.data;
    const [r, g, b] = field.rgb;

    let raf = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 50) return;
      last = now;

      const z = (now / 1000) * field.speed + field.seed;
      for (let y = 0; y < FIELD_H; y++) {
        for (let x = 0; x < FIELD_W; x++) {
          const n = (fbm3((x / FIELD_W) * field.scale, (y / FIELD_H) * field.scale * 0.5, z) + 1) / 2;
          // fbm averages its octaves, so n only ever spans about 0.23-0.76 —
          // remapping against the range it actually occupies is what lets the
          // brightest patches reach full strength. The floor sits inside that
          // range so the panel keeps dark areas for the light to read against.
          const lit = Math.min(1, Math.max(0, (n - 0.4) / 0.36)) ** 1.4;
          const w = lit * field.white;
          const i = (y * FIELD_W + x) * 4;
          data[i] = r + (255 - r) * w;
          data[i + 1] = g + (255 - g) * w;
          data[i + 2] = b + (255 - b) * w;
          data[i + 3] = lit * field.maxAlpha * 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [field]);

  return (
    <canvas
      ref={canvasRef}
      width={FIELD_W}
      height={FIELD_H}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ mixBlendMode: "screen", filter: "blur(6px)" }}
    />
  );
}

export function TierGlow({
  glow,
  field,
  className,
  style,
  children,
}: {
  glow: GlowSpec | null;
  field?: FieldSpec | null;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const spec = useRef(glow);

  useEffect(() => {
    spec.current = glow;
  });

  useEffect(() => {
    if (!spec.current) return;
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // ~25fps. The drift is slow enough that a full 60 buys nothing and this
      // runs for as long as the page is open.
      if (now - last < 40) return;
      last = now;
      const s = spec.current!;
      const next = shadowAt(s, fbm((now / 1000) * s.speed + s.seed));
      el.style.boxShadow = next.boxShadow;
      el.style.borderColor = next.borderColor;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Server-rendered at mid intensity so the panel is already lit before
  // hydration rather than popping in.
  const initial = glow ? shadowAt(glow, 0.5) : null;

  return (
    <div ref={ref} className={className} style={{ ...style, ...(initial ?? {}) }}>
      {field && <NoiseField field={field} />}
      {children}
    </div>
  );
}
