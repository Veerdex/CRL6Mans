"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTeam,
  invitePlayer,
  revokeInvite,
  respondInvite,
  leaveTeam,
  disbandTeam,
} from "./team-signup-actions";
import type { TeamSignupView } from "./team-signup-data";
import { PlayerName } from "@/app/dashboard/player-name";
import { LocalTime } from "./local-time";
import { CountdownLabel } from "./countdown-label";
import { cropStyle, type MediaCrop } from "@/app/lib/media-crop";
import type { PublicSponsor } from "@/app/lib/sponsors-public";
import { formatPromoDescription } from "@/app/lib/sponsor-promo";

export function TeamSignupPanel({
  view,
  tournamentId,
  tournamentName,
  timeline = [],
  countdown = null,
  prize1st = null,
  prize2nd = null,
  prize3rd4th = null,
  linkHref = null,
  sponsor = null,
  fallbackBackgroundUrl = null,
  fallbackBackgroundCrop,
}: {
  view: TeamSignupView;
  tournamentId: string;
  tournamentName?: string;
  timeline?: { label: string; iso: string }[];
  countdown?: { label: string; iso: string } | null;
  prize1st?: number | null;
  prize2nd?: number | null;
  prize3rd4th?: number | null;
  linkHref?: string | null;
  sponsor?: PublicSponsor | null;
  fallbackBackgroundUrl?: string | null;
  fallbackBackgroundCrop?: MediaCrop;
}) {
  const router = useRouter();
  const totalPrizePool = (prize1st ?? 0) + (prize2nd ?? 0) + (prize3rd4th ?? 0) * 2;
  const backgroundUrl = sponsor?.background_image_url ?? fallbackBackgroundUrl ?? null;
  const { myTeam, incomingInvites, invitable, registrationOpen } = view;
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [inviteId, setInviteId] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  const flash = (msg: string | undefined, ok: boolean) => {
    setFeedback({ msg: msg ?? "", ok });
    setTimeout(() => setFeedback(null), 4000);
  };
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      flash(res.error ?? res.message, !res.error);
    });

  const acceptedCount = myTeam?.members.filter((m) => m.status === "accepted").length ?? 0;

  return (
    <div
      onClick={linkHref ? () => router.push(linkHref) : undefined}
      className={`relative aspect-video overflow-hidden border rounded-xl transition-all duration-200 ${
        backgroundUrl ? "border-indigo-800/40" : "bg-gradient-to-br from-indigo-950/40 to-zinc-900 border-indigo-800/40"
      } ${
        linkHref ? "cursor-pointer hover:-translate-y-1 hover:border-amber-500/50 hover:shadow-[0_10px_28px_-8px_rgba(232,138,36,0.4)]" : ""
      }`}
    >
      {backgroundUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={backgroundUrl}
            alt=""
            className="absolute inset-0 w-full h-full"
            style={cropStyle(sponsor?.content_crop?.background ?? fallbackBackgroundCrop)}
          />
          <div className="absolute inset-0 bg-black/70" />
        </>
      )}
      <div className="relative h-full overflow-y-auto p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[16.5px] font-semibold text-indigo-300 uppercase tracking-wider">
            Team Registration
          </p>
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
            {tournamentName && <p className="text-3xl font-bold text-white truncate">{tournamentName}</p>}
          </div>
          {sponsor?.promo_code && (
            <span className="inline-flex w-fit text-[13.5px] font-medium text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-0.5 mt-1">
              {formatPromoDescription(sponsor.promo_description, sponsor.promo_code) ?? `Promo: ${sponsor.promo_code}`}
            </span>
          )}
          <p className="text-[21px] text-zinc-400 mt-1">
            {registrationOpen
              ? "Form a team of 3 (plus an optional 4th as substitute)."
              : "Registration is closed."}
          </p>
          {countdown && <div className="mt-1"><CountdownLabel label={countdown.label} iso={countdown.iso} /></div>}
        </div>
        <div className="shrink-0 flex flex-col items-center text-center bg-zinc-800/60 border border-amber-700/40 rounded-lg px-3 py-1.5 min-w-[100px]">
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

      {/* Already on a team */}
      <div onClick={(e) => e.stopPropagation()} className="relative space-y-4">
      {myTeam ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-white">{myTeam.name}</span>
            <span className="text-lg text-zinc-500">{acceptedCount}/3 starters{acceptedCount > 3 ? " +sub" : ""}</span>
          </div>

          <ul className="space-y-1.5">
            {myTeam.members.map((m) => (
              <li key={m.memberId} className="flex items-center gap-2 text-[21px]">
                <span className="text-zinc-200"><PlayerName displayName={m.display_name ?? null} username={m.username} /></span>
                {m.isCreator && <span className="text-[15px] font-bold text-yellow-400">CAPTAIN</span>}
                {m.status === "invited" && (
                  <span className="text-[15px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">PENDING</span>
                )}
                {myTeam.isCreator && m.status === "invited" && registrationOpen && (
                  <button
                    onClick={() => run(() => revokeInvite(m.memberId))}
                    disabled={isPending}
                    className="ml-auto text-lg text-zinc-500 hover:text-red-400"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* Creator: invite */}
          {myTeam.isCreator && registrationOpen && myTeam.members.length < 4 && (
            <div className="flex gap-2 pt-1">
              <select
                value={inviteId}
                onChange={(e) => setInviteId(e.target.value)}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[21px] text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Invite a player…</option>
                {invitable.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name ?? p.username}</option>
                ))}
              </select>
              <button
                onClick={() => { if (inviteId) { run(() => invitePlayer(tournamentId, inviteId)); setInviteId(""); } }}
                disabled={isPending || !inviteId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[21px] font-medium rounded-lg transition-colors"
              >
                Invite
              </button>
            </div>
          )}

          {/* Leave / disband */}
          <div className="pt-1">
            {myTeam.isCreator ? (
              <button
                onClick={() => run(() => disbandTeam(tournamentId))}
                disabled={isPending}
                className="text-lg text-zinc-500 hover:text-red-400"
              >
                Disband team
              </button>
            ) : (
              <button
                onClick={() => run(() => leaveTeam(tournamentId))}
                disabled={isPending}
                className="text-lg text-zinc-500 hover:text-red-400"
              >
                Leave team
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Incoming invites */}
          {incomingInvites.length > 0 && (
            <div className="space-y-2">
              <p className="text-lg font-medium text-zinc-400">Invites</p>
              {incomingInvites.map((inv) => (
                <div key={inv.memberId} className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
                  <span className="text-[21px] text-zinc-200 flex-1">
                    <span className="font-medium text-white">{inv.teamName}</span>
                    <span className="text-zinc-500"> · {inv.creatorName}</span>
                  </span>
                  <button
                    onClick={() => run(() => respondInvite(inv.memberId, true))}
                    disabled={isPending || !registrationOpen}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-lg font-medium rounded-lg"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => run(() => respondInvite(inv.memberId, false))}
                    disabled={isPending}
                    className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-lg rounded-lg"
                  >
                    Decline
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Create a team */}
          {registrationOpen && (
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your team name"
                maxLength={30}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[21px] text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                onClick={() => { if (name.trim()) run(() => createTeam(tournamentId, name)); }}
                disabled={isPending || !name.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[21px] font-medium rounded-lg transition-colors"
              >
                Create team
              </button>
            </div>
          )}
        </div>
      )}
      </div>

      {feedback && (
        <p className={`relative text-[21px] ${feedback.ok ? "text-emerald-400" : "text-red-400"}`}>{feedback.msg}</p>
      )}

      {timeline.length > 0 && (
        <div className="relative flex flex-col gap-0.5 pt-1 border-t border-indigo-800/40">
          {timeline.map(({ label, iso }) => (
            <span key={label} className="text-[13.5px] text-zinc-500">
              {label}: <LocalTime iso={iso} className="text-zinc-400" />
            </span>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
