"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBenefitEnabled, setNameColor, setAvatarBorder, disconnectPatreon } from "./patreon-actions";
import {
  DEFAULT_NAME_COLOR,
  NAME_COLOR_BENEFIT,
  nameColorStyle,
  outlineColorFor,
} from "@/app/lib/name-color";
import { AVATAR_BORDERS, AVATAR_BORDER_BENEFIT, getAvatarBorder } from "@/app/lib/avatar-borders";
import { PlayerAvatar } from "../player-avatar";

export type PatreonInfo = {
  status: "active_patron" | "declined_patron" | "former_patron" | null;
  tierTitle: string | null;
  entitledCents: number | null;
  linked: boolean;
  overrideTier: string | null;
} | null;

// One row per benefit the account's tier grants, resolved server-side so the
// client never decides entitlement.
export type PatreonBenefitRow = {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  active_patron: "Active patron",
  declined_patron: "Payment declined",
  former_patron: "Former patron",
};

function formatCents(cents: number | null) {
  if (cents === null) return null;
  return `$${(cents / 100).toFixed(2)}/mo`;
}

export function PatreonConnectCard({
  info,
  benefits,
  banner,
  nameColor,
  nameOutline,
  previewName,
  avatarBorder,
  previewDiscordId,
  previewAvatar,
}: {
  info: PatreonInfo;
  benefits: PatreonBenefitRow[];
  banner?: string | null;
  nameColor: string | null;
  nameOutline: boolean;
  previewName: string;
  avatarBorder: string | null;
  previewDiscordId: string;
  previewAvatar: string | null;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(benefits.map((b) => [b.id, b.enabled])),
  );
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [color, setColor] = useState(nameColor ?? DEFAULT_NAME_COLOR);
  const [outline, setOutline] = useState(nameOutline);
  const [border, setBorder] = useState(avatarBorder);
  // undefined is closed. null is a real value here - the None option - so the
  // modal is gated on `!== undefined`, never on truthiness.
  const [preview, setPreview] = useState<string | null | undefined>(undefined);
  const [pending, startToggle] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  const offCount = benefits.filter((b) => !enabled[b.id]).length;

  function toggle(id: string) {
    const next = !enabled[id];
    setEnabled((prev) => ({ ...prev, [id]: next }));
    // Several benefits render in server-rendered chrome (the supporter badge in
    // the dashboard layout, the Support Us list), so the switch only takes
    // visible effect after a refresh.
    startToggle(async () => {
      await setBenefitEnabled(id, next);
      router.refresh();
    });
  }

  // A colour input fires continuously while the swatch is dragged, so the
  // write trails the preview by a beat rather than issuing one request per
  // pixel. Both fields are sent together because the action writes them as a
  // pair.
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (commitTimer.current) clearTimeout(commitTimer.current); }, []);

  useEffect(() => {
    if (preview === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  function commitNameColor(nextColor: string, nextOutline: boolean) {
    setColor(nextColor);
    setOutline(nextOutline);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      startToggle(async () => {
        await setNameColor(nextColor, nextOutline);
        router.refresh();
      });
    }, 400);
  }

  // Picking is a discrete click rather than a dragged input, so unlike the
  // colour this writes straight through with no debounce.
  function commitBorder(next: string | null) {
    setBorder(next);
    startToggle(async () => {
      await setAvatarBorder(next);
      router.refresh();
    });
  }

  function handleDisconnect() {
    startDisconnect(async () => {
      await disconnectPatreon();
      router.refresh();
    });
  }

  return (
    <div className="p-4 bg-zinc-800 border border-zinc-700 rounded-lg space-y-3">
      <div>
        <p className="text-sm font-medium text-zinc-300">Patreon</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          {!info
            ? "Link your Patreon account to support the league."
            : info.linked
              ? "Your Patreon support is linked to this account."
              : "A director has pinned this account to a tier for testing."}
        </p>
      </div>

      {banner === "connected" && (
        <p className="text-xs text-emerald-400">
          Patreon connected.
          {benefits.length > 0 &&
            " Your benefits start switched off — turn on the ones you want below."}
        </p>
      )}
      {banner === "cancelled" && <p className="text-xs text-zinc-500">Patreon connection cancelled.</p>}
      {banner === "error" && (
        <p className="text-xs text-red-400">Something went wrong connecting Patreon. Try again.</p>
      )}

      {info ? (
        <div className="space-y-3 text-xs">
          <p className="text-zinc-300">
            {info.linked ? (
              <>
                {STATUS_LABELS[info.status ?? ""] ?? "Linked"}
                {info.tierTitle ? ` — ${info.tierTitle}` : ""}
                {formatCents(info.entitledCents) ? ` (${formatCents(info.entitledCents)})` : ""}
              </>
            ) : (
              `Tier override — ${info.overrideTier}`
            )}
          </p>

          <div className="space-y-2">
            <p className="text-zinc-400 font-medium">Your benefits</p>

            {benefits.length === 0 ? (
              <p className="text-zinc-500">No benefits are assigned to your tier yet.</p>
            ) : (
              <>
                {offCount > 0 && (
                  <p className="text-amber-400">
                    {offCount === benefits.length
                      ? "None of your benefits are turned on yet — they are off by default. Enable the ones you want below."
                      : `${offCount} of your benefits ${offCount === 1 ? "is" : "are"} still turned off.`}
                  </p>
                )}

                {benefits.map((b) => (
                  <div key={b.id} className="px-3 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-zinc-300 truncate">{b.title}</span>
                        <button
                          type="button"
                          onClick={() => setOpenInfo(openInfo === b.id ? null : b.id)}
                          aria-expanded={openInfo === b.id}
                          aria-label={`What is ${b.title}?`}
                          className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full border border-zinc-600 text-zinc-400 text-[11px] font-semibold hover:text-zinc-200 hover:border-zinc-400 transition-colors"
                        >
                          i
                        </button>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={!!enabled[b.id]}
                          onChange={() => toggle(b.id)}
                          disabled={pending}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-zinc-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-pure-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 peer-disabled:opacity-50" />
                      </label>
                    </div>
                    {openInfo === b.id && <p className="text-zinc-500 mt-2">{b.description}</p>}
                    {b.id === NAME_COLOR_BENEFIT && enabled[b.id] && (
                      <div className="mt-3 space-y-2.5">
                        <div className="flex items-center gap-3 flex-wrap">
                          <input
                            type="color"
                            value={color}
                            onChange={(e) => commitNameColor(e.target.value, outline)}
                            aria-label="Name colour"
                            className="w-10 h-8 p-0 bg-transparent border border-zinc-600 rounded cursor-pointer"
                          />
                          <span className="text-base font-semibold" style={nameColorStyle(color, outline)}>
                            {previewName}
                          </span>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-zinc-400">
                          <input
                            type="checkbox"
                            checked={outline}
                            onChange={(e) => commitNameColor(color, e.target.checked)}
                            className="accent-indigo-600"
                          />
                          <span>
                            Add a border{" "}
                            <span className="text-zinc-500">
                              ({outlineColorFor(color) === "#ffffff" ? "white" : "black"} — set by your colour)
                            </span>
                          </span>
                        </label>
                      </div>
                    )}
                    {b.id === AVATAR_BORDER_BENEFIT && enabled[b.id] && (
                      <div className="mt-3">
                        <p className="text-[11px] text-zinc-500">
                          Click a border to see it up close, then apply it from there.
                        </p>
                        <div className="mt-2 flex flex-wrap items-start gap-2">
                          {[null, ...AVATAR_BORDERS].map((opt) => (
                            <button
                              key={opt?.id ?? "none"}
                              type="button"
                              onClick={() => setPreview(opt?.id ?? null)}
                              aria-pressed={border === (opt?.id ?? null)}
                              // Ice and Wave overhang their avatar box by ~27%, roughly twice
                              // the rest, so each swatch reserves a cell the widest frame fits
                              // inside. Padding sized to the overhang instead would have the
                              // big frames spilling onto their own label and the row above.
                              className={`p-2 rounded-lg border transition-colors ${
                                border === (opt?.id ?? null)
                                  ? "border-indigo-500 bg-zinc-800"
                                  : "border-zinc-700 hover:border-zinc-500"
                              }`}
                            >
                              <span className="flex items-center justify-center w-16 h-16">
                                <PlayerAvatar
                                  discordId={previewDiscordId}
                                  avatar={previewAvatar}
                                  border={opt?.id ?? null}
                                  className="w-10 h-10"
                                />
                              </span>
                              <span className="block mt-1 text-[11px] text-zinc-400">{opt?.title ?? "None"}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          {info.linked && (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-zinc-500 hover:text-red-400 underline transition-colors disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          )}
        </div>
      ) : (
        <a
          href="/api/auth/patreon"
          className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Connect Patreon
        </a>
      )}

      {preview !== undefined && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreview(undefined)}
        >
          <div
            className="relative rounded-xl border border-zinc-700 bg-zinc-900 p-4 sm:p-5 shadow-xl flex flex-col items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreview(undefined)}
              aria-label="Close preview"
              className="absolute top-2 left-2 w-7 h-7 flex items-center justify-center rounded-md text-lg leading-none text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              &times;
            </button>
            {/* A 256px cell around a 168px avatar: the widest frame (Ice) lands
                at 250px, so every border fits the cell without being upscaled
                past the 256px art that ships. */}
            <span className="flex items-center justify-center w-64 h-64">
              <PlayerAvatar
                discordId={previewDiscordId}
                avatar={previewAvatar}
                border={preview}
                cdnSize={256}
                className="w-[168px] h-[168px]"
              />
            </span>
            <p className="text-sm font-semibold text-white">
              {getAvatarBorder(preview)?.title ?? "None"}
            </p>
            {border === preview ? (
              <p className="text-xs text-zinc-500">Currently applied</p>
            ) : (
              <button
                type="button"
                // Stays open on apply: `border` updates optimistically, so the
                // button is replaced by the applied line right away. That is both
                // the confirmation and the reason a second write cannot overlap
                // the first.
                onClick={() => commitBorder(preview)}
                disabled={pending}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {preview === null ? "Remove border" : "Use this border"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
