import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase";

const raw = process.env.SESSION_SECRET;
if (!raw) throw new Error("SESSION_SECRET environment variable is not set");
if (Buffer.byteLength(raw, "utf8") < 32)
  throw new Error("SESSION_SECRET must be at least 32 bytes for HS256");
const encodedKey = new TextEncoder().encode(raw);

type SessionPayload = {
  userId: string;
  username: string;
  avatar: string | null;
  expiresAt: Date;
  // Monotonically incremented on ban/kick to allow server-side invalidation.
  // Requires: ALTER TABLE accounts ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
  sessionVersion: number;
};

export type { SessionPayload };

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encodedKey);
}

export async function decrypt(session: string | undefined = "") {
  try {
    const { payload } = await jwtVerify(session, encodedKey, {
      algorithms: ["HS256"],
    });
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export async function createSession(
  userId: string,
  username: string,
  avatar: string | null,
  sessionVersion = 0,
) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const session = await encrypt({ userId, username, avatar, expiresAt, sessionVersion });
  const cookieStore = await cookies();
  cookieStore.set("session", session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    sameSite: "lax",
    path: "/",
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete("session");
}

// Bump session_version so any JWT issued before this call is rejected by
// verifySessionCurrent. Call after banning or kicking a player.
export async function invalidatePlayerSessions(discordId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("session_version")
    .eq("discord_id", discordId)
    .single();
  const next = ((data?.session_version as number | null) ?? 0) + 1;
  await supabaseAdmin
    .from("accounts")
    .update({ session_version: next })
    .eq("discord_id", discordId);
}

// Returns false if the token's embedded session_version no longer matches the
// DB (i.e. the player was banned/kicked since the token was issued).
// Returns true when the column doesn't exist yet (graceful degradation).
export async function verifySessionCurrent(payload: SessionPayload): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("session_version")
    .eq("discord_id", payload.userId)
    .single();
  if (!data || data.session_version === null) return true; // column not yet migrated
  return payload.sessionVersion === (data.session_version as number);
}
