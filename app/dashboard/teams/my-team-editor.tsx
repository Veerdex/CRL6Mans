"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTeamInfo, toggleTeamLock } from "./actions";

interface Team {
  id: string;
  name: string;
  logo_url: string | null;
  logo_offset_x: number;
  logo_offset_y: number;
  is_locked: boolean;
}

export function MyTeamEditor({
  team,
  isAdmin,
  seasonActive = false,
  label = "My Team",
}: {
  team: Team;
  isAdmin: boolean;
  seasonActive?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(team.name);
  const [preview, setPreview] = useState<string | null>(team.logo_url);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [posX, setPosX] = useState(team.logo_offset_x ?? 50);
  const [posY, setPosY] = useState(team.logo_offset_y ?? 50);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  // Drag-to-reposition state
  const previewRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragOrigin = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      // Pan behavior: drag right → image pans right → object-position X decreases
      const dx = ((e.clientX - dragOrigin.current.mx) / rect.width) * 100;
      const dy = ((e.clientY - dragOrigin.current.my) / rect.height) * 100;
      setPosX(Math.max(0, Math.min(100, dragOrigin.current.px - dx)));
      setPosY(Math.max(0, Math.min(100, dragOrigin.current.py - dy)));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setLogoFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleSave = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("teamId", team.id);
      fd.append("name", name);
      fd.append("offsetX", String(Math.round(posX)));
      fd.append("offsetY", String(Math.round(posY)));
      if (logoFile) fd.append("logo", logoFile);

      const result = await updateTeamInfo(fd);
      if ("error" in result) {
        setFeedback({ msg: result.error, ok: false });
      } else {
        setFeedback({ msg: "Saved!", ok: true });
        setLogoFile(null);
        router.refresh();
      }
      setTimeout(() => setFeedback(null), 3000);
    });
  };

  const handleLockToggle = () => {
    startTransition(async () => {
      await toggleTeamLock(team.id);
      router.refresh();
    });
  };

  // Before season: always editable by any team member.
  // After season starts: locked by default (auto-locked on season start); admin can unlock.
  const canEdit = !seasonActive || isAdmin || !team.is_locked;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">{label}</h2>
        <div className="flex items-center gap-2">
          {seasonActive && team.is_locked && !isAdmin && (
            <span className="text-xs text-amber-400">🔒 Locked</span>
          )}
          {isAdmin && seasonActive && (
            <button
              onClick={handleLockToggle}
              disabled={isPending}
              className="text-xs px-3 py-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-lg transition-colors"
            >
              {team.is_locked ? "Unlock" : "Lock"}
            </button>
          )}
        </div>
      </div>

      {!canEdit ? (
        <div className="px-5 py-6 text-sm text-zinc-500">
          Team info is locked for the season. Ask an admin to unlock it.
        </div>
      ) : (
        <div className="p-5 space-y-5">
          {/* Team name */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Team Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Logo upload */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Team Logo</label>
            <div
              onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onClick={() => document.getElementById(`logo-input-${team.id}`)?.click()}
              className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors select-none ${
                isDragOver
                  ? "border-indigo-500 bg-indigo-500/10"
                  : "border-zinc-700 hover:border-zinc-500"
              }`}
            >
              <input
                id={`logo-input-${team.id}`}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
              />
              <p className="text-sm text-zinc-400">
                {isDragOver ? "Drop to upload" : "Drop image here or click to browse"}
              </p>
              <p className="text-xs text-zinc-600 mt-1">PNG, JPG, SVG supported</p>
            </div>
          </div>

          {/* Preview + alignment */}
          {preview && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">
                Logo Preview — drag image to reposition
              </label>
              <div className="flex items-start gap-5">
                {/* Draggable preview box */}
                <div
                  ref={previewRef}
                  className="w-24 h-24 rounded-xl overflow-hidden border border-zinc-700 cursor-grab active:cursor-grabbing shrink-0 select-none"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    dragging.current = true;
                    dragOrigin.current = { mx: e.clientX, my: e.clientY, px: posX, py: posY };
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview}
                    alt="logo preview"
                    className="w-full h-full object-cover pointer-events-none"
                    style={{ objectPosition: `${posX}% ${posY}%` }}
                    draggable={false}
                  />
                </div>

                {/* Sliders */}
                <div className="flex-1 space-y-3 pt-1">
                  <div>
                    <div className="flex justify-between text-xs text-zinc-500 mb-1">
                      <span>Horizontal</span>
                      <span>{Math.round(posX)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={posX}
                      onChange={(e) => setPosX(Number(e.target.value))}
                      className="w-full accent-indigo-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-500 mb-1">
                      <span>Vertical</span>
                      <span>{Math.round(posY)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={posY}
                      onChange={(e) => setPosY(Number(e.target.value))}
                      className="w-full accent-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Save */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {isPending ? "Saving…" : "Save Changes"}
            </button>
            {feedback && (
              <span className={`text-sm ${feedback.ok ? "text-green-400" : "text-red-400"}`}>
                {feedback.msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
