"use client";

import { useActionState, useTransition, useState } from "react";
import { claimPlatformAccount, withdrawPlatformAccount } from "./platform-account-actions";

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

const CONSOLE_PLATFORMS: ClaimablePlatform[] = ["playstation", "xbox", "switch"];

export function PlatformAccountsSection({
  accounts,
}: {
  accounts: Record<ClaimablePlatform, PlatformAccountRecord | null>;
}) {
  return (
    <div className="mb-6 space-y-3">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Platform Accounts</p>
      <p className="text-xs text-zinc-500">
        Claim the platform account(s) you play on. An admin verifies each claim before it counts toward
        match identity checks — a claim alone does not certify anything.
      </p>
      <div className="space-y-3">
        {(Object.keys(PLATFORM_LABELS) as ClaimablePlatform[]).map(platform => (
          <PlatformClaimCard key={platform} platform={platform} record={accounts[platform]} />
        ))}
      </div>
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

function PlatformClaimCard({
  platform,
  record,
}: {
  platform: ClaimablePlatform;
  record: PlatformAccountRecord | null;
}) {
  const [state, action, submitting] = useActionState(claimPlatformAccount, {});
  const [withdrawing, startWithdraw] = useTransition();
  const [editing, setEditing] = useState(false);

  const isConsole = CONSOLE_PLATFORMS.includes(platform);
  const verified = record?.verification_status === "verified";
  const canWithdraw = record?.verification_status === "claimed" || record?.verification_status === "pending_verification";
  const banner = record ? statusBanner(record) : null;
  const showForm = !record || editing || (!verified && !canWithdraw);

  function handleWithdraw() {
    if (!record) return;
    startWithdraw(async () => {
      await withdrawPlatformAccount(record.id);
    });
  }

  return (
    <div className="p-4 bg-zinc-800 border border-zinc-700 rounded-lg space-y-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-semibold text-zinc-200">{PLATFORM_LABELS[platform]}</p>
        {canWithdraw && !editing && (
          <button
            onClick={handleWithdraw}
            disabled={withdrawing}
            className="text-xs text-zinc-500 hover:text-red-400 underline transition-colors disabled:opacity-50"
          >
            {withdrawing ? "Withdrawing…" : "Withdraw claim"}
          </button>
        )}
      </div>

      {banner && (
        <p className={`text-xs rounded-lg border px-3 py-2 ${TONE_CLASSES[banner.tone]}`}>{banner.text}</p>
      )}

      {record && !editing && (
        <div className="text-xs text-zinc-400 space-y-0.5">
          {record.platform_account_id && <p>ID: {record.platform_account_id}</p>}
          {record.claimed_display_name && <p>Display name: {record.claimed_display_name}</p>}
          {record.claimed_tracker_url && (
            <p>
              Tracker:{" "}
              <a href={record.claimed_tracker_url} target="_blank" rel="noreferrer" className="underline hover:text-zinc-300">
                {record.claimed_tracker_url}
              </a>
            </p>
          )}
        </div>
      )}

      {record && canWithdraw && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-indigo-400 hover:text-indigo-300 underline transition-colors"
        >
          Edit claim
        </button>
      )}

      {verified && (
        <p className="text-xs text-zinc-500">
          Verified accounts can only be changed by an admin.
        </p>
      )}

      {showForm && (
        <form action={action} className="space-y-3 pt-1">
          <input type="hidden" name="platform" value={platform} />

          {platform === "steam" && (
            <Field
              name="steam_id"
              label="SteamID64 or profile URL"
              placeholder="76561198012345678 or steamcommunity.com/profiles/..."
              defaultValue={record?.platform_account_id ?? ""}
              required
            />
          )}
          {platform === "epic" && (
            <Field
              name="epic_account_id"
              label="Epic Account ID"
              placeholder="32-character ID from epicgames.com/account"
              defaultValue={record?.platform_account_id ?? ""}
              required
            />
          )}
          {(platform === "steam" || platform === "epic") && (
            <Field
              name="display_name"
              label="Current display name (optional)"
              placeholder="Your in-game name"
              defaultValue={record?.claimed_display_name ?? ""}
            />
          )}
          {isConsole && (
            <Field
              name="display_name"
              label="Platform display name"
              placeholder="Your in-game name on this platform"
              defaultValue={record?.claimed_display_name ?? ""}
              required
            />
          )}

          <Field
            name="tracker_url"
            label="Tracker URL"
            type="url"
            placeholder="https://rocketleague.tracker.network/rocket-league/profile/..."
            defaultValue={record?.claimed_tracker_url ?? ""}
            required
          />

          {isConsole && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-400">
                Verification replay (optional, .replay)
              </label>
              <input
                name="verification_replay"
                type="file"
                accept=".replay"
                className="w-full text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:text-zinc-200 file:text-xs hover:file:bg-zinc-600"
              />
              <p className="text-[11px] text-zinc-500">
                A replay from a match you played helps an admin confirm your console account without
                asking for a numeric ID you can&apos;t normally see.
              </p>
            </div>
          )}

          {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
          {state?.ok && <p className="text-xs text-emerald-400">Claim submitted.</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {submitting ? "Submitting…" : record ? "Update Claim" : "Submit Claim"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-semibold rounded-lg transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  defaultValue,
  required,
  type = "text",
}: {
  name: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-xs font-medium text-zinc-400">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-600"
      />
    </div>
  );
}
