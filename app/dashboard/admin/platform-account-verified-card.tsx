"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokePlatformAccount, correctPlatformAccount } from "./platform-account-verification-actions";

export type PlatformAccountVerifiedCardData = {
  id: string;
  platform: "steam" | "epic" | "playstation" | "xbox" | "switch";
  username: string;
  displayName: string | null;
  verifiedDisplayName: string | null;
  platformAccountId: string | null;
  verificationMethod: string | null;
  verifiedAt: string | null;
  validFrom: string | null;
};

const PLATFORM_LABELS: Record<PlatformAccountVerifiedCardData["platform"], string> = {
  steam: "Steam",
  epic: "Epic Games",
  playstation: "PlayStation",
  xbox: "Xbox",
  switch: "Nintendo Switch",
};

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PlatformAccountVerifiedCard({ account }: { account: PlatformAccountVerifiedCardData }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [showCorrect, setShowCorrect] = useState(false);
  const [correctPlatformId, setCorrectPlatformId] = useState(account.platformAccountId ?? "");
  const [correctDisplayName, setCorrectDisplayName] = useState(account.verifiedDisplayName ?? "");
  const [correctValidFrom, setCorrectValidFrom] = useState(toDateTimeLocal(account.validFrom));
  const [correctReason, setCorrectReason] = useState("");
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [isCorrectPending, startCorrectTransition] = useTransition();

  function handleRevoke() {
    setError(null);
    startTransition(async () => {
      const res = await revokePlatformAccount(account.id, note);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function handleCorrect() {
    setCorrectError(null);
    startCorrectTransition(async () => {
      const res = await correctPlatformAccount(account.id, {
        platformAccountId: correctPlatformId,
        verifiedDisplayName: correctDisplayName,
        validFrom: correctValidFrom,
        adminReason: correctReason,
      });
      if (res.error) setCorrectError(res.error);
      else {
        setShowCorrect(false);
        setCorrectReason("");
        router.refresh();
      }
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white truncate">
            {account.displayName ? `${account.displayName} (${account.username})` : account.username}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {PLATFORM_LABELS[account.platform]} · <span className="font-mono">{account.platformAccountId}</span>
            {account.verifiedDisplayName && <> · &quot;{account.verifiedDisplayName}&quot;</>}
            {account.verificationMethod && <> · {account.verificationMethod}</>}
            {account.verifiedAt && <> · verified {new Date(account.verifiedAt).toLocaleDateString()}</>}
            {account.validFrom && <> · valid from {new Date(account.validFrom).toLocaleString()}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowCorrect(v => !v)}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {showCorrect ? "Cancel" : "Correct"}
          </button>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Reason for revocation…"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={handleRevoke}
            disabled={isPending}
            className="px-3 py-1.5 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {isPending ? "Revoking…" : "Revoke"}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>

      {showCorrect && (
        <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
          <p className="text-xs text-amber-400">
            Edits this account in place — use to fix a documented pre-match registration error or recognize an account approved before kickoff. Setting valid-from to before the match&apos;s kickoff is what actually lets a re-analyzed replay certify.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Platform Account ID</label>
              <input
                type="text"
                value={correctPlatformId}
                onChange={e => setCorrectPlatformId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Verified Display Name</label>
              <input
                type="text"
                value={correctDisplayName}
                onChange={e => setCorrectDisplayName(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Valid From</label>
              <input
                type="datetime-local"
                value={correctValidFrom}
                onChange={e => setCorrectValidFrom(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={correctReason}
              onChange={e => setCorrectReason(e.target.value)}
              placeholder="Reason for correction (required)…"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              onClick={handleCorrect}
              disabled={isCorrectPending}
              className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              {isCorrectPending ? "Saving…" : "Save Correction"}
            </button>
          </div>
          {correctError && <span className="text-xs text-red-400">{correctError}</span>}
        </div>
      )}
    </div>
  );
}
