"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { registerPlayer } from "./actions";

export type ExistingPlayerData = {
  tracker_url: string;
  peak_3v3: string;
  current_3v3: string;
  peak_2v2: string;
  current_2v2: string;
  college_image_url: string;
  sub_willing: boolean;
};

interface Props {
  isResubmit: boolean;
  existing: ExistingPlayerData | null;
}

export function RegisterForm({ isResubmit, existing }: Props) {
  const router = useRouter();
  const [state, action, pending] = useActionState(registerPlayer, { error: "" });
  const [fileError, setFileError] = useState<string>("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFileError("");
      return;
    }

    const maxSizeMB = 5;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    if (file.size > maxSizeBytes) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setFileError(
        `College image is too large (${fileSizeMB}MB). Please compress it to under ${maxSizeMB}MB. ` +
        `Tip: use an online image compressor or convert to JPG quality 80%.`
      );
      e.target.value = "";
    } else {
      setFileError("");
    }
  };

  useEffect(() => {
    if ((state as { success?: boolean }).success) router.push("/dashboard");
  }, [state, router]);

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
        <MMRInput name="peak_2v2"    label="All Time Peak 2v2" defaultValue={existing?.peak_2v2} />
        <MMRInput name="current_2v2" label="Season Peak 2v2"   defaultValue={existing?.current_2v2} />
        <MMRInput name="peak_3v3"    label="All Time Peak 3v3" defaultValue={existing?.peak_3v3} />
        <MMRInput name="current_3v3" label="Season Peak 3v3"   defaultValue={existing?.current_3v3} />
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-zinc-300">
          College Enrollment Proof
          {isResubmit && existing?.college_image_url && (
            <span className="ml-2 text-xs font-normal text-zinc-500">(optional — keep existing or upload new)</span>
          )}
        </label>
        <p className="text-xs text-zinc-500 mb-1">
          Upload a photo of your student ID, schedule, or any document showing
          you currently attend college.
        </p>
        <p className="text-xs text-amber-600/80 mb-2">
          Tip: blur or cover any sensitive information before uploading — student ID numbers, SSN, date of birth, or home address are not needed for verification.
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
          onChange={handleFileChange}
          className="block w-full text-sm text-zinc-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-700 file:text-white hover:file:bg-zinc-600 cursor-pointer"
        />
        {fileError && (
          <p className="text-sm text-red-400 mt-2">{fileError}</p>
        )}
      </div>

      <div className="flex items-center justify-between p-4 bg-zinc-800 border border-zinc-700 rounded-lg">
        <div>
          <p className="text-sm font-medium text-zinc-300">Substitute availability</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Would you like to be available as a substitute if needed?
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
          <input type="checkbox" name="sub_willing" defaultChecked={existing?.sub_willing ?? false} className="sr-only peer" />
          <div className="w-11 h-6 bg-zinc-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-pure-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
        </label>
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
        max={3000}
        required
        defaultValue={defaultValue ?? ""}
        placeholder="e.g. 1420"
        className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-500"
      />
    </div>
  );
}
