"use client";

import { useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import type { Sponsor, SponsorLink, NavPlacement } from "./sponsor-actions";
import {
  createSponsor,
  updateSponsorMaxUses,
  updateSponsorDetails,
  toggleSponsorStatus,
  removeSponsorMember,
  updateNavPlacement,
} from "./sponsor-actions";

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

function LinksEditor({ links, onChange }: { links: SponsorLink[]; onChange: (links: SponsorLink[]) => void }) {
  function updateLink(i: number, field: "label" | "url", value: string) {
    onChange(links.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }
  function removeLink(i: number) {
    onChange(links.filter((_, idx) => idx !== i));
  }
  function addLink() {
    onChange([...links, { label: "", url: "" }]);
  }

  return (
    <div className="space-y-1.5">
      <span className="text-xs text-zinc-500">Links</span>
      {links.map((l, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={l.label}
            onChange={(e) => updateLink(i, "label", e.target.value)}
            placeholder="Label"
            className="w-28 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
          />
          <input
            value={l.url}
            onChange={(e) => updateLink(i, "url", e.target.value)}
            placeholder="https://..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
          />
          <button onClick={() => removeLink(i)} className="text-xs text-red-500 hover:text-red-400 transition-colors">
            Remove
          </button>
        </div>
      ))}
      <button onClick={addLink} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
        + Add link
      </button>
    </div>
  );
}

type ContentKind = "video" | "topNav" | "sideNav";
type ContentItem = { kind: ContentKind | ""; url: string };

const ALL_CONTENT_KINDS: ContentKind[] = ["video", "topNav", "sideNav"];
const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  video: "Video",
  topNav: "Top nav image",
  sideNav: "Side nav image",
};

function SponsorPreview({
  name,
  logoUrl,
  promoCode,
  links,
}: {
  name: string;
  logoUrl: string;
  promoCode: string;
  links: SponsorLink[];
}) {
  return (
    <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-950 space-y-2">
      <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Preview</p>
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-zinc-800" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-zinc-800" />
        )}
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">{name || "Sponsor name"}</p>
        </div>
      </div>
      {links.filter((l) => l.label && l.url).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links
            .filter((l) => l.label && l.url)
            .map((l, i) => (
              <span key={i} className="text-xs text-indigo-400">
                {l.label}
              </span>
            ))}
        </div>
      )}
      {promoCode && (
        <p className="text-xs text-zinc-400 font-mono">
          Code: <span className="text-white">{promoCode}</span>
        </p>
      )}
    </div>
  );
}

