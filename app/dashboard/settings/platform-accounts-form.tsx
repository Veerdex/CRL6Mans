"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  claimPlatformAccount,
  previewClaimReplay,
  withdrawPlatformAccount,
  type ClaimReplayCandidate,
} from "./platform-account-actions";

export type ClaimablePlatform = "steam" | "epic" | "playstation" | "xbox" | "switch";

export type PlatformAccountRecord = {
  id: string;
  platform_account_id: string | null;
  claimed_display_name: string | null;
  claimed_tracker_url: string | null;
  verification_status: "claimed" | "pending_verification" | "verified" | "rejected" | "withdrawn" | "revoked";
  admin_note: string | null;
};

const PLATFORM_LABELS: Record<ClaimablePlatform, string> = {
  steam: "Steam",
  epic: "Epic Games",
  playstation: "PlayStation",
  xbox: "Xbox",
  switch: "Nintendo Switch",
};

const REPLAY_PLATFORM_LABELS: Record<string, string> = {
  ...PLATFORM_LABELS,
  psynet: "PSyNet",
  unknown: "Unknown",
};

export function PlatformAccountsSection({
  accounts,
}: {
  accounts: Record<ClaimablePlatform, PlatformAccountRecord | null>;
}) {
  return (
    <div className="mb-6 space-y-3">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Platform Accounts</p>
      <p className="text-xs text-zinc-500">
        Claim the platform account you play on. An admin verifies each claim before it counts toward
        match identity checks — a claim alone does not certify anything.
      </p>

      <div className="space-y-1.5">
        {(Object.keys(PLATFORM_LABELS) as ClaimablePlatform[]).map(platform => (
          <PlatformStatusRow key={platform} platform={platform} record={accounts[platform]} />
        ))}
      </div>

      <UnifiedClaimCard />
    </div>
  );
}

function statusBanner(record: PlatformAccountRecord) {
  switch (record.verification_status) {
    case "verified":
      return { tone: "emerald" as const, text: "Verified by an admin." };
    case "pending_verification":
      return { tone: "amber" as const, text: "Submitted — awaiting admin verification." };
    case "claimed":
      return { tone: "amber" as const, text: "Claimed — awaiting admin verification." };
    case "rejected":
      return {
        tone: "red" as const,
        text: record.admin_note ? `Rejected: ${record.admin_note}` : "Rejected by an admin.",
      };
    case "revoked":
      return {
        tone: "red" as const,
        text: record.admin_note ? `Revoked: ${record.admin_note}` : "Revoked by an admin.",
      };
    default:
      return null;
  }
}

const TONE_CLASSES = {
  emerald: "bg-emerald-950/40 border-emerald-700/50 text-emerald-300",
  amber: "bg-amber-950/40 border-amber-700/50 text-amber-300",
  red: "bg-red-950/40 border-red-700/50 text-red-300",
};

function PlatformStatusRow({
  platform,
  record,
}: {
  platform: ClaimablePlatform;
  record: PlatformAccountRecord | null;
}) {
  const router = useRouter();
  const [withdrawing, startWithdraw] = useTransition();

  const canWithdraw = record?.verification_status === "claimed" || record?.verification_status === "pending_verification";
  const banner = record ? statusBanner(record) : null;

  function handleWithdraw() {
    if (!record) return;
    startWithdraw(async () => {
      await withdrawPlatformAccount(record.id);
      router.refresh();
    });
  }

  return (
    <div className="px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800 text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-300 font-medium">{PLATFORM_LABELS[platform]}</span>
        <div className="flex items-center gap-2">
          {!record && <span className="text-zinc-600">No claim</span>}
          {canWithdraw && (
            <button
              onClick={handleWithdraw}
              disabled={withdrawing}
              className="text-zinc-500 hover:text-red-400 underline transition-colors disabled:opacity-50"
            >
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </button>
          )}
        </div>
      </div>
      {banner && <p className={`rounded-lg px-2 py-1 border ${TONE_CLASSES[banner.tone]}`}>{banner.text}</p>}
      {record?.claimed_display_name && (
        <p className="text-zinc-500">Claimed as: {record.claimed_display_name}</p>
      )}
    </div>
  );
}

