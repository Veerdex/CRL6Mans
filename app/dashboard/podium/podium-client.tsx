"use client";

import { useEffect, useState } from "react";

const CONFETTI_COLORS = [
  "#e88a24", "#fbbf24", "#fde68a",
  "#3736ac", "#6366f1", "#a78bfa",
  "#ffffff", "#f472b6",
];

type Star = { left: number; top: number; size: number; delay: number; duration: number };
type Piece = {
  id: number; color: string; left: number; delay: number;
  duration: number; size: number; rotate: number; circle: boolean;
};
type Ember = {
  left: number; bottom: number; size: number; delay: number;
  duration: number; drift: number; bright: boolean;
};

export type RichPlayer = {
  id: string | null;
  username: string;
  displayName: string | null;
  discordId: string | null;
  avatar: string | null;
};

export type Accolade = {
  label: string;
  playerName: string;
  value: string;
  isMvp: boolean;
};

export type PodiumClientProps = {
  eventTitle: string;
  eventKind: "season" | "tournament";
  eventDate: string | null;
  champion: string;
  championLogoUrl: string | null;
  players: RichPlayer[];
  mvpPlayerId: string | null;
  accolades: Accolade[];
};

function playerAvatarUrl(p: RichPlayer): string {
  if (p.discordId && p.avatar)
    return `https://cdn.discordapp.com/avatars/${p.discordId}/${p.avatar}.png?size=128`;
  return "https://cdn.discordapp.com/embed/avatars/0.png";
}

