export const PODIUM_HREF = "/dashboard/podium";

type LeafLike = { href: string; label: string; icon: React.ReactNode };

// Applied to the outer Link/button of the Podium tab wherever it renders —
// a slow breathing glow ring on the whole pill.
export const podiumTabClass = "podium-tab-glow";

// Applied alongside the label text.
export const podiumLabelClass = "text-amber-300 [text-shadow:0_0_8px_rgba(251,191,36,0.65)]";

const SPARKS = [
  { left: "15%", delay: "0s", duration: "2.6s", size: 2 },
  { left: "55%", delay: "0.9s", duration: "2.2s", size: 1.5 },
  { left: "80%", delay: "1.6s", duration: "2.8s", size: 2 },
];

// Minimal glow + a few tiny rising sparks around a nav icon — used only on
// the Podium tab so it visually stands out and draws players toward it.
// No randomness, so it renders identically from a server component
// (dashboard/layout.tsx builds the icons) or a client one.
export function PodiumGlowIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: 18, height: 18 }}>
      <span
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: -6,
          background: "radial-gradient(circle, rgba(251,191,36,0.9) 0%, transparent 70%)",
          filter: "blur(4px)",
          animation: "nav-glow-pulse 2.2s ease-in-out infinite",
        }}
      />
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: s.left,
            bottom: -1,
            width: s.size,
            height: s.size,
            background: "#fde68a",
            boxShadow: "0 0 4px 1px rgba(253,230,138,0.9)",
            animation: `nav-spark ${s.duration} ${s.delay} ease-out infinite backwards`,
          }}
        />
      ))}
      <span className="relative z-10 text-amber-400">{children}</span>
    </span>
  );
}

// Drop-in replacement for `{item.icon}{item.label}` — glows only when the
// item is the Podium tab, renders unchanged everywhere else.
export function NavLeafContent({ item }: { item: LeafLike }) {
  if (item.href !== PODIUM_HREF) {
    return <>{item.icon}{item.label}</>;
  }
  return (
    <>
      <PodiumGlowIcon>{item.icon}</PodiumGlowIcon>
      <span className={podiumLabelClass}>{item.label}</span>
    </>
  );
}