function UnifiedClaimCard() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<ClaimReplayCandidate[] | null>(null);
  const [replayPath, setReplayPath] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [trackerUrl, setTrackerUrl] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState(false);
  const [isPreviewing, startPreview] = useTransition();
  const [isSubmitting, startSubmit] = useTransition();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewError(null);
    setSubmitError(null);
    setSubmitOk(false);
    setCandidates(null);
    setReplayPath(null);
    setSelectedIndex(null);

    const fd = new FormData();
    fd.set("verification_replay", file);
    startPreview(async () => {
      const res = await previewClaimReplay(undefined, fd);
      if (res.error) {
        setPreviewError(res.error);
      } else {
        setReplayPath(res.replayPath ?? null);
        setCandidates(res.candidates ?? []);
      }
    });
    e.target.value = "";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!replayPath || selectedIndex === null) return;
    setSubmitError(null);

    const fd = new FormData();
    fd.set("replay_path", replayPath);
    fd.set("selected_index", String(selectedIndex));
    fd.set("tracker_url", trackerUrl);
    startSubmit(async () => {
      const res = await claimPlatformAccount(undefined, fd);
      if (res.error) {
        setSubmitError(res.error);
      } else {
        setSubmitOk(true);
        setCandidates(null);
        setReplayPath(null);
        setSelectedIndex(null);
        setTrackerUrl("");
        router.refresh();
      }
    });
  }

  return (
    <div className="p-4 bg-zinc-800 border border-zinc-700 rounded-lg space-y-3">
      <p className="text-sm font-semibold text-zinc-200">Claim a Platform Account</p>
      <p className="text-xs text-zinc-500">
        Upload a .replay file from a match you played, then pick your name from the scoreboard below.
        This works for every platform — Steam, Epic, PlayStation, Xbox, and Switch.
      </p>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-zinc-400">Replay file (.replay)</label>
        <input
          type="file"
          accept=".replay"
          onChange={handleFileChange}
          disabled={isPreviewing}
          className="w-full text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:text-zinc-200 file:text-xs hover:file:bg-zinc-600 disabled:opacity-50"
        />
      </div>

      {isPreviewing && <p className="text-xs text-zinc-500">Reading replay…</p>}
      {previewError && <p className="text-xs text-red-400">{previewError}</p>}

      {candidates && candidates.length > 0 && (
        <form onSubmit={handleSubmit} className="space-y-3 pt-1">
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-400">Which row is you?</p>
            <div className="space-y-1">
              {candidates.map(c => (
                <label
                  key={c.index}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                    !c.claimable
                      ? "opacity-40 cursor-not-allowed border-zinc-700"
                      : selectedIndex === c.index
                        ? "border-indigo-500 bg-indigo-950/30 cursor-pointer"
                        : "border-zinc-700 hover:border-zinc-600 cursor-pointer"
                  }`}
                >
                  <input
                    type="radio"
                    name="candidate"
                    disabled={!c.claimable}
                    checked={selectedIndex === c.index}
                    onChange={() => setSelectedIndex(c.index)}
                    className="accent-indigo-500"
                  />
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                      c.team === 0 ? "bg-blue-900/50 text-blue-300" : "bg-orange-900/50 text-orange-300"
                    }`}
                  >
                    {c.team === 0 ? "Blue" : "Orange"}
                  </span>
                  <span className="text-zinc-200 flex-1 truncate">{c.name}</span>
                  <span className="text-zinc-500 shrink-0">
                    {c.claimable ? REPLAY_PLATFORM_LABELS[c.platform ?? "unknown"] : "Not claimable"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="claim_tracker_url" className="block text-xs font-medium text-zinc-400">
              Tracker URL
            </label>
            <input
              id="claim_tracker_url"
              type="url"
              required
              value={trackerUrl}
              onChange={e => setTrackerUrl(e.target.value)}
              placeholder="https://rocketleague.tracker.network/rocket-league/profile/..."
              className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-600"
            />
          </div>

          {submitError && <p className="text-xs text-red-400">{submitError}</p>}
          {submitOk && <p className="text-xs text-emerald-400">Claim submitted.</p>}

          <button
            type="submit"
            disabled={isSubmitting || selectedIndex === null}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {isSubmitting ? "Submitting…" : "Submit Claim"}
          </button>
        </form>
      )}
    </div>
  );
}
