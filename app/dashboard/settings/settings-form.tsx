"use client";

import { useActionState, useTransition } from "react";
import { requestProfileChange, cancelProfileRequest, dismissRejectedRequest } from "./actions";

export type PlayerSettings = {
  tracker_url: string;
  peak_3v3: string;
  current_3v3: string;
  peak_2v2: string;
  current_2v2: string;
  sub_willing: boolean;
};

export type PendingRequest = {
  id: string;
  tracker_url: string;
  peak_3v3: string;
  current_3v3: string;
  peak_2v2: string;
  current_2v2: string;
  created_at: string;
};

export type RejectedRequest = {
  id: string;
  adminNote: string | null;
};

export function SettingsForm({
  current,
  pending,
  rejected,
}: {
  current: PlayerSettings;
  pending: PendingRequest | null;
  rejected: RejectedRequest | null;
}) {
  const [state, action, submitting] = useActionState(requestProfileChange, {});
  const [cancelling, startCancel] = useTransition();
  const [dismissing, startDismiss] = useTransition();

  // Pre-fill with pending values if a request is waiting — lets the player
  // see and edit what they submitted before the admin reviews it.
  const fill = pending ?? current;

  function handleCancel() {
    if (!pending) return;
    startCancel(async () => {
      await cancelProfileRequest(pending.id);
    });
  }

  function handleDismiss() {
    if (!rejected) return;
    startDismiss(async () => {
      await dismissRejectedRequest(rejected.id);
    });
  }

  return (
    <div className="space-y-6">
      {/* Pending request banner */}
      {pending && (
        <div className="flex items-start justify-between gap-4 bg-amber-950/40 border border-amber-700/50 rounded-xl px-4 py-3">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-amber-300">Change request pending admin approval</p>
            <p className="text-xs text-amber-500">
              Submitted {new Date(pending.created_at).toLocaleDateString()}. Your current live
              values are unchanged until an admin approves this.
            </p>
          </div>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="shrink-0 text-xs text-amber-500 hover:text-amber-300 underline transition-colors disabled:opacity-50"
          >
            {cancelling ? "Cancelling…" : "Cancel request"}
          </button>
        </div>
      )}

      <form action={action} className="space-y-6">
        <div className="space-y-1">
          <label htmlFor="tracker_url" className="block text-sm font-medium text-zinc-300">
            Rocket League Tracker URL
          </label>
          <input
            id="tracker_url"
            name="tracker_url"
            type="url"
            required
            defaultValue={fill.tracker_url}
            placeholder="https://rocketleague.tracker.network/rocket-league/profile/..."
            className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <MMRInput name="peak_2v2"    label="All Time Peak 2v2" defaultValue={fill.peak_2v2}    current={current.peak_2v2}    isPending={!!pending} />
          <MMRInput name="current_2v2" label="Season Peak 2v2"   defaultValue={fill.current_2v2} current={current.current_2v2} isPending={!!pending} />
          <MMRInput name="peak_3v3"    label="All Time Peak 3v3" defaultValue={fill.peak_3v3}    current={current.peak_3v3}    isPending={!!pending} />
          <MMRInput name="current_3v3" label="Season Peak 3v3"   defaultValue={fill.current_3v3} current={current.current_3v3} isPending={!!pending} />
        </div>

        <div className="flex items-center justify-between p-4 bg-zinc-800 border border-zinc-700 rounded-lg">
          <div>
            <p className="text-sm font-medium text-zinc-300">Substitute availability</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Be available as a substitute if needed. Applied instantly.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
            <input type="checkbox" name="sub_willing" defaultChecked={current.sub_willing} className="sr-only peer" />
            <div className="w-11 h-6 bg-zinc-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-pure-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
          </label>
        </div>

        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        {state?.ok && (
          <p className="text-sm text-emerald-400">
            Change request submitted — an admin will review it shortly.
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="py-2.5 px-6 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm"
        >
          {submitting ? "Submitting…" : pending ? "Update Request" : "Request Changes"}
        </button>
      </form>

      {rejected && (
        <div className="flex items-start justify-between gap-4 bg-red-950/40 border border-red-700/50 rounded-xl px-4 py-3">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-red-300">Change request rejected</p>
            {rejected.adminNote ? (
              <p className="text-xs text-red-400/80">Reason: {rejected.adminNote}</p>
            ) : (
              <p className="text-xs text-red-400/80">No reason provided. Contact an admin if you have questions.</p>
            )}
          </div>
          <button
            onClick={handleDismiss}
            disabled={dismissing}
            className="shrink-0 text-xs text-red-400 hover:text-red-300 underline transition-colors disabled:opacity-50"
          >
            {dismissing ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
      )}
    </div>
  );
}

function MMRInput({
  name, label, defaultValue, current, isPending,
}: {
  name: string;
  label: string;
  defaultValue: string;
  current: string;
  isPending: boolean;
}) {
  const changed = isPending && defaultValue !== current;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={name} className="block text-sm font-medium text-zinc-300">
          {label}
        </label>
        {changed && (
          <span className="text-[10px] text-amber-400 font-medium">
            live: {current}
          </span>
        )}
      </div>
      <input
        id={name}
        name={name}
        type="number"
        min={0}
        max={3000}
        required
        defaultValue={defaultValue}
        placeholder="e.g. 1420"
        className={`w-full bg-zinc-800 border text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-500 ${
          changed ? "border-amber-600/60" : "border-zinc-700"
        }`}
      />
    </div>
  );
}
