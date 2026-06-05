"use client";

import { useActionState } from "react";
import { updatePlayerSettings } from "./actions";

export type PlayerSettings = {
  tracker_url: string;
  peak_3v3: string;
  current_3v3: string;
  peak_2v2: string;
  current_2v2: string;
};

export function SettingsForm({ current }: { current: PlayerSettings }) {
  const [state, action, pending] = useActionState(updatePlayerSettings, {});

  return (
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
          defaultValue={current.tracker_url}
          placeholder="https://rocketleague.tracker.network/rocket-league/profile/..."
          className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <MMRInput name="peak_3v3"    label="Peak 3v3 MMR"    defaultValue={current.peak_3v3} />
        <MMRInput name="current_3v3" label="Current 3v3 MMR" defaultValue={current.current_3v3} />
        <MMRInput name="peak_2v2"    label="Peak 2v2 MMR"    defaultValue={current.peak_2v2} />
        <MMRInput name="current_2v2" label="Current 2v2 MMR" defaultValue={current.current_2v2} />
      </div>

      {state?.error && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}
      {state?.ok && (
        <p className="text-sm text-green-400">Settings saved.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="py-2.5 px-6 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm"
      >
        {pending ? "Saving…" : "Save Changes"}
      </button>
    </form>
  );
}

function MMRInput({
  name, label, defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium text-zinc-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        min={0}
        required
        defaultValue={defaultValue}
        placeholder="e.g. 1420"
        className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-500"
      />
    </div>
  );
}
