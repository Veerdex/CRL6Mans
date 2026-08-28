"use client";

import { useState, useTransition } from "react";
import { createTheme, updateTheme, deleteTheme, type Theme, type ThemeInput } from "./theme-actions";
import { ThemeEditorModal } from "./theme-editor-modal";

function ThemeSwatches({ theme }: { theme: Theme }) {
  const colors = [theme.bg, theme.surface, theme.border, theme.text, theme.muted, theme.accent, theme.secondary, theme.shell];
  return (
    <div className="flex rounded-lg overflow-hidden border border-zinc-800 h-6 w-full">
      {colors.map((c, i) => (
        <span key={i} style={{ background: c }} className="flex-1" />
      ))}
    </div>
  );
}

export function ThemeDesignerSection({ themes }: { themes: Theme[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Theme | null | "new">(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function handleSave(input: ThemeInput) {
    const res = editing && editing !== "new" ? await updateTheme(editing.id, input) : await createTheme(input);
    if (res.error) return { error: res.error };
    return {};
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteTheme(id);
      if (res.error) setError(res.error);
      else setConfirmDeleteId(null);
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}

      {themes.length === 0 ? (
        <p className="text-xs text-zinc-600">No saved themes yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {themes.map((theme) => (
            <div key={theme.id} className="border border-zinc-800 rounded-xl p-3 space-y-2">
              <ThemeSwatches theme={theme} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-white truncate">{theme.name}</span>
                <span className="text-[11px] text-zinc-500 shrink-0">{theme.mode === "dark" ? "Dark" : "Light"}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditing(theme)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Edit
                </button>
                {confirmDeleteId === theme.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(theme.id)}
                      disabled={isPending}
                      className="text-xs text-red-400 underline disabled:opacity-40"
                    >
                      Confirm
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-zinc-500 underline">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(theme.id)}
                    className="text-xs text-red-500 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setEditing("new")}
        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        + New theme
      </button>

      {editing && (
        <ThemeEditorModal
          theme={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
