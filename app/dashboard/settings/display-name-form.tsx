"use client";

import { useActionState } from "react";
import { saveDisplayName } from "./actions";

export function DisplayNameForm({
  current,
  discordUsername,
}: {
  current: string | null;
  discordUsername: string;
}) {
  const [state, action, pending] = useActionState(saveDisplayName, {});

  return (
    <form action={action} className="space-y-2">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Display Name</p>
      <p className="text-xs text-zinc-500">
        Shown instead of your Discord username throughout the app. Leave blank to use your Discord username ({discordUsername}).
      </p>
      <div className="flex gap-2">
        <input
          name="display_name"
          type="text"
          maxLength={30}
          defaultValue={current ?? ""}
          placeholder={discordUsername}
          className="flex-1 bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors shrink-0"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state?.ok && <p className="text-xs text-emerald-400">Nickname saved.</p>}
    </form>
  );
}
