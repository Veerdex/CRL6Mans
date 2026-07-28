"use client";

import { useState, useTransition } from "react";
import { exportTournamentArchive, type TournamentArchive } from "./tournament-archive";
import { toSafeDataUrl } from "./image-data-url";

// Logos must be self-contained in the downloaded file — it's meant to be kept
// on the admin's device and re-opened anytime, so a live storage URL that
// later 404s (bucket cleanup, team deleted) would silently break the "rosters
// + team logos" this archive promises.
async function sanitizeArchiveImages(archive: TournamentArchive): Promise<TournamentArchive> {
  const urls = new Set<string>();
  archive.teams.forEach((t) => { if (t.logoUrl) urls.add(t.logoUrl); });

  const resolved = new Map<string, string | null>();
  await Promise.all([...urls].map(async (u) => { resolved.set(u, await toSafeDataUrl(u)); }));

  return {
    ...archive,
    teams: archive.teams.map((t) => ({
      ...t,
      logoUrl: t.logoUrl ? (resolved.get(t.logoUrl) ?? null) : null,
    })),
  };
}

function downloadJson(archive: TournamentArchive, name: string) {
  const blob = new Blob([JSON.stringify(archive)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[^a-z0-9]/gi, "-").toLowerCase() + "-archive.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DownloadArchiveButton({
  kind,
  id,
  name,
}: {
  kind: "tournament" | "season";
  id: string;
  name: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [, startTransition] = useTransition();

  function handleClick() {
    setState("working");
    startTransition(async () => {
      try {
        const archive = await exportTournamentArchive(kind, id);
        if (!archive) { setState("error"); return; }
        const sanitized = await sanitizeArchiveImages(archive);
        downloadJson(sanitized, name);
        setState("idle");
      } catch {
        setState("error");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={state === "working"}
        className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-900/40 border border-zinc-700 hover:border-indigo-700/50 disabled:opacity-50 text-indigo-300 text-xs font-medium rounded-lg transition-colors"
      >
        {state === "working" ? "Preparing…" : "Download Archive"}
      </button>
      {state === "error" && <span className="text-xs text-red-400">No archive found.</span>}
    </div>
  );
}
