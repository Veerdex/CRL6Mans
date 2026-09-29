import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase";

const raw = process.env.SESSION_SECRET;
if (!raw) throw new Error("SESSION_SECRET environment variable is not set");
if (Buffer.byteLength(raw, "utf8") < 32)
  throw new Error("SESSION_SECRET must be at least 32 bytes for HS256");
const encodedKey = new TextEncoder().encode(raw);

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
// Renew once a token is past its midpoint. Shorter re-signs on nearly every
// visit; longer leaves a window where a daily player still gets signed out.
const RENEW_WHEN_REMAINING_MS = SESSION_DURATION_MS / 2;
// Renewal stops here and the token is left to expire, forcing a real trip
// through the OAuth callback. That callback is the only writer of
// accounts.mfa_enabled — which gates the admin panel — and the only thing that
// refreshes the username and avatar carried in the token, so an unbounded
// sliding window would let a staff member who turned off Discord 2FA keep admin
// access indefinitely. prompt=none makes the forced re-login a silent bounce.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type SessionPayload = {
  userId: string;
  username: string;
  avatar: string | null;
  expiresAt: Date;
  // Monotonically incremented on ban/kick to allow server-side invalidation.
  // Requires: ALTER TABLE accounts ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
  sessionVersion: number;
  // When the player last authenticated with Discord, epoch ms. Carried through
  // renewals unchanged, so SESSION_MAX_AGE_MS survives them.
  authTime: number;
};

// `exp` and `iat` are stamped by jose, in seconds. Renewal reads `exp` rather
// than expiresAt because a decrypted payload has been through JSON, so
// expiresAt comes back a string rather than the Date its type claims. authTime
// is optional here alone: tokens issued before it existed don't carry it.
type VerifiedSession = Omit<SessionPayload, "authTime"> & {
  authTime?: number;
  exp?: number;
  iat?: number;
};

export type { SessionPayload, VerifiedSession };

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(payload.expiresAt.getTime() / 1000))
    .sign(encodedKey);
}

export async function decrypt(session: string | undefined = "") {
  try {
    const { payload } = await jwtVerify(session, encodedKey, {
      algorithms: ["HS256"],
    });
    return payload as VerifiedSession;
  } catch {
    return null;
  }
}

// Shared so a renewal in proxy.ts can't drift from the login cookie and
// silently drop httpOnly or secure.
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function createSession(
  userId: string,
  username: string,
  avatar: string | null,
  sessionVersion = 0,
) {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const session = await encrypt({
    userId, username, avatar, expiresAt, sessionVersion, authTime: Date.now(),
  });
  const cookieStore = await cookies();
  cookieStore.set("session", session, sessionCookieOptions(expiresAt));
}

// Pre-cap tokens have no authTime; their issue time is the closest stand-in.
function authTimeOf(session: VerifiedSession): number | null {
  if (session.authTime) return session.authTime;
  return session.iat ? session.iat * 1000 : null;
}

export function shouldRenewSession(session: VerifiedSession): boolean {
  if (!session.exp) return false;
  if (session.exp * 1000 - Date.now() >= RENEW_WHEN_REMAINING_MS) return false;
  const authTime = authTimeOf(session);
  return authTime !== null && Date.now() - authTime < SESSION_MAX_AGE_MS;
}

export type RenewedSession = { token: string; expiresAt: Date };

// Returns null when the session was revoked since it was issued, which is the
// only thing keeping a sliding expiry from extending a banned player's session
// forever. The check is affordable here because renewal happens once per half
// lifetime, not once per request.
export async function renewSession(session: VerifiedSession): Promise<RenewedSession | null> {
  if (!(await verifySessionCurrent(session))) return null;
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const token = await encrypt({
    userId: session.userId,
    username: session.username,
    avatar: session.avatar,
    expiresAt,
    sessionVersion: session.sessionVersion,
    // Non-null because shouldRenewSession already required it to be within the cap.
    authTime: authTimeOf(session)!,
  });
  return { token, expiresAt };
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
export async function verifySessionCurrent(
  payload: Pick<SessionPayload, "userId" | "sessionVersion">,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("session_version")
    .eq("discord_id", payload.userId)
    .single();
  if (!data || data.session_version === null) return true; // column not yet migrated
  return payload.sessionVersion === (data.session_version as number);
}
