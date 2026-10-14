"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTeam,
  invitePlayer,
  renameTeam,
  revokeInvite,
  respondInvite,
  leaveTeam,
  disbandTeam,
} from "./team-signup-actions";
import type { TeamSignupView } from "./team-signup-data";
import { PlayerName } from "@/app/dashboard/player-name";
import { LocalTime } from "./local-time";
import type { TimelineItem } from "@/app/lib/tournament-timeline";
import { CountdownLabel } from "./countdown-label";
import { cropStyle, type MediaCrop } from "@/app/lib/media-crop";
import type { PublicSponsor } from "@/app/lib/sponsors-public";
import { formatPromoDescription } from "@/app/lib/sponsor-promo";
import { ModalShell } from "./mmr-confirm-panel";

export function TeamSignupPanel({
  view,
  tournamentId,
  tournamentName,
  teamSize = 3,
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
  teamSize?: number;
  timeline?: TimelineItem[];
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
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);

  const flash = (msg: string | undefined, ok: boolean) => {
    setFeedback({ msg: msg ?? "", ok });
    setTimeout(() => setFeedback(null), 4000);
  };
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      flash(res.error ?? res.message, !res.error);
    });

  return (
    <div
      onClick={linkHref ? () => router.push(linkHref) : undefined}
      className={`relative aspect-video overflow-hidden border rounded-xl transition-all duration-200 ${
        backgroundUrl ? "border-indigo-800/40" : "bg-gradient-to-tr from-[#744512] to-[#1c1b56] border-indigo-800/40"
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
            {tournamentName && <p className="text-xl sm:text-2xl md:text-3xl font-bold text-white leading-tight break-words">{tournamentName}</p>}
          </div>
          {sponsor?.promo_code && (
            <span className="inline-flex w-fit text-[13.5px] font-medium text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-0.5 mt-1">
              {formatPromoDescription(sponsor.promo_description, sponsor.promo_code) ?? `Promo: ${sponsor.promo_code}`}
            </span>
          )}
          <p className="text-[21px] text-zinc-400 mt-1">
            {registrationOpen || incomingInvites.some((i) => i.canAccept)
              ? `Form a team of ${teamSize} (plus an optional extra as substitute).`
              : "Registration is closed."}
          </p>
          {countdown && <div className="mt-1"><CountdownLabel label={countdown.label} iso={countdown.iso} /></div>}
        </div>
        <div className="shrink-0 flex flex-col items-center gap-2">
        <span className="px-2 py-0.5 rounded-md bg-zinc-800/70 border border-zinc-600/50 text-[13.5px] font-semibold tracking-wide text-zinc-300 tabular-nums whitespace-nowrap">
          {teamSize}v{teamSize}
        </span>
        {/* Stands where TournamentJoinCard's Join button does, so both join modes
            read the same on the card. The card itself navigates on click and this
            rail is outside the stopPropagation wrapper below, so the button has to
            stop its own. */}
        {!myTeam && registrationOpen && (
          <button
            onClick={(e) => { e.stopPropagation(); setCreateOpen(true); }}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-[21px] font-semibold transition-colors bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            Join
          </button>
        )}
        {/* Deliberately not gated on registrationOpen: with the roster moved
            into the popup, this is the only way to see your own team on the
            card once the window shuts. */}
        {myTeam && (
          <button
            onClick={(e) => { e.stopPropagation(); setTeamOpen(true); }}
            className="px-4 py-2 rounded-lg text-[21px] font-semibold transition-colors bg-blue-600 hover:bg-blue-500 text-white"
          >
            Team
          </button>
        )}
        <div className="flex flex-col items-center text-center bg-zinc-800/60 border border-amber-700/40 rounded-lg px-3 py-1.5 min-w-[90px]">
          <p className="text-[11.25px] uppercase tracking-wide text-zinc-500">Prize Pool</p>
          <p className="text-[20.25px] font-bold text-amber-400 tabular-nums">${totalPrizePool.toLocaleString()}</p>
          {totalPrizePool > 0 && (
            <div className="mt-1 text-[12.375px] text-zinc-400 space-y-0.5">
              <p>1st: <span className="text-zinc-200">${(prize1st ?? 0).toLocaleString()}</span></p>
              <p>2nd: <span className="text-zinc-200">${(prize2nd ?? 0).toLocaleString()}</span></p>
              <p>3rd-4th: <span className="text-zinc-200">${(prize3rd4th ?? 0).toLocaleString()}</span></p>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* The roster, invites out and leaving all live in the Team popup now —
          the card carries nothing but the button that opens it. Invites *in*
          stay here: hiding one behind a button the player may never press
          would lose it. */}
      {!myTeam && (
        <div onClick={(e) => e.stopPropagation()} className="relative space-y-4">
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
                    disabled={isPending || !inv.canAccept}
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

          {!registrationOpen && incomingInvites.length === 0 && (
            <p className="text-[21px] text-zinc-500">Team registration is closed.</p>
          )}
        </div>
      )}

      {createOpen && (
        <CreateTeamModal
          tournamentId={tournamentId}
          teamSize={teamSize}
          onClose={() => setCreateOpen(false)}
          onCreated={(msg) => { setCreateOpen(false); flash(msg, true); }}
        />
      )}

      {/* `myTeam` in the condition, not just `teamOpen`: a successful Leave
          revalidates it to null, which is what dismisses the popup. */}
      {teamOpen && myTeam && (
        <TeamModal
          tournamentId={tournamentId}
          teamSize={teamSize}
          team={myTeam}
          invitable={invitable}
          registrationOpen={registrationOpen}
          onClose={() => setTeamOpen(false)}
          onLeft={(msg) => { setTeamOpen(false); flash(msg, true); }}
        />
      )}

      {feedback && (
        <p className={`relative text-[21px] ${feedback.ok ? "text-emerald-400" : "text-red-400"}`}>{feedback.msg}</p>
      )}

      {timeline.length > 0 && (
        <div className="relative flex flex-col gap-0.5 pt-1 border-t border-indigo-800/40">
          {timeline.map(({ label, iso, est }) => (
            <span key={label} className="text-[13.5px] text-zinc-500">
              {label}: <LocalTime iso={iso} upcoming suffix={est ? " (est.)" : undefined} className="text-zinc-400" />
            </span>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

// The Join button's popup. Portaled by ModalShell, which the card needs: the card
// clips its children (overflow-hidden) and navigates on click, and a portal keeps
// the dialog out of both. Its own error state matters too — the card's feedback
// line sits behind the backdrop, so a rejected name has to report in here.
function CreateTeamModal({
  tournamentId,
  teamSize,
  onClose,
  onCreated,
}: {
  tournamentId: string;
  teamSize: number;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createTeam(tournamentId, name);
      if (res.error) { setError(res.error); return; }
      onCreated(res.message ?? "Team created.");
    });
  };

  return (
    <ModalShell onClose={onClose} maxWidthClass="max-w-lg">
      <h2 className="text-base font-semibold text-white">Create your team</h2>
      <p className="text-sm text-zinc-400">
        You&apos;ll be captain. Name the team, then invite {teamSize - 1 > 0 ? `${teamSize - 1} more player${teamSize - 1 === 1 ? "" : "s"}` : "an optional substitute"} to
        fill the roster — the team only enters once it&apos;s full.
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="Your team name"
        maxLength={30}
        autoFocus
        className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-col gap-2 mt-1">
        <button
          onClick={submit}
          disabled={isPending || !name.trim()}
          className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {isPending ? "Creating…" : "Create team"}
        </button>
        <button
          onClick={onClose}
          disabled={isPending}
          className="w-full px-4 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}

// What the Team button opens: the whole roster, and everything a member can do
// to it. `team`, `invitable` and `registrationOpen` come from the panel's live
// props rather than a copy taken at open time, so every action's
// revalidatePath redraws the popup in place.
function TeamModal({
  tournamentId,
  teamSize,
  team,
  invitable,
  registrationOpen,
  onClose,
  onLeft,
}: {
  tournamentId: string;
  teamSize: number;
  team: NonNullable<TeamSignupView["myTeam"]>;
  invitable: TeamSignupView["invitable"];
  registrationOpen: boolean;
  onClose: () => void;
  onLeft: (message: string) => void;
}) {
  const [inviteId, setInviteId] = useState("");
  const [name, setName] = useState(team.name);
  const [note, setNote] = useState<{ msg: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const acceptedCount = team.members.filter((m) => m.status === "accepted").length;
  const rosterMax = teamSize + 1;
  const canEdit = team.isCreator && registrationOpen;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      setNote({ msg: res.error ?? res.message ?? "", ok: !res.error });
    });

  // Leaving reports on the card instead: the popup it would report in is the
  // thing that disappears.
  const leave = (fn: () => Promise<{ error?: string; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) { setNote({ msg: res.error, ok: false }); return; }
      onLeft(res.message ?? "You left the team.");
    });

  return (
    <ModalShell onClose={onClose} maxWidthClass="max-w-lg">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-white break-words">{team.name}</h2>
        <span className="text-xs text-zinc-500 tabular-nums shrink-0">
          {acceptedCount}/{teamSize} starters{acceptedCount > teamSize ? " +sub" : ""}
        </span>
      </div>

      {canEdit && (
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim() !== team.name) run(() => renameTeam(tournamentId, name)); }}
            placeholder="Team name"
            maxLength={30}
            aria-label="Team name"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={() => run(() => renameTeam(tournamentId, name))}
            disabled={isPending || !name.trim() || name.trim() === team.name}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 text-sm font-medium rounded-lg transition-colors"
          >
            Rename
          </button>
        </div>
      )}

      <ul className="space-y-1.5">
        {team.members.map((m) => (
          <li key={m.memberId} className="flex items-center gap-2 text-sm">
            <span className="text-zinc-200">
              <PlayerName displayName={m.display_name ?? null} username={m.username} discordId={m.discord_id} />
            </span>
            {m.isCreator && <span className="text-[11px] font-bold text-yellow-400">CAPTAIN</span>}
            {m.status === "invited" && (
              <span className="text-[11px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">PENDING</span>
            )}
            {canEdit && m.status === "invited" && (
              <button
                onClick={() => run(() => revokeInvite(m.memberId))}
                disabled={isPending}
                className="ml-auto text-xs text-zinc-500 hover:text-red-400"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>

      {canEdit && team.members.length < rosterMax && (
        <div className="flex gap-2">
          <select
            value={inviteId}
            onChange={(e) => setInviteId(e.target.value)}
            aria-label="Invite a player"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Invite a player…</option>
            {invitable.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name ?? p.username}</option>
            ))}
          </select>
          <button
            onClick={() => { if (inviteId) { run(() => invitePlayer(tournamentId, inviteId)); setInviteId(""); } }}
            disabled={isPending || !inviteId}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Invite
          </button>
        </div>
      )}

      {note && <p className={`text-sm ${note.ok ? "text-emerald-400" : "text-red-400"}`}>{note.msg}</p>}

      <div className="flex flex-col gap-2 mt-1">
        <button
          onClick={() => leave(() => leaveTeam(tournamentId))}
          disabled={isPending}
          className="w-full px-4 py-2 bg-red-900/40 hover:bg-red-900/60 border border-red-800/60 disabled:opacity-50 text-red-300 text-sm font-semibold rounded-lg transition-colors"
        >
          Leave team
        </button>
        {team.isCreator && (
          <button
            onClick={() => leave(() => disbandTeam(tournamentId))}
            disabled={isPending}
            className="w-full text-xs text-zinc-600 hover:text-red-400 transition-colors"
          >
            Disband the team instead
          </button>
        )}
        <button
          onClick={onClose}
          disabled={isPending}
          className="w-full px-4 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
        >
          Close
        </button>
      </div>
    </ModalShell>
  );
}
