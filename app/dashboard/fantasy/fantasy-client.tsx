"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlayerAvatar } from "@/app/dashboard/player-avatar";
import { FANTASY_LEAGUE_NAME_MAX } from "@/app/lib/fantasy-rules";
import {
  cancelInvite,
  createLeague,
  declineInvite,
  invitePlayer,
  joinLeague,
  leaveLeague,
  removeManager,
  renameLeague,
  searchInvitablePlayers,
  setLeagueVisibility,
  type InviteCandidate,
} from "./actions";

const INPUT =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500";
const PRIMARY =
  "px-4 py-2 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors";
const SECONDARY =
  "px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors";
const DANGER =
  "px-3 py-1.5 bg-red-900/60 hover:bg-red-800 disabled:opacity-50 text-red-100 text-xs font-medium rounded-lg transition-colors";

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="text-xs text-red-400 mt-1">{error}</p> : null;
}

// Runs an action, shows its error, and refreshes the page on success.
function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, onOk?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        onOk?.();
        router.refresh();
      }
    });
  };
  return { error, pending, run };
}

export function CreateLeagueForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button className={PRIMARY} onClick={() => setOpen(true)}>
        Create a league
      </button>
    );
  }

  return (
    <form
      className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await createLeague(name, visibility);
          if (res.error) setError(res.error);
          else if (res.leagueId) router.push(`/dashboard/fantasy/${res.leagueId}`);
        });
      }}
    >
      <div>
        <label className="block text-xs text-zinc-400 mb-1">League name</label>
        <input
          className={INPUT}
          value={name}
          maxLength={FANTASY_LEAGUE_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Westside Fantasy"
          autoFocus
        />
      </div>
      <VisibilityPicker value={visibility} onChange={setVisibility} />
      <p className="text-xs text-zinc-500">You can only create one league per season.</p>
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={pending || !name.trim()}>
          {pending ? "Creating…" : "Create"}
        </button>
        <button type="button" className={SECONDARY} onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

function VisibilityPicker({ value, onChange }: { value: "public" | "private"; onChange: (v: "public" | "private") => void }) {
  const option = (v: "public" | "private", label: string, hint: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      className={`flex-1 text-left rounded-lg border px-3 py-2 transition-colors ${
        value === v ? "border-indigo-500 bg-indigo-500/10" : "border-zinc-700 hover:border-zinc-500"
      }`}
    >
      <span className="block text-sm font-medium text-white">{label}</span>
      <span className="block text-xs text-zinc-400">{hint}</span>
    </button>
  );
  return (
    <div className="flex gap-2">
      {option("public", "Public", "Anyone can join")}
      {option("private", "Private", "Invite only")}
    </div>
  );
}

// docs/fantasy-rl.md §2: a private league's button carries "Invite Only" above
// it and is grey unless the viewer has been invited, green when he has.
export function JoinLeagueButton({
  leagueId,
  visibility,
  isInvited,
  isRemoved,
  full,
  canManage,
}: {
  leagueId: string;
  visibility: "public" | "private";
  isInvited: boolean;
  isRemoved: boolean;
  full: boolean;
  canManage: boolean;
}) {
  const { error, pending, run } = useAction();
  const blocked = !canManage || full || (visibility === "private" && !isInvited) || (isRemoved && !isInvited);
  const reason = !canManage
    ? "Only approved players can join"
    : full
      ? "League is full"
      : isRemoved && !isInvited
        ? "You were removed from this league"
        : null;

  return (
    <div className="flex flex-col items-end">
      {visibility === "private" && <span className="text-[10px] uppercase tracking-wide text-zinc-500 mb-0.5">Invite Only</span>}
      <button
        disabled={blocked || pending}
        title={reason ?? undefined}
        onClick={() => run(() => joinLeague(leagueId))}
        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
          blocked
            ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
            : "bg-emerald-600 hover:bg-emerald-500 text-white"
        }`}
      >
        {pending ? "Joining…" : "Join"}
      </button>
      {reason && canManage && <span className="text-[10px] text-zinc-500 mt-0.5">{reason}</span>}
      <ErrorLine error={error} />
    </div>
  );
}

export function DeclineInviteButton({ leagueId }: { leagueId: string }) {
  const { error, pending, run } = useAction();
  return (
    <div>
      <button className={SECONDARY} disabled={pending} onClick={() => run(() => declineInvite(leagueId))}>
        Decline
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

export function LeaveLeagueButton({ leagueId, isCommissioner, alone }: { leagueId: string; isCommissioner: boolean; alone: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const warning = alone
    ? "You're the only manager, so leaving deletes the league."
    : isCommissioner
      ? "The commissioner role passes to the manager who joined earliest."
      : null;

  if (!confirming) {
    return (
      <button className={DANGER} onClick={() => setConfirming(true)}>
        Leave league
      </button>
    );
  }
  return (
    <div className="space-y-2">
      {warning && <p className="text-xs text-amber-400">{warning}</p>}
      <div className="flex gap-2">
        <button
          className={DANGER}
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await leaveLeague(leagueId);
              if (res.error) setError(res.error);
              else router.push("/dashboard/fantasy?all=1");
            });
          }}
        >
          {pending ? "Leaving…" : "Confirm leave"}
        </button>
        <button className={SECONDARY} disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

export function RemoveManagerButton({ leagueId, accountId, name }: { leagueId: string; accountId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col items-end">
      {confirming ? (
        <div className="flex gap-1">
          <button className={DANGER} disabled={pending} onClick={() => run(() => removeManager(leagueId, accountId))}>
            Remove {name}?
          </button>
          <button className={SECONDARY} disabled={pending} onClick={() => setConfirming(false)}>
            No
          </button>
        </div>
      ) : (
        <button className={SECONDARY} onClick={() => setConfirming(true)}>
          Remove
        </button>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

export function CancelInviteButton({ leagueId, accountId }: { leagueId: string; accountId: string }) {
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col items-end">
      <button className={SECONDARY} disabled={pending} onClick={() => run(() => cancelInvite(leagueId, accountId))}>
        Cancel invite
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

export function InvitePanel({ leagueId }: { leagueId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InviteCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, startSearch] = useTransition();
  const { error, pending, run } = useAction();
  const [searchError, setSearchError] = useState<string | null>(null);

  const search = () => {
    setSearchError(null);
    startSearch(async () => {
      const res = await searchInvitablePlayers(leagueId, query);
      setResults(res.results);
      setSearchError(res.error ?? null);
      setSearched(true);
    });
  };

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input className={INPUT} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search players by name" />
        <button type="submit" className={PRIMARY} disabled={searching || query.trim().length < 2}>
          {searching ? "…" : "Search"}
        </button>
      </form>
      <ErrorLine error={searchError ?? error} />
      {searched && results.length === 0 && !searching && <p className="text-xs text-zinc-500">No approved players match.</p>}
      {results.length > 0 && (
        <ul className="divide-y divide-zinc-700/60 border border-zinc-700 rounded-lg">
          {results.map((p) => (
            <li key={p.accountId} className="flex items-center gap-3 px-3 py-2">
              <PlayerAvatar discordId={p.discordId} avatar={p.avatar} username={p.username} className="w-7 h-7" cdnSize={64} />
              <span className="flex-1 text-sm text-white truncate">{p.name}</span>
              <button
                className={SECONDARY}
                disabled={pending}
                onClick={() => run(() => invitePlayer(leagueId, p.accountId), () => setResults((r) => r.filter((x) => x.accountId !== p.accountId)))}
              >
                Invite
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CommissionerSettings({ leagueId, name, visibility }: { leagueId: string; name: string; visibility: "public" | "private" }) {
  const [draftName, setDraftName] = useState(name);
  const rename = useAction();
  const vis = useAction();

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          rename.run(() => renameLeague(leagueId, draftName));
        }}
      >
        <label className="block text-xs text-zinc-400 mb-1">League name</label>
        <div className="flex gap-2">
          <input className={INPUT} value={draftName} maxLength={FANTASY_LEAGUE_NAME_MAX} onChange={(e) => setDraftName(e.target.value)} />
          <button type="submit" className={PRIMARY} disabled={rename.pending || !draftName.trim() || draftName.trim() === name}>
            Save
          </button>
        </div>
        <ErrorLine error={rename.error} />
      </form>
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Visibility</label>
        <VisibilityPicker
          value={visibility}
          onChange={(v) => {
            if (v !== visibility) vis.run(() => setLeagueVisibility(leagueId, v));
          }}
        />
        <ErrorLine error={vis.error} />
      </div>
    </div>
  );
}

export function LeagueSwitcher({ current, leagues }: { current: string; leagues: { id: string; name: string }[] }) {
  const router = useRouter();
  return (
    <select
      value={current}
      onChange={(e) => router.push(e.target.value === "__all" ? "/dashboard/fantasy?all=1" : `/dashboard/fantasy/${e.target.value}`)}
      className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
    >
      {!leagues.some((l) => l.id === current) && <option value={current}>Viewing this league</option>}
      {leagues.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
      <option value="__all">All leagues…</option>
    </select>
  );
}
