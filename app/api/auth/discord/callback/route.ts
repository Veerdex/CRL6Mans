import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { getBaseUrl } from "@/app/lib/base-url";

// This prevents host-header injection from affecting redirect destinations.
function safeRedirect(request: NextRequest, path: string) {
  const base = getBaseUrl(new URL(request.url).origin);
  return NextResponse.redirect(`${base}${path}`);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const discordError = searchParams.get("error");

  const cookieStore = await cookies();

  const clearState = () => cookieStore.delete("oauth_state");

  if (discordError) {
    clearState();
    return safeRedirect(request, "/login?error=cancelled");
  }

  if (!code) {
    clearState();
    return safeRedirect(request, "/login?error=cancelled");
  }

  const storedState = cookieStore.get("oauth_state")?.value;
  if (!storedState || storedState !== state) {
    clearState();
    return safeRedirect(request, "/login?error=auth_failed");
  }

  clearState();

  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI } = process.env;
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
    return safeRedirect(request, "/login?error=auth_failed");
  }

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      return safeRedirect(request, "/login?error=auth_failed");
    }

    const { access_token } = await tokenRes.json();

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userRes.ok) {
      return safeRedirect(request, "/login?error=auth_failed");
    }

    const user = await userRes.json();

    if (!user.id || !user.username) {
      return safeRedirect(request, "/login?error=auth_failed");
    }

    // Find-or-create the Tier 1 account on every login, regardless of
    // registration status. Keep avatar + Discord 2FA status in sync — Discord's
    // mfa_enabled reflects whether the account CURRENTLY has 2FA — re-read on
    // every login so a staff member who disables 2FA loses the website's admin
    // gate on their next refresh.
    const { data: account } = await supabaseAdmin
      .from("accounts")
      .upsert(
        {
          discord_id: user.id,
          username: user.username,
          avatar: user.avatar ?? null,
          mfa_enabled: !!user.mfa_enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "discord_id" }
      )
      .select("id, theme, nav_layout, session_version")
      .single();

    // Embed the current session_version so it can be validated on revocation.
    const sessionVersion = (account?.session_version as number | null) ?? 0;
    await createSession(user.id, user.username, user.avatar ?? null, sessionVersion);

    // Mirror the account's saved theme + nav layout into cookies for no-flash SSR.
    const saved = account?.theme;
    const theme = saved === "dark" || saved === "light" || saved === "crl6mans" || saved === "sponsor" ? saved : "crl6mans";
    const isProduction = process.env.NODE_ENV === "production";
    cookieStore.set("theme", theme, {
      path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax",
      secure: isProduction,
    });
    const navLayout = account?.nav_layout === "topbar" ? "topbar" : "sidebar";
    cookieStore.set("nav_layout", navLayout, {
      path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax",
      secure: isProduction,
    });

    return safeRedirect(request, "/dashboard");
  } catch (err) {
    console.error("[discord/callback] unexpected error", err);
    return safeRedirect(request, "/login?error=auth_failed");
  }
}
