"use client";

import { useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import type { Sponsor, SponsorLink, SponsorTier } from "./sponsor-actions";
import {
  createSponsor,
  updateSponsorMaxUses,
  updateSponsorDetails,
  toggleSponsorStatus,
  removeSponsorMember,
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

function TierBadge({ tier }: { tier: SponsorTier }) {
  return tier === "big" ? (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded border text-amber-400 bg-amber-950/40 border-amber-800/60">
      Big
    </span>
  ) : (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded border text-zinc-400 bg-zinc-800 border-zinc-700">
      Small
    </span>
  );
}

function TierToggle({ tier, onChange }: { tier: SponsorTier; onChange: (tier: SponsorTier) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-500">Tier</span>
      {(["small", "big"] as const).map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`text-xs px-2.5 py-1 rounded-lg border capitalize transition-colors ${
            tier === t
              ? "bg-indigo-600 border-indigo-500 text-white"
              : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
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

function SponsorPreview({
  name,
  tier,
  logoUrl,
  promoCode,
  links,
}: {
  name: string;
  tier: SponsorTier;
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
          <TierBadge tier={tier} />
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

  const [tier, setTier] = useState<SponsorTier>(sponsor.tier);
  const [logoUrl, setLogoUrl] = useState(sponsor.logo_url ?? "");
  const [videoUrl, setVideoUrl] = useState(sponsor.video_url ?? "");
  const [links, setLinks] = useState<SponsorLink[]>(sponsor.links);
  const [promoCode, setPromoCode] = useState(sponsor.promo_code ?? "");
  const [uploading, setUploading] = useState<"logo" | "video" | null>(null);

  const inviteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/sponsor/join/${sponsor.invite_token}` : "";

  const hasDetailsChanges =
    tier !== sponsor.tier ||
    logoUrl !== (sponsor.logo_url ?? "") ||
    videoUrl !== (sponsor.video_url ?? "") ||
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
      const res = await updateSponsorDetails(sponsor.id, { tier, logoUrl, videoUrl, links, promoCode });
      if (res.error) setError(res.error);
    });
  }

  async function handleUpload(kind: "logo" | "video", file: File) {
    setError(null);
    setUploading(kind);
    try {
      const blob = await upload(`sponsors/${sponsor.id}-${kind}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/sponsors/upload-handler",
      });
      const nextLogoUrl = kind === "logo" ? blob.url : logoUrl;
      const nextVideoUrl = kind === "video" ? blob.url : videoUrl;
      if (kind === "logo") setLogoUrl(blob.url);
      else setVideoUrl(blob.url);

      const res = await updateSponsorDetails(sponsor.id, {
        tier,
        logoUrl: nextLogoUrl,
        videoUrl: nextVideoUrl,
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
        <TierBadge tier={sponsor.tier} />
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
        <TierToggle tier={tier} onChange={setTier} />

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
                  if (f) handleUpload("logo", f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs text-zinc-500">Video</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://youtube.com/... or https://..."
              className="flex-1 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
            />
            <label className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 cursor-pointer transition-colors">
              {uploading === "video" ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept="video/*"
                className="hidden"
                disabled={uploading !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload("video", f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
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

        <SponsorPreview name={sponsor.name} tier={tier} logoUrl={logoUrl} promoCode={promoCode} links={links} />
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

export function SponsorsManager({ sponsors }: { sponsors: Sponsor[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [tier, setTier] = useState<SponsorTier>("small");
  const [logoUrl, setLogoUrl] = useState("");

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const res = await createSponsor(name, Number(maxUses), tier, logoUrl);
      if (res.error) setError(res.error);
      else {
        setName("");
        setMaxUses("1");
        setTier("small");
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
          <TierToggle tier={tier} onChange={setTier} />
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
