"use client";

import { useState, useTransition } from "react";
import { fetchEventExport, type TournamentPdfData } from "./tournament-pdf-actions";
import { purgeExportedArchive, type TournamentArchive } from "./tournament-archive";
import { toSafeDataUrl } from "./image-data-url";
import { LocalTime } from "../local-time";

// Logos must be self-contained in both downloaded files — they are meant to be
// kept on the admin's device and re-opened anytime, so a live storage URL that
// later 404s (bucket cleanup, team deleted) would silently break them.
async function resolveLogos(urls: (string | null)[]): Promise<Map<string, string | null>> {
  const unique = new Set(urls.filter((u): u is string => !!u));
  const resolved = new Map<string, string | null>();
  await Promise.all([...unique].map(async (u) => { resolved.set(u, await toSafeDataUrl(u)); }));
  return resolved;
}

function fileName(name: string, suffix: string) {
  return name.replace(/[^a-z0-9]/gi, "-").toLowerCase() + suffix;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function downloadArchiveJson(archive: TournamentArchive, name: string) {
  const resolved = await resolveLogos(archive.teams.map((t) => t.logoUrl));
  const inlined: TournamentArchive = {
    ...archive,
    teams: archive.teams.map((t) => ({
      ...t,
      logoUrl: t.logoUrl ? (resolved.get(t.logoUrl) ?? null) : null,
    })),
  };
  saveBlob(
    new Blob([JSON.stringify(inlined)], { type: "application/json" }),
    fileName(name, "-archive.json"),
  );
}

async function downloadReportPdf(data: TournamentPdfData) {
  const resolved = await resolveLogos([
    data.championLogoUrl,
    data.runnerUpLogoUrl,
    ...data.standings.map((r) => r.logoUrl),
  ]);
  const conv = (u: string | null) => (u ? resolved.get(u) ?? null : null);
  const inlined: TournamentPdfData = {
    ...data,
    championLogoUrl: conv(data.championLogoUrl),
    runnerUpLogoUrl: conv(data.runnerUpLogoUrl),
    standings: data.standings.map((r) => ({ ...r, logoUrl: conv(r.logoUrl) })),
  };

  const [{ pdf }, { TournamentReportDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./tournament-report-document"),
  ]);
  const blob = await pdf(<TournamentReportDocument data={inlined} />).toBlob();
  saveBlob(blob, fileName(data.name, "-report.pdf"));
}

/**
 * Stands in for the Export button's archive half once the archive has been
 * dropped. Without it the button quietly changes meaning, which reads as a bug
 * rather than as the space-saving it is.
 */
export function ArchivePurgedNote({ purgedAt }: { purgedAt: string }) {
  return (
    <span className="text-xs text-zinc-500">
      Archive exported · cleared from DB{" "}
      <LocalTime iso={purgedAt} dateOnly className="text-zinc-500" />
    </span>
  );
}

/**
 * The one export for a finished event: both files, then the archive goes.
 *
 * Stays visible after a purge, as a PDF-only export — the report is rebuilt
 * from `summary` every time, so it can be taken again as often as the admin
 * likes. Only the JSON is ever unrepeatable.
 */
export function ExportEventButton({
  kind,
  id,
  hasArchive,
}: {
  kind: "tournament" | "season";
  id: string;
  hasArchive: boolean;
}) {
  const [state, setState] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleClick() {
    setState("working");
    setError(null);
    startTransition(async () => {
      try {
        const data = await fetchEventExport(kind, id);
        if (!data) { setError("Could not load this event."); setState("idle"); return; }

        // The JSON goes first, deliberately. The PDF is rebuilt from `summary`
        // on every export, but once the archive is dropped the downloaded JSON
        // is the only copy in existence — so it has to be the file already on
        // disk if the browser blocks the second download of the pair.
        if (data.archive) await downloadArchiveJson(data.archive, data.name);
        await downloadReportPdf(data.pdf);
        if (data.archive) await purgeExportedArchive(kind, id);

        setState("idle");
      } catch (err) {
        setError(`Export failed${err instanceof Error ? `: ${err.message}` : "."}`);
        setState("idle");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={state === "working"}
        title={
          hasArchive
            ? "Downloads the PDF report and the JSON archive, then clears the archive from the database"
            : "Downloads the PDF report. This event's archive has already been exported."
        }
        className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-900/40 border border-zinc-700 hover:border-indigo-700/50 disabled:opacity-50 text-indigo-300 text-xs font-medium rounded-lg transition-colors"
      >
        {state === "working" ? "Exporting…" : hasArchive ? "Export" : "Export PDF"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
