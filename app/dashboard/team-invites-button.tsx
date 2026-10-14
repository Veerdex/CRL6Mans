"use client";

import { useState, useTransition } from "react";
import { respondInvite } from "./team-signup-actions";
import { ModalShell } from "./mmr-confirm-panel";

// One list across every open team-formation tournament: an invite is something
// the player has, not something a particular card has, and the cards only show
// an invite to someone who isn't on a team in that event.
export type TeamInvite = {
  memberId: string;
  tournamentName: string;
  teamName: string;
  creatorName: string;
  canAccept: boolean;
  onTeam: boolean;
};

export function TeamInvitesButton({ invites }: { invites: TeamInvite[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 px-3 py-1.5 rounded-lg text-[16.5px] font-semibold transition-colors bg-blue-600 hover:bg-blue-500 text-white tabular-nums"
      >
        Invites ({invites.length})
      </button>
      {open && <InvitesModal invites={invites} onClose={() => setOpen(false)} />}
    </>
  );
}

function InvitesModal({ invites, onClose }: { invites: TeamInvite[]; onClose: () => void }) {
  const [note, setNote] = useState<{ msg: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const respond = (memberId: string, accept: boolean) =>
    startTransition(async () => {
      const res = await respondInvite(memberId, accept);
      setNote({ msg: res.error ?? res.message ?? "", ok: !res.error });
    });

  return (
    <ModalShell onClose={onClose} maxWidthClass="max-w-lg">
      <h2 className="text-base font-semibold text-white">Team invites</h2>

      {invites.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No invites right now. A captain has to invite you by name, so ask in Discord if
          you&apos;re expecting one.
        </p>
      ) : (
        <ul className="space-y-2">
          {invites.map((inv) => (
            <li
              key={inv.memberId}
              className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium text-white break-words">{inv.teamName}</span>
                <span className="text-zinc-500"> · {inv.creatorName}</span>
                <span className="block text-xs text-zinc-500">{inv.tournamentName}</span>
              </span>
              <button
                onClick={() => respond(inv.memberId, true)}
                disabled={isPending || !inv.canAccept || inv.onTeam}
                title={
                  inv.onTeam
                    ? "Leave your current team first."
                    : inv.canAccept
                      ? undefined
                      : "Registration is closed for this team."
                }
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                Accept
              </button>
              <button
                onClick={() => respond(inv.memberId, false)}
                disabled={isPending}
                className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 text-sm rounded-lg"
              >
                Decline
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Accepting while already on a team is refused server-side, so say which
          invites are only declinable rather than letting the press fail. */}
      {invites.some((i) => i.onTeam) && (
        <p className="text-xs text-zinc-500">
          You&apos;re already on a team, so these can only be declined until you leave it.
        </p>
      )}

      {note && <p className={`text-sm ${note.ok ? "text-emerald-400" : "text-red-400"}`}>{note.msg}</p>}

      <button
        onClick={onClose}
        disabled={isPending}
        className="w-full px-4 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors mt-1"
      >
        Close
      </button>
    </ModalShell>
  );
}
