"use client";

import type { CSSProperties } from "react";
import { useNameDecoration } from "./name-decoration";
import { avatarBorderFrameStyle, getAvatarBorder } from "@/app/lib/avatar-borders";

const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

// A stored avatar is normally a Discord hash. The demo seeder writes a data URI
// instead, so the layout can be judged before any real patron has opted in.
export function avatarSrc(discordId: string | null, avatar: string | null, size?: number): string {
  if (!avatar || !discordId) return DEFAULT_AVATAR;
  if (avatar.startsWith("data:") || avatar.startsWith("http")) return avatar;
  const url = `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`;
  return size ? `${url}?size=${size}` : url;
}

interface Props {
  discordId: string | null;
  avatar: string | null;
  /** Looks the supporter's border up in the decoration context. Omit for accounts not in it. */
  username?: string | null;
  /** Border id, for chrome rendered outside NameDecorationProvider (the sidebar). */
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
