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
    borderColor: `rgb(${mix(br, toWhite / 2)}, ${mix(bg, toWhite / 2)}, ${mix(bb, toWhite / 2)})`,
  };
}

export function TierGlow({
  glow,
  className,
  style,
  children,
}: {
  glow: GlowSpec | null;
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
      {children}
    </div>
  );
}
