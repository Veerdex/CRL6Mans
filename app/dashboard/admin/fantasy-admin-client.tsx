"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FANTASY_LEAGUE_NAME_MAX, isClosedLeague, type FantasyLeagueStatus } from "@/app/lib/fantasy-rules";
import { OpenSeasonForm, StartDraftsButton } from "../fantasy/fantasy-client";
import { StatusBadge } from "../fantasy/status-badge";
import { PlayerName } from "../player-name";
import { setFantasyTradesEnabled } from "../fantasy/actions";
import { setNavTabOverride } from "./sponsor-actions";
import { staffDeleteLeague, staffRemoveManager, staffRenameLeague, staffTransferOwnership } from "./fantasy-actions";

export type AdminManager = {
  accountId: string;
  name: string;
  username: string;
  discordId: string | null;
  isOwner: boolean;
  orphaned: boolean;
};

export type AdminLeague = {
  id: string;
  name: string;
  status: FantasyLeagueStatus;
  visibility: "public" | "private";
  managers: AdminManager[];
  warnings: string[];
};

type Gate = { label: string; ok: boolean };

const BTN = "rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50";
const NEUTRAL = `${BTN} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`;
const DANGER = `${BTN} bg-red-700 text-on-accent hover:bg-red-600`;
const CARD = "bg-zinc-800 border border-zinc-700 rounded-xl p-4";

/** Runs a server action, shows its error, and redraws the page when it succeeds. */
function useAdminAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, onDone?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        onDone?.();
        router.refresh();
      }
    });
  };
  return { error, pending, run };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="text-xs text-red-300 mt-1">{error}</p> : null;
}

