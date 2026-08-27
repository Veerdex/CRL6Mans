"use client";

import { useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import type { Sponsor, SponsorLink, TabPlacement } from "./sponsor-actions";
import {
  createSponsor,
  updateSponsorMaxUses,
  updateSponsorDetails,
  updateContentCrop,
  toggleSponsorStatus,
  removeSponsorMember,
  updateTabPlacement,
  updateSeasonSponsor,
} from "./sponsor-actions";
import { savePatreonUrl } from "./league-actions";
import { MediaCropModal } from "./media-crop-modal";
import type { CropKind } from "@/app/lib/media-crop";

function PatreonLinkCard({ patreonUrl }: { patreonUrl: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [urlInput, setUrlInput] = useState(patreonUrl ?? "");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const handleSave = () => startTransition(async () => {
    const result = await savePatreonUrl(urlInput);
    setMessage({ text: result.message, ok: result.ok });
  });

  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-white">Patreon Link</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          Powers the &quot;Become a Patron&quot; button on the public Support Us page. A general league setting, not tied to any one sponsor. Leave blank to hide the button.
        </p>
      </div>
      <input
        type="url"
        value={urlInput}
        onChange={e => setUrlInput(e.target.value)}
        placeholder="https://patreon.com/your-page"
        className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isPending || urlInput === (patreonUrl ?? "")}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Save Patreon Link
        </button>
        {message && (
          <span className={`text-xs ${message.ok ? "text-emerald-400" : "text-red-400"}`}>{message.text}</span>
        )}
      </div>
    </div>
  );
}

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

type ContentKind = "video" | "topNav" | "sideNav" | "background" | "theme" | "link";
type ContentItem = {
  kind: ContentKind | "";
  url: string;
  themeName?: string;
  themeAccent?: string;
  themeShell?: string;
  themeSecondary?: string;
  themeMode?: "light" | "dark";
};

