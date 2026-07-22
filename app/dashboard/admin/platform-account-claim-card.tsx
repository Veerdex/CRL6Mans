"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyPlatformAccount, rejectPlatformAccount } from "./platform-account-verification-actions";

export type PlatformAccountClaimCardData = {
  id: string;
  platform: "steam" | "epic" | "playstation" | "xbox" | "switch";
  username: string;
  displayName: string | null;
  claimedDisplayName: string | null;
  claimedTrackerUrl: string | null;
  platformAccountId: string | null;
  replayDownloadUrl: string | null;
  flagNote: string | null;
  createdAt: string;
};

const COOLDOWN_OPTIONS: { value: "none" | "5m" | "1d" | "forever"; label: string }[] = [
  { value: "none", label: "No cooldown" },
  { value: "5m", label: "5 minutes" },
  { value: "1d", label: "1 day" },
  { value: "forever", label: "Forever" },
];

const PLATFORM_LABELS: Record<PlatformAccountClaimCardData["platform"], string> = {
  steam: "Steam",
  epic: "Epic Games",
  playstation: "PlayStation",
  xbox: "Xbox",
  switch: "Nintendo Switch",
};

const DEFAULT_METHOD_BY_PLATFORM: Record<PlatformAccountClaimCardData["platform"], string> = {
  steam: "legacy_manual",
  epic: "official_account_page",
  playstation: "console_replay_network",
  xbox: "console_replay_network",
  switch: "console_replay_network",
};

const METHOD_LABELS: Record<string, string> = {
  steam_openid: "Steam OpenID",
  epic_oauth: "Epic OAuth",
  official_account_page: "Official account page (manual)",
  console_replay_network: "Console verification replay",
  admin_live: "Admin observed live",
  legacy_manual: "Manual review",
};

export function PlatformAccountClaimCard({ claim }: { claim: PlatformAccountClaimCardData }) {
  const router = useRouter();
  const isConsole = claim.platform === "playstation" || claim.platform === "xbox" || claim.platform === "switch";

  const [platformAccountId, setPlatformAccountId] = useState(claim.platformAccountId ?? "");
  const [method, setMethod] = useState(DEFAULT_METHOD_BY_PLATFORM[claim.platform]);
  const [verifiedDisplayName, setVerifiedDisplayName] = useState(claim.claimedDisplayName ?? "");
  const [note, setNote] = useState("");
  const [cooldown, setCooldown] = useState<"none" | "5m" | "1d" | "forever">("none");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleVerify() {
    setError(null);
    startTransition(async () => {
      const res = await verifyPlatformAccount(claim.id, {
        platformAccountId,
        verificationMethod: method,
        verifiedDisplayName,
        adminNote: note,
      });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectPlatformAccount(claim.id, note, cooldown === "none" ? undefined : cooldown);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-white">
            {claim.displayName ? `${claim.displayName} (${claim.username})` : claim.username}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {PLATFORM_LABELS[claim.platform]} · Submitted {new Date(claim.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {claim.claimedTrackerUrl && (
            <a href={claim.claimedTrackerUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors">
              Tracker ↗
            </a>
          )}
          {claim.replayDownloadUrl && (
            <a href={claim.replayDownloadUrl} download
              className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors">
              Download Replay ↗
            </a>
          )}
        </div>
      </div>

      {claim.flagNote && (
        <div className="bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-xs text-red-300 font-medium">
          {claim.flagNote}
        </div>
      )}

      <div className="bg-zinc-800 rounded-lg px-4 py-3 text-xs text-zinc-400 space-y-1">
        <p>Claimed display name: <span className="text-zinc-200">{claim.claimedDisplayName ?? "—"}</span></p>
        <p>
          Claimed ID:{" "}
          <span className="text-zinc-200 font-mono">{claim.platformAccountId ?? "not yet known"}</span>
        </p>
        {!claim.platformAccountId && (
          <p className="text-amber-400">
            No platform ID on this claim — it predates the replay-based claim flow. Ask the player to resubmit,
            or enter the ID manually below if you can confirm it another way.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Platform Account ID
          </label>
          <input
            type="text"
            value={platformAccountId}
            onChange={e => setPlatformAccountId(e.target.value)}
            placeholder={isConsole ? "Extracted numeric ID" : "Confirm or correct the claimed ID"}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Verification Method
          </label>
          <select
            value={method}
            onChange={e => setMethod(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {Object.entries(METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Verified Display Name
          </label>
          <input
            type="text"
            value={verifiedDisplayName}
            onChange={e => setVerifiedDisplayName(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Admin Note (optional — shown if rejected)
          </label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Reason for rejection…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Rejection Cooldown
          </label>
          <select
            value={cooldown}
            onChange={e => setCooldown(e.target.value as typeof cooldown)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {COOLDOWN_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {cooldown !== "none" && (
            <p className="text-[10px] text-amber-400 mt-1">
              Rejecting will also kick this player from active play ({cooldown === "forever" ? "no auto-expiry" : `eligible again in ${cooldown === "5m" ? "5 minutes" : "1 day"}`}).
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleVerify}
          disabled={isPending}
          className="px-4 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "Saving…" : "Verify"}
        </button>
        <button
          onClick={handleReject}
          disabled={isPending}
          className="px-4 py-1.5 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Reject
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