export function FantasyAdminClient({
  season,
  openToAll,
  tradesOn,
  cap,
  gates,
  testRun,
  leagues,
}: {
  season: { id: string; name: string; status: string } | null;
  openToAll: boolean;
  tradesOn: boolean;
  cap: number;
  gates: Gate[] | null;
  testRun: boolean;
  leagues: AdminLeague[];
}) {
  const seasonOver = !season || season.status === "ended" || season.status === "complete" || season.status === "cancelled";
  return (
    <div className="space-y-6">
      <section className={`${CARD} space-y-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">Season</h3>
          <span className="text-sm text-zinc-300">
            {season ? (
              <>
                {season.name} · <strong className="text-zinc-100">{SEASON_STATUS_LABEL[season.status] ?? season.status}</strong>
              </>
            ) : (
              "None open"
            )}
          </span>
        </div>

        {season?.status === "open" && gates && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">
              Leagues form while the season is open. Start the drafts once the real season draft is done and before Round 1.
            </p>
            <ul className="space-y-1">
              {gates.map((g) => (
                <li key={g.label} className="flex items-center gap-2 text-sm">
                  <span className={g.ok ? "text-emerald-400" : "text-red-400"} aria-hidden>
                    {g.ok ? "✓" : "✗"}
                  </span>
                  <span className={g.ok ? "text-zinc-300" : "text-zinc-100"}>{g.label}</span>
                </li>
              ))}
            </ul>
            {testRun && (
              <p className="text-xs text-amber-200 bg-amber-900/30 border border-amber-800/60 rounded-lg px-3 py-2">
                A test event is running, so this would be a test run: only leagues made entirely of staff and test accounts
                draft, and everything rolls back when the test ends.
              </p>
            )}
            {gates.every((g) => g.ok) ? (
              <div className="flex justify-center">
                <StartDraftsButton />
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Start drafts unlocks once every check passes.</p>
            )}
          </div>
        )}
        {season?.status === "drafting" && <p className="text-xs text-zinc-400">Drafts are running. The real season can start once every draft finishes.</p>}
        {season?.status === "active" && <p className="text-xs text-zinc-400">The season is being played. It ends with the real event.</p>}
        {season?.status === "ended" && (
          <p className="text-xs text-zinc-400">The season is over. Final results go out once the event&apos;s archive is exported.</p>
        )}
        {seasonOver && (
          <div className="flex justify-center">
            <OpenSeasonForm />
          </div>
        )}
      </section>

      <section className={`${CARD} space-y-4`}>
        <h3 className="text-sm font-semibold text-zinc-100">Switches</h3>
        <VisibilitySwitch openToAll={openToAll} />
        <TradesSwitch enabled={tradesOn} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-100">
          Leagues <span className="text-zinc-500 font-normal">({leagues.length})</span>
        </h3>
        {leagues.length === 0 ? (
          <p className="text-sm text-zinc-500">{season ? "No leagues this season yet." : "No fantasy season."}</p>
        ) : (
          leagues.map((l) => <LeagueCard key={l.id} league={l} cap={cap} />)
        )}
      </section>
    </div>
  );
}

const SEASON_STATUS_LABEL: Record<string, string> = {
  open: "Open for leagues",
  drafting: "Drafting",
  active: "In season",
  ended: "Final",
  complete: "Complete",
  cancelled: "Cancelled",
};

function VisibilitySwitch({ openToAll }: { openToAll: boolean }) {
  const { error, pending, run } = useAdminAction();
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-300">
          Fantasy is{" "}
          <strong className={openToAll ? "text-emerald-400" : "text-zinc-100"}>{openToAll ? "open to everyone" : "staff only"}</strong>
          <p className="text-xs text-zinc-500">
            {openToAll
              ? "Every approved player sees the tab and can create or join a league."
              : "Only staff can see the tab or open a fantasy page."}
          </p>
        </div>
        <button
          className={NEUTRAL}
          disabled={pending}
          onClick={() => run(() => setNavTabOverride("fantasy", openToAll ? "auto" : "shown"))}
        >
          {openToAll ? "Hide from players" : "Open to everyone"}
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function TradesSwitch({ enabled }: { enabled: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const { error, pending, run } = useAdminAction();
  const flip = () => run(() => setFantasyTradesEnabled(!enabled), () => setConfirming(false));
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-300">
          Trades are <strong className={enabled ? "text-emerald-400" : "text-zinc-100"}>{enabled ? "on" : "off"}</strong> in every
          league
          <p className="text-xs text-zinc-500">Accepted trades go to league review before they land.</p>
        </div>
        {!confirming && (
          <button className={NEUTRAL} disabled={pending} onClick={() => (enabled ? setConfirming(true) : flip())}>
            {enabled ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-red-200 bg-red-900/30 border border-red-800/60 rounded-lg px-3 py-2">
            Turning trades off hides the Trades section in every league and cancels every pending trade.
          </p>
          <div className="flex gap-2">
            <button className={DANGER} disabled={pending} onClick={flip}>
              Turn trades off
            </button>
            <button className={NEUTRAL} disabled={pending} onClick={() => setConfirming(false)}>
              Keep them on
            </button>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

function LeagueCard({ league, cap }: { league: AdminLeague; cap: number }) {
  const closed = isClosedLeague(league.status);
  const active = league.managers.filter((m) => !m.orphaned);
  return (
    <div className={`${CARD} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/dashboard/fantasy/${league.id}`} className="text-yellow-400 font-medium hover:underline">
          {league.name}
        </Link>
        <StatusBadge status={league.status} />
        <span className="text-xs text-zinc-500">
          {league.visibility === "private" ? "Private" : "Public"} · {active.length}/{cap} managers
        </span>
      </div>
      {league.warnings.map((w) => (
        <p key={w} className="text-xs text-amber-200 bg-amber-900/30 border border-amber-800/60 rounded-lg px-3 py-1.5">
          {w}
        </p>
      ))}
      <ul className="divide-y divide-zinc-700/60">
        {league.managers.map((m) => (
          <ManagerRow key={m.accountId} league={league} manager={m} closed={closed} />
        ))}
      </ul>
      {!closed && <LeagueTools league={league} />}
    </div>
  );
}

function ManagerRow({ league, manager, closed }: { league: AdminLeague; manager: AdminManager; closed: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const { error, pending, run } = useAdminAction();
  const canRemove = !closed && !manager.orphaned && league.status !== "drafting";
  const canOwn = !closed && !manager.orphaned && !manager.isOwner;
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <PlayerName displayName={manager.name} username={manager.username} discordId={manager.discordId} className="text-zinc-100" />
        {manager.isOwner && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">Owner</span>}
        {manager.orphaned && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">Left · team orphaned</span>}
        <span className="flex-1" />
        {!confirming && canOwn && (
          <button className={NEUTRAL} disabled={pending} onClick={() => run(() => staffTransferOwnership(league.id, manager.accountId))}>
            Make owner
          </button>
        )}
        {!confirming && canRemove && (
          <button className={NEUTRAL} disabled={pending} onClick={() => setConfirming(true)}>
            Remove
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-zinc-300">
            {league.status === "active"
              ? `Remove ${manager.name}? Their team stays in the league with its current lineup until the owner hands it to someone new.`
              : `Remove ${manager.name} from ${league.name}? They won't be able to rejoin unless the owner invites them.`}
            {manager.isOwner && " The league passes to the earliest-joined manager left."}
          </p>
          <div className="flex gap-2">
            <button
              className={DANGER}
              disabled={pending}
              onClick={() => run(() => staffRemoveManager(league.id, manager.accountId), () => setConfirming(false))}
            >
              Remove
            </button>
            <button className={NEUTRAL} disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
    </li>
  );
}

function LeagueTools({ league }: { league: AdminLeague }) {
  const [name, setName] = useState(league.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rename = useAdminAction();
  const del = useAdminAction();
  const trimmed = name.trim();
  return (
    <div className="flex flex-wrap items-start gap-4 pt-1">
      <form
        className="flex-1 min-w-60"
        onSubmit={(e) => {
          e.preventDefault();
          rename.run(() => staffRenameLeague(league.id, name));
        }}
      >
        <div className="flex gap-2">
          <input
            className="flex-1 min-w-0 rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm text-zinc-100"
            value={name}
            maxLength={FANTASY_LEAGUE_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            aria-label="League name"
          />
          <button type="submit" className={NEUTRAL} disabled={rename.pending || !trimmed || trimmed === league.name}>
            Rename
          </button>
        </div>
        <ErrorLine error={rename.error} />
      </form>
      {league.status === "pre_draft" && (
        <div>
          {!confirmDelete ? (
            <button className={DANGER} onClick={() => setConfirmDelete(true)}>
              Delete league
            </button>
          ) : (
            <div className="space-y-2 max-w-sm">
              <p className="text-xs text-red-200">
                Delete {league.name}? Its {league.managers.length} manager{league.managers.length === 1 ? "" : "s"} are told and can join
                another league. This can&apos;t be undone.
              </p>
              <div className="flex gap-2">
                <button className={DANGER} disabled={del.pending} onClick={() => del.run(() => staffDeleteLeague(league.id))}>
                  Delete
                </button>
                <button className={NEUTRAL} disabled={del.pending} onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <ErrorLine error={del.error} />
        </div>
      )}
    </div>
  );
}