const ALL_CONTENT_KINDS: ContentKind[] = ["video", "topNav", "sideNav", "background", "theme", "link"];
const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  video: "Video",
  topNav: "Top nav image",
  sideNav: "Side nav image",
  background: "Tournament card background",
  theme: "Theme",
  link: "Click-through link",
};
const THEME_DEFAULTS = { themeAccent: "#e88a24", themeShell: "#3736ac", themeSecondary: "#e88a24", themeMode: "light" as const };

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
    if (sponsor.background_image_url) items.push({ kind: "background", url: sponsor.background_image_url });
    if (sponsor.click_url) items.push({ kind: "link", url: sponsor.click_url });
    if (sponsor.theme_name) {
      items.push({
        kind: "theme",
        url: "",
        themeName: sponsor.theme_name,
        themeAccent: sponsor.theme_accent ?? THEME_DEFAULTS.themeAccent,
        themeShell: sponsor.theme_shell ?? THEME_DEFAULTS.themeShell,
        themeSecondary: sponsor.theme_secondary ?? THEME_DEFAULTS.themeSecondary,
        themeMode: sponsor.theme_mode ?? THEME_DEFAULTS.themeMode,
      });
    }
    return items;
  });
  const [links, setLinks] = useState<SponsorLink[]>(sponsor.links);
  const [promoCode, setPromoCode] = useState(sponsor.promo_code ?? "");
  const [phrase, setPhrase] = useState(sponsor.phrase ?? "");
  const [overview, setOverview] = useState(sponsor.overview ?? "");
  const [promoDescription, setPromoDescription] = useState(sponsor.promo_description ?? "");
  const [uploading, setUploading] = useState<"logo" | ContentKind | null>(null);
  const [cropModalKind, setCropModalKind] = useState<CropKind | null>(null);

  const inviteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/sponsor/join/${sponsor.invite_token}` : "";

  function urlForKind(kind: ContentKind, items: ContentItem[] = contentItems): string {
    return items.find((c) => c.kind === kind)?.url ?? "";
  }
  function themeItem(items: ContentItem[] = contentItems) {
    return items.find((c) => c.kind === "theme");
  }
  function themeFields(items: ContentItem[] = contentItems) {
    const t = themeItem(items);
    return {
      themeName: t?.themeName ?? "",
      themeAccent: t?.themeAccent ?? "",
      themeShell: t?.themeShell ?? "",
      themeSecondary: t?.themeSecondary ?? "",
      themeMode: t?.themeMode ?? THEME_DEFAULTS.themeMode,
    };
  }

  const hasDetailsChanges =
    logoUrl !== (sponsor.logo_url ?? "") ||
    urlForKind("video") !== (sponsor.video_url ?? "") ||
    urlForKind("topNav") !== (sponsor.top_nav_image_url ?? "") ||
    urlForKind("sideNav") !== (sponsor.side_nav_image_url ?? "") ||
    urlForKind("background") !== (sponsor.background_image_url ?? "") ||
    urlForKind("link") !== (sponsor.click_url ?? "") ||
    promoCode !== (sponsor.promo_code ?? "") ||
    phrase !== (sponsor.phrase ?? "") ||
    overview !== (sponsor.overview ?? "") ||
    promoDescription !== (sponsor.promo_description ?? "") ||
    (themeItem()?.themeName ?? "") !== (sponsor.theme_name ?? "") ||
    (themeItem()?.themeAccent ?? "") !== (sponsor.theme_accent ?? "") ||
    (themeItem()?.themeShell ?? "") !== (sponsor.theme_shell ?? "") ||
    (themeItem()?.themeSecondary ?? "") !== (sponsor.theme_secondary ?? "") ||
    (themeItem()?.themeMode ?? THEME_DEFAULTS.themeMode) !== (sponsor.theme_mode ?? THEME_DEFAULTS.themeMode) ||
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
        backgroundImageUrl: urlForKind("background"),
        clickUrl: urlForKind("link"),
        links,
        promoCode,
        phrase,
        overview,
        promoDescription,
        ...themeFields(),
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
        backgroundImageUrl: urlForKind("background"),
        clickUrl: urlForKind("link"),
        links,
        promoCode,
        phrase,
        overview,
        promoDescription,
        ...themeFields(),
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
        backgroundImageUrl: urlForKind("background", nextItems),
        clickUrl: urlForKind("link", nextItems),
        links,
        promoCode,
        phrase,
        overview,
        promoDescription,
        ...themeFields(nextItems),
      });
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  function cropUrlFor(kind: CropKind): string {
    return kind === "logo" ? logoUrl : urlForKind(kind);
  }

  async function handleSaveCrop(kind: CropKind, crop: { x: number; y: number; zoom: number }) {
    return updateContentCrop(sponsor.id, kind, crop);
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
            <button
              type="button"
              onClick={() => setCropModalKind("logo")}
              disabled={!logoUrl}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Preview
            </button>
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
                  onChange={(e) => {
                    const kind = e.target.value as ContentKind | "";
                    updateContentItem(i, kind === "theme" ? { kind, url: "", themeName: "", themeAccent: THEME_DEFAULTS.themeAccent, themeShell: THEME_DEFAULTS.themeShell, themeSecondary: THEME_DEFAULTS.themeSecondary, themeMode: THEME_DEFAULTS.themeMode } : { kind, url: "" });
                  }}
                  className="w-36 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  <option value="">Select label</option>
                  {availableKinds.map((k) => (
                    <option key={k} value={k}>
                      {CONTENT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                {item.kind === "theme" && (
                  <>
                    <input
                      value={item.themeName ?? ""}
                      onChange={(e) => updateContentItem(i, { themeName: e.target.value })}
                      placeholder="Theme name"
                      className="w-32 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
                    />
                    <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      Accent
                      <input
                        type="color"
                        value={item.themeAccent ?? THEME_DEFAULTS.themeAccent}
                        onChange={(e) => updateContentItem(i, { themeAccent: e.target.value })}
                        className="w-7 h-7 rounded border border-zinc-700 bg-zinc-800 cursor-pointer"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      Sidebar
                      <input
                        type="color"
                        value={item.themeShell ?? THEME_DEFAULTS.themeShell}
                        onChange={(e) => updateContentItem(i, { themeShell: e.target.value })}
                        className="w-7 h-7 rounded border border-zinc-700 bg-zinc-800 cursor-pointer"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      Highlight
                      <input
                        type="color"
                        value={item.themeSecondary ?? THEME_DEFAULTS.themeSecondary}
                        onChange={(e) => updateContentItem(i, { themeSecondary: e.target.value })}
                        className="w-7 h-7 rounded border border-zinc-700 bg-zinc-800 cursor-pointer"
                      />
                    </label>
                    <select
                      value={item.themeMode ?? THEME_DEFAULTS.themeMode}
                      onChange={(e) => updateContentItem(i, { themeMode: e.target.value === "dark" ? "dark" : "light" })}
                      className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white"
                    >
                      <option value="light">Light base</option>
                      <option value="dark">Dark base</option>
                    </select>
                  </>
                )}
                {item.kind === "link" && (
                  <input
                    value={item.url}
                    onChange={(e) => updateContentItem(i, { url: e.target.value })}
                    placeholder="https://..."
                    className="flex-1 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
                  />
                )}
                {item.kind && item.kind !== "theme" && item.kind !== "link" && (
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
                          if (f && item.kind && item.kind !== "theme") handleContentUpload(i, item.kind, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {(item.kind === "topNav" || item.kind === "sideNav" || item.kind === "background") && (
                      <button
                        type="button"
                        onClick={() => setCropModalKind(item.kind as CropKind)}
                        disabled={!item.url}
                        className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Preview
                      </button>
                    )}
                  </>
                )}
                <button onClick={() => removeContentItem(i)} className="text-xs text-red-500 hover:text-red-400 transition-colors">
                  Remove
                </button>
              </div>
            );
          })}
          {contentItems.some((c) => c.kind === "theme") && (
            <p className="text-[11px] text-zinc-600">
              Sidebar text is always white — pick a reasonably dark sidebar color for it to stay readable.
            </p>
          )}
          {contentItems.some((c) => c.kind === "topNav" || c.kind === "sideNav") && (
            <p className="text-[11px] text-zinc-600">
              Top/side nav images render full-bleed as the bar&apos;s background (with a dark overlay for legibility), not as a small logo — pick a wide/tall photo, not an icon.
            </p>
          )}
          {contentItems.some((c) => c.kind === "background") && (
            <p className="text-[11px] text-zinc-600">
              Tournament card background is used on the home page for any tournament this sponsor is attached to (with a dark overlay for legibility) — pick a wide photo, not an icon.
            </p>
          )}
          {contentItems.some((c) => c.kind === "link") && (
            <p className="text-[11px] text-zinc-600">
              Click-through link is where the sponsor&apos;s logo/branding takes people when clicked — separate from the named Links list below.
            </p>
          )}
          <button
            onClick={addContentItem}
            disabled={contentItems.length >= ALL_CONTENT_KINDS.length}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Add content
          </button>
        </div>

        <LinksEditor links={links} onChange={setLinks} />

        <div className="space-y-1.5">
          <span className="text-xs text-zinc-500">Phrase (short tagline)</span>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="Powering the next generation of Rocket League"
            maxLength={120}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs text-zinc-500">Overview (paragraph)</span>
          <textarea
            value={overview}
            onChange={(e) => setOverview(e.target.value)}
            placeholder="A short paragraph about the sponsor — who they are, what they do."
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 resize-y"
          />
        </div>

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

        <div className="space-y-1.5">
          <span className="text-xs text-zinc-500">Promo code description</span>
          <textarea
            value={promoDescription}
            onChange={(e) => setPromoDescription(e.target.value)}
            placeholder="Use {PROMO} for 10% off your next order"
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 resize-y"
          />
          <p className="text-[11px] text-zinc-600">
            Keep the <code className="bg-zinc-800 px-1 rounded">{"{PROMO}"}</code> token somewhere in the
            description — it&apos;s replaced with the actual promo code above wherever this is shown.
          </p>
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

      {cropModalKind && (
        <MediaCropModal
          kind={cropModalKind}
          url={cropUrlFor(cropModalKind)}
          initialCrop={sponsor.content_crop?.[cropModalKind]}
          onClose={() => setCropModalKind(null)}
          onSave={(crop) => handleSaveCrop(cropModalKind, crop)}
        />
      )}
    </div>
  );
}

// Each configurable placement is a "tab" an admin can assign a sponsor to.
// A sponsor only appears as an option for a placement once it actually has
// that content filled in, so picking one always has something to show.
const TAB_PLACEMENTS = [
  { key: "topNavSponsorId", label: "Top nav", noContent: "image", hasContent: (s: Sponsor) => !!s.top_nav_image_url },
  { key: "sideNavSponsorId", label: "Side nav", noContent: "image", hasContent: (s: Sponsor) => !!s.side_nav_image_url },
  { key: "settingsTabSponsorId", label: "Settings theme", noContent: "theme", hasContent: (s: Sponsor) => !!s.theme_name },
] as const;

export function TabManagerSection({ sponsors, tabPlacement }: { sponsors: Sponsor[]; tabPlacement: TabPlacement }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [topNavSponsorId, setTopNavSponsorId] = useState(tabPlacement.topNavSponsorId ?? "");
  const [sideNavSponsorId, setSideNavSponsorId] = useState(tabPlacement.sideNavSponsorId ?? "");
  const [settingsTabSponsorId, setSettingsTabSponsorId] = useState(tabPlacement.settingsTabSponsorId ?? "");

  const selected: Record<(typeof TAB_PLACEMENTS)[number]["key"], string> = {
    topNavSponsorId,
    sideNavSponsorId,
    settingsTabSponsorId,
  };
  const setters: Record<(typeof TAB_PLACEMENTS)[number]["key"], (v: string) => void> = {
    topNavSponsorId: setTopNavSponsorId,
    sideNavSponsorId: setSideNavSponsorId,
    settingsTabSponsorId: setSettingsTabSponsorId,
  };

  const activeSponsors = sponsors.filter((s) => s.status === "active");

  const eligibleByKey: Record<(typeof TAB_PLACEMENTS)[number]["key"], Sponsor[]> = {
    topNavSponsorId: activeSponsors.filter(TAB_PLACEMENTS[0].hasContent),
    sideNavSponsorId: activeSponsors.filter(TAB_PLACEMENTS[1].hasContent),
    settingsTabSponsorId: activeSponsors.filter(TAB_PLACEMENTS[2].hasContent),
  };

  // A previously-picked sponsor can lose eligibility (e.g. its theme/image was
  // cleared) without the stored placement ID being cleared along with it. Treat
  // that as "None" everywhere — display, dirty-check, and save — so the admin
  // can actually see and clear the stale pointer instead of Save staying disabled.
  const effectiveSelected: Record<(typeof TAB_PLACEMENTS)[number]["key"], string> = {
    topNavSponsorId: eligibleByKey.topNavSponsorId.some((s) => s.id === topNavSponsorId) ? topNavSponsorId : "",
    sideNavSponsorId: eligibleByKey.sideNavSponsorId.some((s) => s.id === sideNavSponsorId) ? sideNavSponsorId : "",
    settingsTabSponsorId: eligibleByKey.settingsTabSponsorId.some((s) => s.id === settingsTabSponsorId)
      ? settingsTabSponsorId
      : "",
  };

  const hasChanges =
    effectiveSelected.topNavSponsorId !== (tabPlacement.topNavSponsorId ?? "") ||
    effectiveSelected.sideNavSponsorId !== (tabPlacement.sideNavSponsorId ?? "") ||
    effectiveSelected.settingsTabSponsorId !== (tabPlacement.settingsTabSponsorId ?? "");

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await updateTabPlacement(
        effectiveSelected.topNavSponsorId || null,
        effectiveSelected.sideNavSponsorId || null,
        effectiveSelected.settingsTabSponsorId || null
      );
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-3">
      <p className="text-xs text-zinc-500">
        More tabs will get their own sponsor placement here over time.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-3">
        {TAB_PLACEMENTS.map((placement) => {
          const eligible = eligibleByKey[placement.key];
          return (
            <div key={placement.key} className="flex-1 min-w-[160px] space-y-1">
              <span className="text-xs text-zinc-500">{placement.label} sponsor</span>
              <select
                value={effectiveSelected[placement.key]}
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
                <p className="text-[11px] text-zinc-600">No active sponsor has a {placement.label.toLowerCase()} {placement.noContent} set yet.</p>
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

export function SeasonSponsorPicker({
  sponsors,
  initialSponsorId,
}: {
  sponsors: { id: string; name: string }[];
  initialSponsorId: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sponsorId, setSponsorId] = useState(initialSponsorId ?? "");

  const hasChanges = sponsorId !== (initialSponsorId ?? "");

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await updateSeasonSponsor(sponsorId || null);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-1.5">
      <span className="text-xs text-zinc-500">Season sponsor</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sponsorId}
          onChange={(e) => setSponsorId(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white"
        >
          <option value="">None</option>
          {sponsors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleSave}
          disabled={isPending || !hasChanges}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
        >
          Save
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function SponsorsManager({ sponsors, patreonUrl }: { sponsors: Sponsor[]; patreonUrl: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [logoUrl, setLogoUrl] = useState("");
  const [selectedSponsorId, setSelectedSponsorId] = useState<string | null>(sponsors[0]?.id ?? null);

  const selectedSponsor = sponsors.find((s) => s.id === selectedSponsorId) ?? sponsors[0] ?? null;

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
      <PatreonLinkCard patreonUrl={patreonUrl} />

      {error && <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/50 rounded-lg px-4 py-2">{error}</p>}

      {sponsors.length === 0 ? (
        <p className="text-sm text-zinc-500">No sponsors yet.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {sponsors.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSponsorId(s.id)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedSponsor?.id === s.id
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                }`}
              >
                {s.status === "disabled" && <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />}
                {s.name}
              </button>
            ))}
          </div>

          {selectedSponsor && <SponsorCard key={selectedSponsor.id} sponsor={selectedSponsor} />}
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
