"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinTournament, leaveTournament } from "./tournament-join-actions";
import { LocalTime } from "./local-time";
import { TrackerConfirmModal } from "./tracker-confirm-modal";
import { CountdownLabel } from "./countdown-label";
import { cropStyle } from "@/app/lib/media-crop";
import type { PublicSponsor } from "@/app/lib/sponsors-public";
import { formatPromoDescription } from "@/app/lib/sponsor-promo";

export function TournamentJoinCard({
  id,
  name,
  poolCount,
  joined: initialJoined,
  teamAssignment,
  timeline = [],
  countdown = null,
  prize1st = null,
  prize2nd = null,
  prize3rd4th = null,
  minMmr2v2,
  minMmr3v3,
  linkHref = null,
  sponsor = null,
}: {
  id: string;
  name: string;
  poolCount: number;
  joined: boolean;
  teamAssignment: "snake_draft" | "auto_balance" | null;
  timeline?: { label: string; iso: string }[];
  countdown?: { label: string; iso: string } | null;
  prize1st?: number | null;
  prize2nd?: number | null;
  prize3rd4th?: number | null;
  minMmr2v2?: number | null;
  minMmr3v3?: number | null;
  linkHref?: string | null;
  sponsor?: PublicSponsor | null;
}) {
  const router = useRouter();
  const totalPrizePool = (prize1st ?? 0) + (prize2nd ?? 0) + (prize3rd4th ?? 0) * 2;
  const backgroundUrl = sponsor?.background_image_url ?? null;
  const [joined, setJoined] = useState(initialJoined);
  const [count, setCount] = useState(poolCount);
  const [error, setError] = useState<string | null>(null);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [trackerStale, setTrackerStale] = useState(false);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    setError(null);
    setInviteRequired(false);
    setTrackerStale(false);
    startTransition(async () => {
      const res = joined ? await leaveTournament(id) : await joinTournament(id);
      if ("inviteRequired" in res && res.inviteRequired) { setInviteRequired(true); return; }
      if ("trackerStale" in res && res.trackerStale) { setTrackerStale(true); return; }
      if (res.error) { setError(res.error); return; }
      setJoined(!joined);
      setCount((c) => Math.max(0, c + (joined ? -1 : 1)));
    });
  };

  const confirmSameAndJoin = () => {
    setError(null);
    setTrackerStale(false);
    startTransition(async () => {
      const res = await joinTournament(id, true);
      if (res.error) { setError(res.error); return; }
      setJoined(true);
      setCount((c) => c + 1);
    });
  };

  return (
    <div
      onClick={linkHref ? () => router.push(linkHref) : undefined}
      className={`relative aspect-video overflow-hidden rounded-xl border transition-all duration-200 ${linkHref ? "cursor-pointer hover:-translate-y-1 hover:shadow-[0_10px_28px_-8px_rgba(232,138,36,0.4)]" : ""} ${
        backgroundUrl
          ? "border-zinc-700/50"
          : joined
            ? `bg-emerald-950/30 border-emerald-700/40 ${linkHref ? "hover:border-emerald-500/60" : ""}`
            : `bg-zinc-900 border-zinc-700/50 ${linkHref ? "hover:border-amber-500/50" : ""}`
      }`}
    >
      {backgroundUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={backgroundUrl}
            alt=""
            className="absolute inset-0 w-full h-full"
            style={cropStyle(sponsor?.content_crop?.background)}
          />
          <div className="absolute inset-0 bg-black/70" />
        </>
      )}
      <div className="relative h-full overflow-y-auto p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {sponsor?.logo_url && (
            <div className="relative w-9 h-9 rounded-lg border border-zinc-800 overflow-hidden shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sponsor.logo_url}
                alt={sponsor.name}
                className="absolute inset-0 w-full h-full"
                style={cropStyle(sponsor.content_crop?.logo)}
              />
            </div>
          )}
          <p className="text-3xl font-bold text-white truncate">{name}</p>
        </div>
        {sponsor?.promo_code && (
          <span className="inline-flex w-fit text-[13.5px] font-medium text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-0.5">
            {formatPromoDescription(sponsor.promo_description, sponsor.promo_code) ?? `Promo: ${sponsor.promo_code}`}
          </span>
        )}
        <span className="text-lg text-zinc-400">
          {count} in the pool · {teamAssignment === "auto_balance" ? "auto-balanced" : "snake draft"}
        </span>
        {countdown && <CountdownLabel label={countdown.label} iso={countdown.iso} />}
        {(minMmr2v2 || minMmr3v3) && (
          <span className="text-lg text-zinc-500">
            Req:{" "}
            {[minMmr2v2 ? `${minMmr2v2} 2v2` : null, minMmr3v3 ? `${minMmr3v3} 3v3` : null]
              .filter(Boolean).join(" or ")} peak MMR
          </span>
        )}
        {error && <span className="text-lg text-red-400">{error}</span>}
      </div>
      <div className="shrink-0 flex flex-col items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          disabled={isPending}
          className={`px-4 py-2 rounded-lg text-[21px] font-semibold transition-colors ${
            joined ? "bg-red-700 hover:bg-red-600 text-white" : "bg-emerald-600 hover:bg-emerald-500 text-white"
          }`}
        >
          {isPending ? "..." : joined ? "Leave" : "Join"}
        </button>
        <div className="flex flex-col items-center text-center bg-zinc-800/60 border border-amber-700/40 rounded-lg px-3 py-1.5 min-w-[100px]">
          <p className="text-[13.5px] uppercase tracking-wide text-zinc-500">Prize Pool</p>
          <p className="text-[21px] font-bold text-amber-400 tabular-nums">${totalPrizePool.toLocaleString()}</p>
          {totalPrizePool > 0 && (
            <div className="mt-1 text-[15px] text-zinc-400 space-y-0.5">
              <p>1st: <span className="text-zinc-200">${(prize1st ?? 0).toLocaleString()}</span></p>
              <p>2nd: <span className="text-zinc-200">${(prize2nd ?? 0).toLocaleString()}</span></p>
              <p>3rd-4th: <span className="text-zinc-200">${(prize3rd4th ?? 0).toLocaleString()}</span></p>
            </div>
          )}
        </div>
      </div>
      </div>
      {timeline.length > 0 && (
        <div className="relative flex flex-col gap-0.5 pt-1 border-t border-zinc-700/40">
          {timeline.map(({ label, iso }) => (
            <span key={label} className="text-[13.5px] text-zinc-500">
              {label}: <LocalTime iso={iso} className="text-zinc-400" />
            </span>
          ))}
        </div>
      )}
      {inviteRequired && (
        <div className="relative p-3 bg-indigo-950/60 border border-indigo-700/50 rounded-lg text-lg text-indigo-200 flex flex-col gap-1.5">
          <span className="font-semibold">You must be in the Discord server to join this tournament.</span>
          <a
            href={process.env.NEXT_PUBLIC_DISCORD_INVITE_URL?.trim() || "#"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 underline font-medium"
          >
            Join the server →
          </a>
        </div>
      )}
      <TrackerConfirmModal
        open={trackerStale}
        onConfirm={confirmSameAndJoin}
        onClose={() => setTrackerStale(false)}
        isPending={isPending}
      />
      </div>
    </div>
  );
}
