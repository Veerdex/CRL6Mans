"use client";

import { useEffect, useState } from "react";
import type { PublicLeagueStats } from "@/app/lib/public-league-stats";
import { loadPublicLeagueStats } from "./stats-actions";

const n = (value: number) => value.toLocaleString("en-US");

export function LeagueStatsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-2 w-full py-2 px-4 text-sm font-medium text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
      League stats
    </button>
  );
}

function Tile({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-3 text-center">
      <p className="text-2xl font-bold text-white tabular-nums leading-tight">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      {note && <p className="mt-0.5 text-[10px] text-zinc-500">{note}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Body({ stats }: { stats: PublicLeagueStats }) {
  const { scoreboard: sb, latestSeason, firstSeasonYear, sixMans } = stats;
  const since = firstSeasonYear ? `Since ${firstSeasonYear}` : undefined;

  return (
    <div className="space-y-7">
      <Section title="The league" subtitle={since ? `${since} — four seasons of Summer League` : undefined}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <Tile value={n(stats.seasons)} label="Seasons" note={firstSeasonYear ? `since ${firstSeasonYear}` : undefined} />
          <Tile value={n(stats.playersAllTime)} label="Players all-time" />
          {latestSeason && (
            <Tile value={n(latestSeason.teams)} label="Teams" note={`${latestSeason.year} season`} />
          )}
          <Tile value={`$${n(stats.prizePool)}`} label="Prize money" />
          {stats.discordMembers !== null && (
            <Tile value={n(stats.discordMembers)} label="Discord members" />
          )}
        </div>
      </Section>

      <Section title="All-time scoreboard" subtitle={since ? `${since}, across every season` : undefined}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <Tile value={n(sb.goals)} label="Goals" />
          <Tile value={n(sb.assists)} label="Assists" />
          <Tile value={n(sb.saves)} label="Saves" />
          <Tile value={n(sb.shots)} label="Shots" />
          <Tile
            value={n(sb.demos)}
            label="Demos"
            note={stats.demosTrackedFrom ? `tracked from ${stats.demosTrackedFrom}` : undefined}
          />
          <Tile value={n(sb.games)} label="Games played" />
        </div>
      </Section>

      {sixMans && (
        <Section title="Private 6mans queue" subtitle="Ranked pickup games run in our Discord">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <Tile value={n(sixMans.players)} label="Players" />
            <Tile value={n(sixMans.series)} label="Series played" />
          </div>
        </Section>
      )}
    </div>
  );
}

export function LeagueStatsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stats, setStats] = useState<PublicLeagueStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || stats || failed) return;
    let live = true;
    loadPublicLeagueStats()
      .then(s => { if (live) setStats(s); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, stats, failed]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // Translucent rather than opaque, and the montage iframe is never touched,
    // so the video keeps playing behind the panel.
    <div
      onClick={onClose}
      className="fixed inset-0 z-[3] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="league-stats-title"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 sm:p-8 bg-zinc-900/95 border border-zinc-800 rounded-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 p-1.5 text-zinc-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <h2 id="league-stats-title" className="text-xl font-bold text-white pr-10">
          By the numbers
        </h2>

        <div className="mt-6">
          {stats ? (
            <Body stats={stats} />
          ) : failed ? (
            <p className="text-sm text-zinc-400">Stats are unavailable right now. Try again shortly.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-[76px] rounded-xl bg-white/5 border border-white/10 animate-pulse" />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
