"use client";

import { useState, useTransition } from "react";
import {
  purgeTournamentStandings,
  fetchCompletedTournamentPdfData,
  fetchActiveTournamentPdfData,
  fetchActiveSeasonPdfData,
  type TournamentPdfData,
} from "./tournament-pdf-actions";
import { completeTournament } from "./tournament-actions";
import { completeSeason } from "./league-actions";
import { toSafeDataUrl } from "./image-data-url";

async function sanitizeImages(data: TournamentPdfData): Promise<TournamentPdfData> {
  const urls = new Set<string>();
  if (data.championLogoUrl) urls.add(data.championLogoUrl);
  if (data.runnerUpLogoUrl) urls.add(data.runnerUpLogoUrl);
  data.standings.forEach((r) => { if (r.logoUrl) urls.add(r.logoUrl); });

  const resolved = new Map<string, string | null>();
  await Promise.all([...urls].map(async (u) => { resolved.set(u, await toSafeDataUrl(u)); }));
  const conv = (u: string | null) => (u ? resolved.get(u) ?? null : null);

  return {
    ...data,
    championLogoUrl: conv(data.championLogoUrl),
    runnerUpLogoUrl: conv(data.runnerUpLogoUrl),
    standings: data.standings.map((r) => ({ ...r, logoUrl: conv(r.logoUrl) })),
  };
}

async function downloadPdf(rawData: TournamentPdfData) {
  const data = await sanitizeImages(rawData);
  const [{ pdf }, { TournamentReportDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./tournament-report-document"),
  ]);
  const blob = await pdf(<TournamentReportDocument data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = data.name.replace(/[^a-z0-9]/gi, "-").toLowerCase() + "-report.pdf";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Completed tournament: Export PDF → purge standings ──────────────────────

export function ExportCompletedPdfButton({ tournamentId }: { tournamentId: string }) {
  const [step, setStep] = useState<"idle" | "warn" | "generating" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleConfirm() {
    setStep("generating");
    setError(null);
    startTransition(async () => {
      try {
        const data = await fetchCompletedTournamentPdfData(tournamentId);
        if (!data) { setError("Could not load tournament data."); setStep("warn"); return; }
        await downloadPdf(data);
        const res = await purgeTournamentStandings(tournamentId);
        if (res.error) { setError(res.error); setStep("warn"); return; }
        setStep("done");
      } catch (err) {
        setError(`Failed to generate PDF${err instanceof Error ? `: ${err.message}` : "."}`);
        setStep("warn");
      }
    });
  }

  if (step === "done") {
    return <span className="text-xs text-emerald-400 font-medium">Archived</span>;
  }

  if (step === "warn" || step === "generating") {
    return (
      <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
        <p className="text-xs text-zinc-300 leading-relaxed">
          This will download the full tournament report and permanently remove detailed
          standings. Only the champion, runner-up, and dates will be retained.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleConfirm}
            disabled={step === "generating"}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            {step === "generating" ? "Generating…" : "Download & Archive"}
          </button>
          {step !== "generating" && (
            <button
              onClick={() => { setStep("idle"); setError(null); }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setStep("warn")}
      className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-900/40 border border-zinc-700 hover:border-indigo-700/50 text-indigo-300 text-xs font-medium rounded-lg transition-colors"
    >
      Export PDF
    </button>
  );
}

// ── Active tournament: Export PDF → complete tournament ──────────────────────

export function ExportAndCompletePdfButton() {
  const [step, setStep] = useState<"idle" | "warn" | "generating" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleConfirm() {
    setStep("generating");
    setError(null);
    startTransition(async () => {
      try {
        const data = await fetchActiveTournamentPdfData();
        if (!data) { setError("No active tournament found."); setStep("warn"); return; }
        await downloadPdf(data);
        const res = await completeTournament();
        if (res.error) { setError(res.error); setStep("warn"); return; }
        setStep("done");
      } catch (err) {
        setError(`Failed to generate PDF${err instanceof Error ? `: ${err.message}` : "."}`);
        setStep("warn");
      }
    });
  }

  if (step === "done") {
    return <span className="text-xs text-emerald-400 font-medium">Completed & archived</span>;
  }

  if (step === "warn" || step === "generating") {
    return (
      <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
        <p className="text-xs text-zinc-300 leading-relaxed">
          This will download the full season report, complete the tournament, and reset the
          league pool. This cannot be undone.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleConfirm}
            disabled={step === "generating"}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            {step === "generating" ? "Generating…" : "Download & Complete"}
          </button>
          {step !== "generating" && (
            <button
              onClick={() => { setStep("idle"); setError(null); }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setStep("warn")}
      className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 border border-indigo-600 text-white text-xs font-medium rounded-lg transition-colors"
    >
      Export & Complete
    </button>
  );
}

// ── Manual season (no tournament): Export PDF → reset season ─────────────────

export function ExportAndResetSeasonButton() {
  const [step, setStep] = useState<"idle" | "warn" | "generating" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleConfirm() {
    setStep("generating");
    setError(null);
    startTransition(async () => {
      try {
        const data = await fetchActiveSeasonPdfData();
        if (!data) { setError("No active season found."); setStep("warn"); return; }
        await downloadPdf(data);
        const res = await completeSeason();
        if (res.error) { setError(res.error); setStep("warn"); return; }
        setStep("done");
      } catch (err) {
        setError(`Failed to generate PDF${err instanceof Error ? `: ${err.message}` : "."}`);
        setStep("warn");
      }
    });
  }

  if (step === "done") {
    return <span className="text-xs text-emerald-400 font-medium">Archived · season reset</span>;
  }

  if (step === "warn" || step === "generating") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-zinc-300 leading-relaxed">
          This downloads the full season report, archives the final standings to Past Events,
          then resets the season — deleting matches, unassigning players, and stripping team
          roles. This cannot be undone.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleConfirm}
            disabled={step === "generating"}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            {step === "generating" ? "Generating…" : "Download & Reset"}
          </button>
          {step !== "generating" && (
            <button
              onClick={() => { setStep("idle"); setError(null); }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setStep("warn")}
      className="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 border border-indigo-600 text-white text-sm font-medium rounded-lg transition-colors"
    >
      Export &amp; Reset Season
    </button>
  );
}
