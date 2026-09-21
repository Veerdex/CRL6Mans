"use client";

import type { CSSProperties } from "react";
import { useNameDecoration } from "./name-decoration";
import { avatarBorderFrameStyle, getAvatarBorder } from "@/app/lib/avatar-borders";
import { DEFAULT_AVATAR, avatarSrc } from "@/app/lib/avatar-url";

export { avatarSrc };

// A stale avatar hash still builds a well-formed CDN URL, so avatarSrc can't
// catch it — only the 404 can, and the browser paints its broken-image glyph
// rather than falling back. The ref repeats the check instead of trusting
// onError alone: a 404 already in the HTTP cache fires its error event before
// React attaches the handler, and that event is simply lost.
function fallBackToDefault(img: HTMLImageElement | null) {
  if (!img || img.src === DEFAULT_AVATAR) return;
  if (img.complete && img.naturalWidth === 0) img.src = DEFAULT_AVATAR;
}

interface Props {
  discordId: string | null;
  avatar: string | null;
  /** Looks the supporter's border up in the decoration context. Omit for accounts not in it. */
  username?: string | null;
  /**
   * Border id, for callers that must not take the context value. Passing this at
   * all overrides the lookup, so `null` means *no border* rather than *unset* —
   * the settings picker relies on that to preview each swatch and to show the
   * None option, and the sidebar uses it because chrome renders outside the
   * provider. Do not collapse this to `border ?? decoration?.border`.
   */
  border?: string | null;
  /** Sizes the box — the frame scales off it, so `w-7 h-7`, an em size, anything. */
  className?: string;
  style?: CSSProperties;
  /** Discord CDN `?size=` hint. Powers of two only. */
  cdnSize?: number;
  alt?: string;
}

export function PlayerAvatar({
  discordId,
  avatar,
  username,
  border,
  className = "",
  style,
  cdnSize,
  alt = "",
}: Props) {
  const decoration = useNameDecoration(username ?? "");
  const resolved = getAvatarBorder(border !== undefined ? border : decoration?.border);

  return (
    <span className={`relative inline-block shrink-0 align-middle ${className}`} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarSrc(discordId, avatar, cdnSize)}
        alt={alt}
        className="w-full h-full rounded-full object-cover"
        ref={fallBackToDefault}
        onError={(e) => {
          const img = e.currentTarget;
          if (img.src !== DEFAULT_AVATAR) img.src = DEFAULT_AVATAR;
        }}
      />
      {resolved && (
        // Painted over the avatar, not around it: the avatar is sized to the
        // larger axis of the opening, so its edge has to be covered rather than
        // met exactly. That also hides a pixel or two of authoring error.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolved.src} alt="" aria-hidden className="select-none" style={avatarBorderFrameStyle(resolved)} />
      )}
    </span>
  );
}
