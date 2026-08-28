"use client";

import { useEffect, useState } from "react";
import type { Theme, ThemeInput } from "./theme-actions";

const COLOR_FIELDS: { key: keyof ThemeInput; label: string }[] = [
  { key: "bg", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "border", label: "Border" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Muted text" },
  { key: "accent", label: "Accent" },
  { key: "secondary", label: "Secondary" },
  { key: "shell", label: "Sidebar" },
];

const DEFAULT_INPUT: ThemeInput = {
  name: "",
  mode: "light",
  bg: "#d5dbf2",
  surface: "#f1f3fd",
  border: "#c2c9ec",
  text: "#1e1d44",
  muted: "#6d72a6",
  accent: "#e88a24",
  secondary: "#e88a24",
  shell: "#3736ac",
};

export function ThemeEditorModal({
  theme,
  onClose,
  onSave,
}: {
  theme: Theme | null;
  onClose: () => void;
  onSave: (input: ThemeInput) => Promise<{ error?: string } | void>;
}) {
  const [input, setInput] = useState<ThemeInput>(
    theme
      ? {
          name: theme.name,
          mode: theme.mode,
          bg: theme.bg,
          surface: theme.surface,
          border: theme.border,
          text: theme.text,
          muted: theme.muted,
          accent: theme.accent,
          secondary: theme.secondary,
          shell: theme.shell,
        }
      : DEFAULT_INPUT
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function set<K extends keyof ThemeInput>(key: K, value: ThemeInput[K]) {
    setInput((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const res = await onSave(input);
    setSaving(false);
    if (res?.error) setError(res.error);
    else onClose();
  }

  const previewVars = {
    "--pv-bg": input.bg,
    "--pv-surface": input.surface,
    "--pv-border": input.border,
    "--pv-text": input.text,
    "--pv-muted": input.muted,
    "--pv-accent": input.accent,
    "--pv-secondary": input.secondary,
    "--pv-shell": input.shell,
  } as React.CSSProperties;

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">{theme ? "Edit theme" : "New theme"}</p>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-sm">
            Close
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={input.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Theme name"
            className="flex-1 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-zinc-600"
          />
          <select
            value={input.mode}
            onChange={(e) => set("mode", e.target.value === "dark" ? "dark" : "light")}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white"
          >
            <option value="light">Light base</option>
            <option value="dark">Dark base</option>
          </select>
        </div>
        <p className="text-[11px] text-zinc-500 -mt-2">
          Light/Dark base also sets the remaining grey tones — match it to your background, or text can end up illegible.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {COLOR_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="color"
                value={input[key] as string}
                onChange={(e) => set(key, e.target.value as ThemeInput[typeof key])}
                className="w-7 h-7 rounded border border-zinc-700 bg-zinc-800 cursor-pointer shrink-0"
              />
              {label}
            </label>
          ))}
        </div>

        <div>
          <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">Preview</p>
          <div
            style={{ ...previewVars, background: "var(--pv-bg)", color: "var(--pv-text)", borderColor: "var(--pv-border)" }}
            className="rounded-xl border overflow-hidden flex"
          >
            <div style={{ background: "var(--pv-shell)" }} className="w-20 shrink-0 p-3 space-y-2">
              <div className="h-2 w-10 rounded bg-white/80" />
              <div className="h-2 w-14 rounded bg-white/40" />
              <div className="h-2 w-8 rounded bg-white/40" />
            </div>
            <div className="flex-1 p-4 space-y-3">
              <div
                style={{ background: "var(--pv-surface)", borderColor: "var(--pv-border)" }}
                className="rounded-lg border p-3 space-y-2"
              >
                <p className="text-sm font-semibold">Card title</p>
                <p style={{ color: "var(--pv-muted)" }} className="text-xs">
                  Muted supporting text sits here.
                </p>
                <div className="flex gap-2">
                  <span style={{ background: "var(--pv-accent)" }} className="text-white text-xs px-3 py-1 rounded-lg">
                    Accent button
                  </span>
                  <span style={{ background: "var(--pv-secondary)" }} className="text-white text-xs px-3 py-1 rounded-lg">
                    Secondary
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
