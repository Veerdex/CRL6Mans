export const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

// A stored avatar is normally a Discord hash. The demo seeder writes a data URI
// instead, so the layout can be judged before any real patron has opted in.
export function avatarSrc(discordId: string | null, avatar: string | null, size?: number): string {
  if (!avatar || !discordId) return DEFAULT_AVATAR;
  if (avatar.startsWith("data:") || avatar.startsWith("http")) return avatar;
  const url = `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`;
  return size ? `${url}?size=${size}` : url;
}
