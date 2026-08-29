"use client";

import { useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import type { Design } from "./design-actions";
import { createDesign, updateDesignDetails, updateDesignContentCrop, toggleDesignStatus, deleteDesign } from "./design-actions";
import { MediaCropModal } from "./media-crop-modal";
import type { CropKind } from "@/app/lib/media-crop";

function StatusBadge({ status }: { status: "active" | "disabled" }) {
  return status === "active" ? (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded border text-emerald-400 bg-emerald-950/40 border-emerald-800/60">
      Active
    </span>
  ) : (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded border text-zinc-400 bg-zinc-800 border-zinc-700">
      Disabled
    </span>
  );
}

const IMAGE_FIELDS = [
  { kind: "background" as const, label: "Tournament/season background", hint: "Used for any tournament/season this design is attached to (with a dark overlay for legibility) — pick a wide photo, not an icon." },
  { kind: "topNav" as const, label: "Top nav image", hint: "Renders full-bleed as the top bar's background when assigned in Tab Manager — pick a wide photo, not an icon." },
  { kind: "sideNav" as const, label: "Side nav image", hint: "Renders full-bleed as the sidebar's background when assigned in Tab Manager — pick a tall photo, not an icon." },
];

function DesignCard({ design }: { design: Design }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [backgroundImageUrl, setBackgroundImageUrl] = useState(design.background_image_url ?? "");
  const [topNavImageUrl, setTopNavImageUrl] = useState(design.top_nav_image_url ?? "");
  const [sideNavImageUrl, setSideNavImageUrl] = useState(design.side_nav_image_url ?? "");
  const [uploading, setUploading] = useState<CropKind | null>(null);
  const [cropModalKind, setCropModalKind] = useState<CropKind | null>(null);

  const urlFor: Record<CropKind, string> = {
    background: backgroundImageUrl,
    topNav: topNavImageUrl,
    sideNav: sideNavImageUrl,
    logo: "",
  };
  const setterFor: Record<"background" | "topNav" | "sideNav", (v: string) => void> = {
    background: setBackgroundImageUrl,
    topNav: setTopNavImageUrl,
    sideNav: setSideNavImageUrl,
  };

  const hasChanges =
    backgroundImageUrl !== (design.background_image_url ?? "") ||
    topNavImageUrl !== (design.top_nav_image_url ?? "") ||
    sideNavImageUrl !== (design.side_nav_image_url ?? "");

  function handleSaveDetails() {
    setError(null);
    startTransition(async () => {
      const res = await updateDesignDetails(design.id, { backgroundImageUrl, topNavImageUrl, sideNavImageUrl });
      if (res.error) setError(res.error);
    });
  }

  async function handleUpload(kind: "background" | "topNav" | "sideNav", file: File) {
    setError(null);
    setUploading(kind);
    try {
      const blob = await upload(`designs/${design.id}-${kind}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/sponsors/upload-handler",
      });
      setterFor[kind](blob.url);
      const next = {
        backgroundImageUrl: kind === "background" ? blob.url : backgroundImageUrl,
        topNavImageUrl: kind === "topNav" ? blob.url : topNavImageUrl,
        sideNavImageUrl: kind === "sideNav" ? blob.url : sideNavImageUrl,
      };
      const res = await updateDesignDetails(design.id, next);
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  async function handleSaveCrop(kind: CropKind, crop: { x: number; y: number; zoom: number }) {
    return updateDesignContentCrop(design.id, kind, crop);
  }

  function handleToggleStatus() {
    setError(null);
    startTransition(async () => {
      const res = await toggleDesignStatus(design.id);
      if (res.error) setError(res.error);
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteDesign(design.id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-sm font-semibold text-white">{design.name}</span>
        <StatusBadge status={design.status} />
        <button
          onClick={handleToggleStatus}
          disabled={isPending}
          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
        >
          {design.status === "active" ? "Disable" : "Enable"}
        </button>
        {confirmDelete ? (
          <>
            <button onClick={handleDelete} disabled={isPending} className="text-xs text-red-400 underline">
              Confirm delete
            </button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-zinc-500 underline">
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-red-500 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="space-y-3">
        {IMAGE_FIELDS.map(({ kind, label, hint }) => (
          <div key={kind} className="space-y-1.5">
            <span className="text-xs text-zinc-500">{label}</span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={urlFor[kind]}
                onChange={(e) => setterFor[kind](e.target.value)}
                placeholder="https://..."
                className="flex-1 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
              />
              <label className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 cursor-pointer transition-colors">
                {uploading === kind ? "Uploading…" : "Upload"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(kind, f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => setCropModalKind(kind)}
                disabled={!urlFor[kind]}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Preview
              </button>
            </div>
            <p className="text-[11px] text-zinc-600">{hint}</p>
          </div>
        ))}

        <button
          onClick={handleSaveDetails}
          disabled={isPending || !hasChanges}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
        >
          Save details
        </button>
      </div>

      {cropModalKind && (
        <MediaCropModal
          kind={cropModalKind}
          url={urlFor[cropModalKind]}
          initialCrop={design.content_crop?.[cropModalKind]}
          onClose={() => setCropModalKind(null)}
          onSave={(crop) => handleSaveCrop(cropModalKind, crop)}
        />
      )}
    </div>
  );
}

export function DesignsSection({ designs }: { designs: Design[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedDesignId, setSelectedDesignId] = useState<string | null>(designs[0]?.id ?? null);

  const selectedDesign = designs.find((d) => d.id === selectedDesignId) ?? designs[0] ?? null;

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createDesign(name);
      if (res.error) setError(res.error);
      else setName("");
    });
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/50 rounded-lg px-4 py-2">{error}</p>}

      {designs.length === 0 ? (
        <p className="text-sm text-zinc-500">No designs yet.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {designs.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDesignId(d.id)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedDesign?.id === d.id
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                }`}
              >
                {d.status === "disabled" && <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />}
                {d.name}
              </button>
            ))}
          </div>

          {selectedDesign && <DesignCard key={selectedDesign.id} design={selectedDesign} />}
        </div>
      )}

      <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-zinc-300">Add Design</p>
        <div className="flex flex-wrap gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Design name"
            className="flex-1 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600"
          />
        </div>
        <button
          onClick={handleCreate}
          disabled={isPending || !name.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}
