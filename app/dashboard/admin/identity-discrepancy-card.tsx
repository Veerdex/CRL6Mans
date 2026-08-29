"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveIdentityDiscrepancy, reverifyGameIdentity, type DiscrepancyResolution } from "./identity-discrepancy-actions";

export type IdentityDiscrepancyCardData = {
  id: string;
  matchId: string;
  matchLabel: string;
  gameNumber: number | null;
  createdAt: string;
  replayPlayerName: string;
  replayTeam: number | null;
  replayPlatform: string | null;
  replayPlatformAccountId: string | null;
  identitySource: string | null;
  resolutionType: string | null;
  expectedPlayerLabel: string | null;
  conflictingPlayerLabel: string | null;
  reason: string;
  replayDownloadUrl: string | null;
};

const RESOLUTION_LABELS: Record<DiscrepancyResolution, string> = {
  registration_corrected: "Correct a documented pre-match registration error",
  early_approval_recognized: "Recognize an account approved before kickoff",
  lineup_corrected: "Correct an incorrect lineup snapshot",
  sub_approved: "Approve a legitimate substitute",
  rejected: "Reject / forfeit the match",
  escalated: "Escalate suspected unauthorized participation",
};

const TYPE_LABELS: Record<string, string> = {
  "unexpected-account": "Unexpected account",
  "registered-id-mismatch": "Registered ID mismatch",
  "id-owned-by-other-player": "ID owned by another player",
  "ineligible-player": "Ineligible player",
  "wrong-team": "Wrong team",
  "duplicate-player": "Duplicate player",
  "missing-expected-player": "Missing expected player",
  "unverifiable-identity": "Unverifiable identity",
  "unsupported-platform": "Unsupported platform",
  "late-account-registration": "Late account registration",
  "ambiguous-name": "Ambiguous name",
};

export function IdentityDiscrepancyCard({ discrepancy }: { discrepancy: IdentityDiscrepancyCardData }) {
  const router = useRouter();
  const [resolution, setResolution] = useState<DiscrepancyResolution>("registration_corrected");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [reverifyPending, startReverifyTransition] = useTransition();
  const [reverifyMessage, setReverifyMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function handleResolve() {
    setError(null);
    startTransition(async () => {
      const res = await resolveIdentityDiscrepancy(discrepancy.id, resolution, reason);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function handleReverify() {
    if (discrepancy.gameNumber == null) return;
    setError(null);
    setReverifyMessage(null);
    startReverifyTransition(async () => {
      const res = await reverifyGameIdentity(discrepancy.matchId, discrepancy.gameNumber!);
      if (res.error) {
        setError(res.error);
        return;
      }
      setReverifyMessage({ ok: !!res.certified, text: res.message ?? "" });
      if (res.certified) router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-white">{discrepancy.matchLabel}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {discrepancy.gameNumber != null ? `Game ${discrepancy.gameNumber} · ` : ""}
            Flagged {new Date(discrepancy.createdAt).toLocaleDateString()}
            {discrepancy.resolutionType && ` · ${TYPE_LABELS[discrepancy.resolutionType] ?? discrepancy.resolutionType}`}
          </p>
        </div>
        {discrepancy.replayDownloadUrl && (
          <a
            href={discrepancy.replayDownloadUrl}
            className="shrink-0 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            Download replay
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-zinc-800 rounded-lg px-4 py-3 text-xs text-zinc-400 space-y-1">
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Replay Evidence</p>
          <p>Name: <span className="text-zinc-200">{discrepancy.replayPlayerName}</span></p>
          <p>Team: <span className="text-zinc-200">{discrepancy.replayTeam != null ? (discrepancy.replayTeam === 0 ? "Blue" : "Orange") : "—"}</span></p>
          <p>Platform: <span className="text-zinc-200">{discrepancy.replayPlatform ?? "—"}</span></p>
          <p>Account ID: <span className="text-zinc-200 font-mono">{discrepancy.replayPlatformAccountId ?? "—"}</span></p>
          <p>Source: <span className="text-zinc-200">{discrepancy.identitySource ?? "—"}</span></p>
        </div>
        <div className="bg-zinc-800 rounded-lg px-4 py-3 text-xs text-zinc-400 space-y-1">
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Registered Evidence</p>
          <p>Expected player: <span className="text-zinc-200">{discrepancy.expectedPlayerLabel ?? "—"}</span></p>
          <p>Conflicting player: <span className="text-zinc-200">{discrepancy.conflictingPlayerLabel ?? "—"}</span></p>
          <p className="pt-1 text-zinc-300">{discrepancy.reason}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Resolution
          </label>
          <select
            value={resolution}
            onChange={e => setResolution(e.target.value as DiscrepancyResolution)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {Object.entries(RESOLUTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Reason (required)
          </label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Explain the decision for the audit trail…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {resolution !== "rejected" && resolution !== "escalated" && (
        <p className="text-xs text-amber-400">
          This records the decision only. Fix the underlying data (e.g. verify the platform account), then click Reverify to re-run the resolver — no re-upload needed. This cannot manually mark the match certified.
        </p>
      )}
      {resolution === "rejected" && (
        <p className="text-xs text-amber-400">
          This records the decision and label only — it does not forfeit the match or block a later resubmission. Use the DQ/forfeit tool to actually decide the match.
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleResolve}
          disabled={isPending}
          className="px-4 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "Saving…" : "Save Resolution"}
        </button>
        {discrepancy.gameNumber != null && (
          <button
            onClick={handleReverify}
            disabled={reverifyPending}
            className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {reverifyPending ? "Reverifying…" : "Reverify"}
          </button>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
        {reverifyMessage && (
          <span className={`text-xs ${reverifyMessage.ok ? "text-emerald-400" : "text-amber-400"}`}>
            {reverifyMessage.text}
          </span>
        )}
      </div>
    </div>
  );
}