function Starfield() {
  const [stars, setStars] = useState<Star[]>([]);
  useEffect(() => {
    setStars(
      Array.from({ length: 45 }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 1 + Math.random() * 3,
        delay: Math.random() * 5,
        duration: 3 + Math.random() * 5,
      }))
    );
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {stars.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            borderRadius: "50%",
            backgroundColor: "#fbbf24",
            animation: `star-twinkle ${s.duration}s ${s.delay}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
  );
}

function ConfettiBurst() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    setPieces(
      Array.from({ length: 80 }, (_, i) => ({
        id: i,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        left: 5 + Math.random() * 90,
        delay: Math.random() * 1.4,
        duration: 2.5 + Math.random() * 2.5,
        size: 6 + Math.random() * 10,
        rotate: Math.random() * 360,
        circle: Math.random() > 0.55,
      }))
    );
    const t = setTimeout(() => setGone(true), 6000);
    return () => clearTimeout(t);
  }, []);

  if (gone || pieces.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
      {pieces.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.left}%`,
            top: "-16px",
            width: p.size,
            height: p.circle ? p.size : p.size * 0.38,
            backgroundColor: p.color,
            borderRadius: p.circle ? "50%" : "2px",
            transform: `rotate(${p.rotate}deg)`,
            animation: `confetti-fall ${p.duration}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}

// Continuous sparks rising from the champion logo — unlike the one-shot
// confetti burst, this loops forever so the trophy always feels "alive".
function EmberParticles() {
  const [embers, setEmbers] = useState<Ember[]>([]);
  useEffect(() => {
    setEmbers(
      Array.from({ length: 28 }, () => ({
        left: 8 + Math.random() * 84,
        bottom: Math.random() * 18,
        size: 2 + Math.random() * 4,
        delay: Math.random() * 4.5,
        duration: 2.75 + Math.random() * 2.5,
        drift: (Math.random() - 0.5) * 70,
        bright: Math.random() > 0.7,
      }))
    );
  }, []);

  return (
    <div className="absolute inset-0 z-20 pointer-events-none overflow-visible">
      {embers.map((e, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${e.left}%`,
            bottom: `${e.bottom}%`,
            width: e.size,
            height: e.size,
            borderRadius: "50%",
            backgroundColor: e.bright ? "#fff7ed" : "#fbbf24",
            boxShadow: e.bright
              ? "0 0 7px 2px rgba(255,255,255,0.9)"
              : "0 0 9px 3px rgba(251,191,36,0.85)",
            "--drift": `${e.drift}px`,
            animation: `ember-rise ${e.duration}s ${e.delay}s ease-out infinite backwards`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function AccoladeRow({ a, index }: { a: Accolade; index: number }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border ${
        a.isMvp
          ? "bg-amber-950/40 border-amber-700/40 px-4 py-3"
          : "bg-zinc-900 border-zinc-800 px-3.5 py-2.5"
      }`}
      style={{ animation: `fade-up 0.45s ${0.2 + index * 0.1}s ease-out both` }}
    >
      <div className="min-w-0">
        <p
          className={`font-bold uppercase tracking-wide ${
            a.isMvp ? "text-base text-amber-300" : "text-[11px] text-zinc-400"
          }`}
        >
          {a.label}
        </p>
        <p className={`text-zinc-500 tabular-nums ${a.isMvp ? "text-xs" : "text-[10px]"}`}>{a.value}</p>
      </div>
      <p
        className={`font-bold text-white text-right truncate ${a.isMvp ? "text-lg" : "text-sm"}`}
      >
        {a.playerName}
      </p>
    </div>
  );
}

function AccoladeList({ accolades }: { accolades: Accolade[] }) {
  return (
    <>
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Accolades</p>
      {accolades.map((a, i) => (
        <AccoladeRow key={a.label} a={a} index={i} />
      ))}
    </>
  );
}

export function PodiumClient({
  eventTitle,
  eventKind,
  eventDate,
  champion,
  championLogoUrl,
  players,
  mvpPlayerId,
  accolades,
}: PodiumClientProps) {
  const dateStr = eventDate
    ? new Date(eventDate).toLocaleDateString(undefined, { dateStyle: "long" })
    : null;

  return (
    <>
      <Starfield />
      <ConfettiBurst />

      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(234,138,36,0.08) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 flex flex-col min-h-[calc(100svh-56px)] lg:min-h-screen">

        {/* Title — full width, pinned to top */}
        <div
          className="flex flex-col items-center gap-2 pt-8 sm:pt-10 px-6 text-center"
          style={{ animation: "fade-up 0.5s ease-out both" }}
        >
          <h1
            className="text-4xl sm:text-6xl lg:text-7xl font-extrabold leading-tight"
            style={{ textShadow: "0 0 48px rgba(234,138,36,0.5)" }}
          >
            {eventTitle}
          </h1>
          <div className="flex items-center gap-3">
            <span
              className={`text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border ${
                eventKind === "season"
                  ? "bg-amber-900/40 border-amber-700/50 text-amber-300"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}
            >
              {eventKind}
            </span>
            {dateStr && <span className="text-sm text-zinc-500">{dateStr}</span>}
          </div>
        </div>

        {/* Main body: centered champion + roster, accolades floated right (desktop) */}
        <div className="relative flex-1 flex min-h-0">

          {/* Champion column — centered on the full width */}
          <div
            className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-6"
            style={{ animation: "fade-up 0.65s 0.1s ease-out both" }}
          >
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-amber-400">Champion</p>
            <p className="text-3xl sm:text-5xl font-bold text-white">{champion}</p>

            {/* Logo with pulsing glow halo + continuous ember particles */}
            <div className="relative flex items-center justify-center mt-2">
              <div
                className="absolute rounded-3xl"
                style={{
                  inset: "-20px",
                  background: "radial-gradient(circle, rgba(234,138,36,0.55) 0%, transparent 70%)",
                  filter: "blur(20px)",
                  animation: "logo-glow-pulse 3s ease-in-out infinite",
                }}
              />
              <div
                className="absolute rounded-3xl"
                style={{
                  inset: "-8px",
                  background: "radial-gradient(circle, rgba(253,230,138,0.6) 0%, transparent 65%)",
                  filter: "blur(10px)",
                  animation: "logo-glow-flare 1.6s ease-in-out infinite",
                }}
              />
              <EmberParticles />
              {championLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={championLogoUrl}
                  alt={champion}
                  className="relative z-10 w-[19.5rem] h-[19.5rem] sm:w-[27rem] sm:h-[27rem] lg:w-[30rem] lg:h-[30rem] rounded-3xl object-cover ring-4 ring-amber-500/50 shadow-2xl"
                />
              ) : (
                <div className="relative z-10 w-[19.5rem] h-[19.5rem] sm:w-[27rem] sm:h-[27rem] lg:w-[30rem] lg:h-[30rem] rounded-3xl bg-zinc-800 border border-zinc-700 flex items-center justify-center ring-4 ring-amber-500/20">
                  <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600">
                    <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/>
                    <path d="M5 4H3v2a3 3 0 0 0 3 3M19 4h2v2a3 3 0 0 1-3 3"/>
                  </svg>
                </div>
              )}
            </div>

            {/* Roster — stacked cards below the logo: icon left, nickname right */}
            {players.length > 0 && (
              <div className="flex flex-col gap-4 w-full max-w-sm mt-8">
                {players.map((p, i) => {
                  const isMvp = !!p.id && p.id === mvpPlayerId;
                  return (
                    <div
                      key={p.username}
                      className={`flex items-center gap-4 rounded-xl border px-4 py-4 ${
                        isMvp
                          ? "bg-amber-950/40 border-amber-700/40"
                          : "bg-zinc-900 border-zinc-800"
                      }`}
                      style={{ animation: `fade-up 0.5s ${0.35 + i * 0.12}s ease-out both` }}
                    >
                      <div className="relative flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={playerAvatarUrl(p)}
                          alt={p.displayName ?? p.username}
                          className={`w-16 h-16 rounded-full object-cover ${
                            isMvp
                              ? "ring-2 ring-amber-400 shadow-[0_0_16px_rgba(234,138,36,0.55)]"
                              : "ring-2 ring-zinc-700"
                          }`}
                        />
                        {isMvp && (
                          <span className="absolute -top-2 -right-2 bg-amber-400 text-black text-[11px] font-black uppercase tracking-wide px-2 py-1 rounded-full shadow leading-none">
                            MVP
                          </span>
                        )}
                      </div>
                      <span className="text-lg font-semibold text-white truncate">
                        {p.displayName ?? p.username}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Accolades — desktop: floated on the right, vertically centered */}
          {accolades.length > 0 && (
            <div className="hidden lg:flex flex-col absolute right-5 top-1/2 -translate-y-1/2 w-72 max-h-[85%] gap-2.5 overflow-y-auto">
              <AccoladeList accolades={accolades} />
            </div>
          )}
        </div>

        {/* Accolades — mobile: below the roster */}
        {accolades.length > 0 && (
          <div className="lg:hidden flex flex-col gap-2.5 w-full max-w-sm mx-auto px-6 pb-10">
            <AccoladeList accolades={accolades} />
          </div>
        )}

      </div>
    </>
  );
}
