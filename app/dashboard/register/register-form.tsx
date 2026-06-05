"use client";

import { useActionState } from "react";
import { registerPlayer } from "./actions";

export type ExistingPlayerData = {
  tracker_url: string;
  peak_3v3: string;
  current_3v3: string;
  peak_2v2: string;
  current_2v2: string;
  college_image_url: string;
};

interface Props {
  isResubmit: boolean;
  existing: ExistingPlayerData | null;
}

export function RegisterForm({ isResubmit, existing }: Props) {
  const [state, action, pending] = useActionState(registerPlayer, { error: "" });

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
          defaultValue={existing?.tracker_url ?? ""}
          placeholder="https://rocketleague.tracker.network/rocket-league/profile/..."
          className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <MMRInput name="peak_3v3"    label="Peak 3v3 MMR"    defaultValue={existing?.peak_3v3} />
        <MMRInput name="current_3v3" label="Current 3v3 MMR" defaultValue={existing?.current_3v3} />
        <MMRInput name="peak_2v2"    label="Peak 2v2 MMR"    defaultValue={existing?.peak_2v2} />
        <MMRInput name="current_2v2" label="Current 2v2 MMR" defaultValue={existing?.current_2v2} />
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-zinc-300">
          College Enrollment Proof
          {isResubmit && existing?.college_image_url && (
            <span className="ml-2 text-xs font-normal text-zinc-500">(optional — keep existing or upload new)</span>
          )}
        </label>
        <p className="text-xs text-zinc-500 mb-2">
          Upload a photo of your student ID, schedule, or any document showing
          you currently attend college.
        </p>

        {isResubmit && existing?.college_image_url && (
          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
            <span className="text-zinc-600">Current file:</span>
            <a
              href={existing.college_image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 transition-colors underline"
            >
              View existing submission
            </a>
          </div>
        )}

        <input
          type="file"
          name="college_image"
          accept="image/*,.pdf"
          required={!isResubmit || !existing?.college_image_url}
          className="block w-full text-sm text-zinc-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-700 file:text-white hover:file:bg-zinc-600 cursor-pointer"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
      >
        {pending ? "Submitting…" : isResubmit ? "Re-submit Registration" : "Submit Registration"}
      </button>
    </form>
  );
}

function MMRInput({
  name, label, defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: string;
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
        defaultValue={defaultValue ?? ""}
        placeholder="e.g. 1420"
        className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-500"
      />
    </div>
  );
}
