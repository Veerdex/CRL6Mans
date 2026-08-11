"use client";

import { useState, useTransition } from "react";
import type { Sponsor } from "./sponsor-actions";
import {
  createSponsor,
  updateSponsorMaxUses,
  toggleSponsorStatus,
  removeSponsorMember,
} from "./sponsor-actions";

function StatusBadge({ status }: { status: "active" | "disabled" }) {
  return status === "active" ? (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded border text-emerald-400 bg-emerald-950/40 border-emerald-800/60">
      Active
    </span>
  ) : (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded border text-zinc-400 bg-zinc-800 border-zinc-700">
      Disabled
    </span>
  );
}

function SponsorCard({ sponsor }: { sponsor: Sponsor }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [maxUsesInput, setMaxUsesInput] = useState(String(sponsor.max_uses));
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const inviteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/sponsor/join/${sponsor.invite_token}` : "";

  function handleCopy() {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleSaveMaxUses() {
    setError(null);
    const parsed = Number(maxUsesInput);
    startTransition(async () => {
      const res = await updateSponsorMaxUses(sponsor.id, parsed);
      if (res.error) setError(res.error);
    });
  }

  function handleToggleStatus() {
    setError(null);
    startTransition(async () => {
      const res = await toggleSponsorStatus(sponsor.id);
      if (res.error) setError(res.error);
    });
  }

  function handleRemoveMember(memberId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeSponsorMember(memberId);
      if (res.error) setError(res.error);
      else setConfirmRemoveId(null);
    });
  }

  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-sm font-semibold text-white">{sponsor.name}</span>
        <StatusBadge status={sponsor.status} />
        <span className="text-xs text-zinc-500">
          {sponsor.members.length} / {sponsor.max_uses} used
        </span>
        <button
          onClick={handleToggleStatus}
          disabled={isPending}
          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
        >
          {sponsor.status === "active" ? "Disable" : "Enable"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={inviteUrl}
          className="flex-1 min-w-[200px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-400 font-mono"
        />
        <button
          onClick={handleCopy}
          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">Max uses</span>
        <input
          value={maxUsesInput}
          onChange={(e) => setMaxUsesInput(e.target.value)}
          className="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white"
        />
        <button
          onClick={handleSaveMaxUses}
          disabled={isPending || maxUsesInput === String(sponsor.max_uses)}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
        >
          Save
        </button>
      </div>

      {sponsor.members.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Members</p>
          {sponsor.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <span className="flex-1 text-sm text-white">{m.display_name ?? m.username}</span>
              <span className="text-xs text-zinc-500 font-mono">{m.discord_id}</span>
              {confirmRemoveId === m.id ? (
                <>
                  <button onClick={() => handleRemoveMember(m.id)} className="text-xs text-red-400 underline">
                    Confirm
                  </button>
                  <button onClick={() => setConfirmRemoveId(null)} className="text-xs text-zinc-500 underline">
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmRemoveId(m.id)}
                  className="text-xs text-red-500 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SponsorsManager({ sponsors }: { sponsors: Sponsor[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [maxUses, setMaxUses] = useState("1");

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createSponsor(name, Number(maxUses));
      if (res.error) setError(res.error);
      else { setName(""); setMaxUses("1"); }
    });
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/50 rounded-lg px-4 py-2">{error}</p>}

      {sponsors.length === 0 ? (
        <p className="text-sm text-zinc-500">No sponsors yet.</p>
      ) : (
        <div className="space-y-3">
          {sponsors.map((s) => (
            <SponsorCard key={s.id} sponsor={s} />
          ))}
        </div>
      )}

      <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-zinc-300">Add Sponsor</p>
        <div className="flex flex-wrap gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sponsor name"
            className="flex-1 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600"
          />
          <input
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Max uses"
            className="w-28 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600"
          />
          <button
            onClick={handleCreate}
            disabled={isPending || !name.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