function SponsorCard({ sponsor }: { sponsor: Sponsor }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [promoCopied, setPromoCopied] = useState(false);
  const [maxUsesInput, setMaxUsesInput] = useState(String(sponsor.max_uses));
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const [logoUrl, setLogoUrl] = useState(sponsor.logo_url ?? "");
  const [contentItems, setContentItems] = useState<ContentItem[]>(() => {
    const items: ContentItem[] = [];
    if (sponsor.video_url) items.push({ kind: "video", url: sponsor.video_url });
    if (sponsor.top_nav_image_url) items.push({ kind: "topNav", url: sponsor.top_nav_image_url });
    if (sponsor.side_nav_image_url) items.push({ kind: "sideNav", url: sponsor.side_nav_image_url });
    return items;
  });
  const [links, setLinks] = useState<SponsorLink[]>(sponsor.links);
  const [promoCode, setPromoCode] = useState(sponsor.promo_code ?? "");
  const [uploading, setUploading] = useState<"logo" | ContentKind | null>(null);

  const inviteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/sponsor/join/${sponsor.invite_token}` : "";

  function urlForKind(kind: ContentKind, items: ContentItem[] = contentItems): string {
    return items.find((c) => c.kind === kind)?.url ?? "";
  }

  const hasDetailsChanges =
    logoUrl !== (sponsor.logo_url ?? "") ||
    urlForKind("video") !== (sponsor.video_url ?? "") ||
    urlForKind("topNav") !== (sponsor.top_nav_image_url ?? "") ||
    urlForKind("sideNav") !== (sponsor.side_nav_image_url ?? "") ||
    promoCode !== (sponsor.promo_code ?? "") ||
    JSON.stringify(links) !== JSON.stringify(sponsor.links);

  function handleCopy() {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopyPromo() {
    if (!promoCode) return;
    navigator.clipboard.writeText(promoCode).then(() => {
      setPromoCopied(true);
      setTimeout(() => setPromoCopied(false), 2000);
    });
  }

  function handleSaveMaxUses() {
    setError(null);
    const parsed = Number(maxUsesInput);
    startTransition(async () => {
      const res = await updateSponsorMaxUses(sponsor.id, parsed);
      if (res.error) setError(res.error);
    });
  }

  function handleSaveDetails() {
    setError(null);
    startTransition(async () => {
      const res = await updateSponsorDetails(sponsor.id, {
        logoUrl,
        videoUrl: urlForKind("video"),
        topNavImageUrl: urlForKind("topNav"),
        sideNavImageUrl: urlForKind("sideNav"),
        links,
        promoCode,
      });
      if (res.error) setError(res.error);
    });
  }

  function addContentItem() {
    setContentItems((items) => [...items, { kind: "", url: "" }]);
  }
  function updateContentItem(index: number, patch: Partial<ContentItem>) {
    setContentItems((items) => items.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  function removeContentItem(index: number) {
    setContentItems((items) => items.filter((_, i) => i !== index));
  }

  async function handleLogoUpload(file: File) {
    setError(null);
    setUploading("logo");
    try {
      const blob = await upload(`sponsors/${sponsor.id}-logo-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/sponsors/upload-handler",
      });
      setLogoUrl(blob.url);
      const res = await updateSponsorDetails(sponsor.id, {
        logoUrl: blob.url,
        videoUrl: urlForKind("video"),
        topNavImageUrl: urlForKind("topNav"),
        sideNavImageUrl: urlForKind("sideNav"),
        links,
        promoCode,
      });
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  async function handleContentUpload(index: number, kind: ContentKind, file: File) {
    setError(null);
    setUploading(kind);
    try {
      const blob = await upload(`sponsors/${sponsor.id}-${kind}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/sponsors/upload-handler",
      });
      const nextItems = contentItems.map((c, i) => (i === index ? { ...c, url: blob.url } : c));
      setContentItems(nextItems);
      const res = await updateSponsorDetails(sponsor.id, {
        logoUrl,
        videoUrl: urlForKind("video", nextItems),
        topNavImageUrl: urlForKind("topNav", nextItems),
        sideNavImageUrl: urlForKind("sideNav", nextItems),
        links,
        promoCode,
      });
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  function handleToggleStatus() {
    setError(null);
    startTransition(async () => {
      const res = await toggleSponsorStatus(sponsor.id);
      if (res.error) setError(res.error);
    });
  }

  function handleRemoveMember(memberId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeSponsorMember(memberId);
      if (res.error) setError(res.error);
      else setConfirmRemoveId(null);
    });
  }

  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-sm font-semibold text-white">{sponsor.name}</span>
        <StatusBadge status={sponsor.status} />
        <span className="text-xs text-zinc-500">
          {sponsor.members.length} / {sponsor.max_uses} used
        </span>
        <button
          onClick={handleToggleStatus}
          disabled={isPending}
          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
        >
          {sponsor.status === "active" ? "Disable" : "Enable"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={inviteUrl}
          className="flex-1 min-w-[200px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-400 font-mono"
        />
        <button
          onClick={handleCopy}
          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">Max uses</span>
        <input
          value={maxUsesInput}
          onChange={(e) => setMaxUsesInput(e.target.value)}
          className="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white"
        />
        <button
          onClick={handleSaveMaxUses}
          disabled={isPending || maxUsesInput === String(sponsor.max_uses)}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
        >
          Save
        </button>
      </div>

      <div className="border-t border-zinc-800 pt-4 space-y-3">
        <div className="space-y-1.5">
          <span className="text-xs text-zinc-500">Logo</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
            />
            <label className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 cursor-pointer transition-colors">
              {uploading === "logo" ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoUpload(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs text-zinc-500">Content</span>
          {contentItems.map((item, i) => {
            const usedKinds = new Set(contentItems.map((c) => c.kind).filter(Boolean));
            const availableKinds = ALL_CONTENT_KINDS.filter((k) => k === item.kind || !usedKinds.has(k));
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={item.kind}
                  onChange={(e) => updateContentItem(i, { kind: e.target.value as ContentKind | "", url: "" })}
                  className="w-36 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  <option value="">Select label</option>
                  {availableKinds.map((k) => (
                    <option key={k} value={k}>
                      {CONTENT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                {item.kind && (
                  <>
                    <input
                      value={item.url}
                      onChange={(e) => updateContentItem(i, { url: e.target.value })}
                      placeholder={item.kind === "video" ? "https://youtube.com/... or https://..." : "https://..."}
                      className="flex-1 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
                    />
                    <label className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 cursor-pointer transition-colors">
                      {uploading === item.kind ? "Uploading…" : "Upload"}
                      <input
                        type="file"
                        accept={item.kind === "video" ? "video/*" : "image/*"}
                        className="hidden"
                        disabled={uploading !== null}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f && item.kind) handleContentUpload(i, item.kind, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </>
                )}
                <button onClick={() => removeContentItem(i)} className="text-xs text-red-500 hover:text-red-400 transition-colors">
                  Remove
                </button>
              </div>
            );
          })}
          <button
            onClick={addContentItem}
            disabled={contentItems.length >= ALL_CONTENT_KINDS.length}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Add content
          </button>
        </div>

        <LinksEditor links={links} onChange={setLinks} />

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Promo code</span>
          <input
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            placeholder="CODE10"
            className="w-32 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white placeholder:text-zinc-600"
          />
          <button
            onClick={handleCopyPromo}
            disabled={!promoCode}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            {promoCopied ? "Copied!" : "Copy"}
          </button>
        </div>

        <button
          onClick={handleSaveDetails}
          disabled={isPending || !hasDetailsChanges}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
        >
          Save details
        </button>

        <SponsorPreview name={sponsor.name} logoUrl={logoUrl} promoCode={promoCode} links={links} />
      </div>

      {sponsor.members.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Members</p>
          {sponsor.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <span className="flex-1 text-sm text-white">{m.display_name ?? m.username}</span>
              <span className="text-xs text-zinc-500 font-mono">{m.discord_id}</span>
              {confirmRemoveId === m.id ? (
                <>
                  <button onClick={() => handleRemoveMember(m.id)} className="text-xs text-red-400 underline">
                    Confirm
                  </button>
                  <button onClick={() => setConfirmRemoveId(null)} className="text-xs text-zinc-500 underline">
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmRemoveId(m.id)}
                  className="text-xs text-red-500 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Each configurable placement is a "tab" an admin can assign a sponsor to.
// Only two exist today (top nav, side nav) — more will be added here as
// individual dashboard tabs grow sponsor placements of their own. A sponsor
// only appears as an option for a placement once it actually has that
// content filled in, so picking one always has something to show.
const TAB_PLACEMENTS = [
  { key: "topNavSponsorId", label: "Top nav", hasContent: (s: Sponsor) => !!s.top_nav_image_url },
  { key: "sideNavSponsorId", label: "Side nav", hasContent: (s: Sponsor) => !!s.side_nav_image_url },
] as const;

export function TabManagerSection({ sponsors, navPlacement }: { sponsors: Sponsor[]; navPlacement: NavPlacement }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [topNavSponsorId, setTopNavSponsorId] = useState(navPlacement.topNavSponsorId ?? "");
  const [sideNavSponsorId, setSideNavSponsorId] = useState(navPlacement.sideNavSponsorId ?? "");

  const selected: Record<(typeof TAB_PLACEMENTS)[number]["key"], string> = {
    topNavSponsorId,
    sideNavSponsorId,
  };
  const setters: Record<(typeof TAB_PLACEMENTS)[number]["key"], (v: string) => void> = {
    topNavSponsorId: setTopNavSponsorId,
    sideNavSponsorId: setSideNavSponsorId,
  };

  const activeSponsors = sponsors.filter((s) => s.status === "active");

  const hasChanges =
    topNavSponsorId !== (navPlacement.topNavSponsorId ?? "") ||
    sideNavSponsorId !== (navPlacement.sideNavSponsorId ?? "");

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await updateNavPlacement(topNavSponsorId || null, sideNavSponsorId || null);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
      <p className="text-xs text-zinc-500">
        Only the top nav and side nav placements are configurable for now — more tabs will get their own sponsor
        placement here later.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-3">
        {TAB_PLACEMENTS.map((placement) => {
          const eligible = activeSponsors.filter(placement.hasContent);
          return (
            <div key={placement.key} className="flex-1 min-w-[160px] space-y-1">
              <span className="text-xs text-zinc-500">{placement.label} sponsor</span>
              <select
                value={selected[placement.key]}
                onChange={(e) => setters[placement.key](e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white"
              >
                <option value="">None</option>
                {eligible.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {eligible.length === 0 && (
                <p className="text-[11px] text-zinc-600">No active sponsor has a {placement.label.toLowerCase()} image set yet.</p>
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={handleSave}
        disabled={isPending || !hasChanges}
        className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
      >
        Save
      </button>
    </div>
  );
}

export function SponsorsManager({ sponsors }: { sponsors: Sponsor[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [logoUrl, setLogoUrl] = useState("");

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createSponsor(name, Number(maxUses), logoUrl);
      if (res.error) setError(res.error);
      else {
        setName("");
        setMaxUses("1");
        setLogoUrl("");
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/50 rounded-lg px-4 py-2">{error}</p>}

      {sponsors.length === 0 ? (
        <p className="text-sm text-zinc-500">No sponsors yet.</p>
      ) : (
        <div className="space-y-3">
          {sponsors.map((s) => (
            <SponsorCard key={s.id} sponsor={s} />
          ))}
        </div>
      )}

      <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-zinc-300">Add Sponsor</p>
        <div className="flex flex-wrap gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sponsor name"
            className="flex-1 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600"
          />
          <input
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Max uses"
            className="w-28 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="Logo URL (optional)"
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
