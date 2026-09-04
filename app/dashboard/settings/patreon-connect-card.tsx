"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBenefitEnabled, setNameColor, setNameGlint, setAvatarBorder, disconnectPatreon } from "./patreon-actions";
import {
  DEFAULT_NAME_COLOR,
  NAME_COLOR_BENEFIT,
  nameColorStyle,
  outlineColorFor,
} from "@/app/lib/name-color";
import {
  DEFAULT_GLINT_COLORS,
  GLINT_CLASS,
  GLINT_MAX_COLORS,
  GLINT_MIN_COLORS,
  NAME_GLINT_BENEFIT,
  nameGlintStyle,
} from "@/app/lib/name-glint";
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
  alwaysOn: boolean;
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
  nameGlint,
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
  nameGlint: string[] | null;
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
  const [glint, setGlint] = useState<string[]>(nameGlint ?? DEFAULT_GLINT_COLORS);
  const [border, setBorder] = useState(avatarBorder);
  // undefined is closed. null is a real value here - the None option - so the
  // modal is gated on `!== undefined`, never on truthiness.
  const [preview, setPreview] = useState<string | null | undefined>(undefined);
  const [pending, startToggle] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  // Always-on rows have no switch, so they are not part of "still turned off".
  // Colored Name keeps its own switch and picker, but the glint wins on every
  // surface while it is on, so the colour section says so rather than letting
  // the patron drag a swatch that changes nothing.
  const glintWins = !!enabled[NAME_GLINT_BENEFIT];
  const switchable = benefits.filter((b) => !b.alwaysOn);
  const offCount = switchable.filter((b) => !enabled[b.id]).length;

  function toggle(id: string) {
    const next = !enabled[id];
    setEnabled((prev) => ({ ...prev, [id]: next }));
    // Several benefits render in server-rendered chrome (the supporter badge in
    // the dashboard layout, the Support Us list), so the switch only takes
    // visible effect after a refresh.
    startToggle(async () => {
      await setBenefitEnabled(id, next);
      // The glint only supersedes Colored Name once real colours are stored, so
      // turning it on with nothing picked would leave the switch saying one
      // thing and every page rendering another. The picker is already showing
      // these, so persist them.
      if (id === NAME_GLINT_BENEFIT && next) await setNameGlint(glint);
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
  const glintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (glintTimer.current) clearTimeout(glintTimer.current); }, []);

  // Its own timer rather than sharing commitNameColor's: the two sections are
  // independent, and a swatch dragged in one must not cancel a write pending
  // in the other.
  function commitGlint(next: string[]) {
    setGlint(next);
    if (glintTimer.current) clearTimeout(glintTimer.current);
    glintTimer.current = setTimeout(() => {
      startToggle(async () => {
        await setNameGlint(next);
        router.refresh();
      });
    }, 400);
  }

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
                    {offCount === switchable.length
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
                      {b.alwaysOn ? (
                        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
                          Always on
                        </span>
                      ) : (
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
                      )}
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
                        {glintWins && (
                          <p className="text-[11px] text-amber-400">
                            Custom Name Glint is on, so it shows instead of this colour.
                          </p>
                        )}
                      </div>
                    )}
                    {b.id === NAME_GLINT_BENEFIT && enabled[b.id] && (
                      <div className="mt-3 space-y-2.5">
                        <div className="flex items-center gap-3 flex-wrap">
                          {glint.map((c, i) => (
                            <span key={i} className="relative inline-flex">
                              <input
                                type="color"
                                value={c}
                                onChange={(e) =>
                                  commitGlint(glint.map((g, j) => (j === i ? e.target.value : g)))
                                }
                                aria-label={`Glint colour ${i + 1}`}
                                className="w-10 h-8 p-0 bg-transparent border border-zinc-600 rounded cursor-pointer"
                              />
                              {glint.length > GLINT_MIN_COLORS && (
                                <button
                                  type="button"
                                  onClick={() => commitGlint(glint.filter((_, j) => j !== i))}
                                  aria-label={`Remove colour ${i + 1}`}
                                  className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-zinc-700 text-zinc-300 text-[10px] leading-none hover:bg-zinc-600 transition-colors"
                                >
                                  &times;
                                </button>
                              )}
                            </span>
                          ))}
                          {glint.length < GLINT_MAX_COLORS && (
                            <button
                              type="button"
                              onClick={() => commitGlint([...glint, "#ffffff"])}
                              aria-label="Add a colour"
                              className="w-10 h-8 rounded border border-dashed border-zinc-600 text-zinc-400 hover:text-white hover:border-zinc-400 transition-colors"
                            >
                              +
                            </button>
                          )}
                        </div>
                        <span
                          className={`inline-block text-base font-semibold ${GLINT_CLASS}`}
                          style={nameGlintStyle(glint)}
                        >
                          {previewName}
                        </span>
                        <p className="text-[11px] text-zinc-500">
                          {GLINT_MIN_COLORS} to {GLINT_MAX_COLORS} colours, swept in the order shown.
                        </p>
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
