"use client";

// Shown when a viewer who can't join presses Join anyway. The link is
// unconditional because /dashboard/register self-gates: it bounces approved
// players and guests back to the dashboard, and shows the Discord invite to
// anyone not in the server yet.
export function RegisterPromptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-white">Registration required</h2>
        <p className="text-sm text-zinc-400">
          Only registered players can enter a tournament. Register with the league and
          you&apos;ll be able to join the pool as soon as an admin approves you.
        </p>
        <div className="flex flex-col gap-2 mt-1">
          <a
            href="/dashboard/register"
            onClick={(e) => e.stopPropagation()}
            className="w-full text-center px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Register
          </a>
          <button
            onClick={onClose}
            className="w-full px-4 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
