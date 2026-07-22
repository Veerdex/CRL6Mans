import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { supabaseAdmin } from "@/app/lib/supabase";
import { SettingsForm, type PendingRequest, type RejectedRequest } from "./settings-form";
import { ThemeToggle } from "./theme-toggle";
import { NavLayoutToggle } from "./nav-layout-toggle";
import { NotificationButton } from "@/app/dashboard/notification-button";
import { NotificationPrefsForm } from "./notification-prefs-form";
import { DisplayNameForm } from "./display-name-form";
import { PlatformAccountsSection, type ClaimablePlatform, type PlatformAccountRecord } from "./platform-accounts-form";

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { data: player } = await supabaseAdmin
    .from("players")
    .select("id, status, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2, sub_willing, theme, nav_layout, display_name, notification_prefs")
    .eq("discord_id", session.userId)
    .single();

  if (player?.status !== "approved") redirect("/dashboard");

  const [{ data: pendingRow }, { data: rejectedRow }, { data: platformAccountRows }] = await Promise.all([
    supabaseAdmin
      .from("player_edit_requests")
      .select("id, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2, created_at")
      .eq("player_id", player.id)
      .eq("status", "pending")
      .maybeSingle(),
    supabaseAdmin
      .from("player_edit_requests")
      .select("id, admin_note")
      .eq("player_id", player.id)
      .eq("status", "rejected")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("player_platform_accounts")
      .select("id, platform, platform_account_id, claimed_display_name, claimed_tracker_url, verification_status, admin_note")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false }),
  ]);

  const pending: PendingRequest | null = pendingRow
    ? {
        id:          pendingRow.id,
        tracker_url: pendingRow.tracker_url,
        peak_3v3:    pendingRow.peak_3v3,
        current_3v3: pendingRow.current_3v3,
        peak_2v2:    pendingRow.peak_2v2,
        current_2v2: pendingRow.current_2v2,
        created_at:  pendingRow.created_at,
      }
    : null;

  const rejected = rejectedRow ? { id: rejectedRow.id, adminNote: rejectedRow.admin_note as string | null } : null;

  const platformAccounts: Record<ClaimablePlatform, PlatformAccountRecord | null> = {
    steam: null,
    epic: null,
    playstation: null,
    xbox: null,
    switch: null,
  };
  for (const row of platformAccountRows ?? []) {
    const platform = row.platform as ClaimablePlatform;
    if (!(platform in platformAccounts) || platformAccounts[platform]) continue;
    platformAccounts[platform] = {
      id: row.id,
      platform_account_id: row.platform_account_id,
      claimed_display_name: row.claimed_display_name,
      claimed_tracker_url: row.claimed_tracker_url,
      verification_status: row.verification_status,
      admin_note: row.admin_note,
    };
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-xl">
      <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
      <p className="text-zinc-400 text-sm mb-8">
        MMR and tracker changes require admin approval. Substitute availability is applied instantly.
      </p>
      <div className="mb-4">
        <ThemeToggle initial={player.theme === "dark" || player.theme === "light" ? player.theme : "crl6mans"} />
      </div>
      <div className="mb-4">
        <NavLayoutToggle initial={player.nav_layout === "topbar" ? "topbar" : "sidebar"} />
      </div>
      <div className="mb-6 space-y-3">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Notifications</p>
        <NotificationButton />
        <NotificationPrefsForm
          initialPrefs={(player.notification_prefs as Record<string, boolean> | null) ?? {}}
        />
      </div>
      <div className="mb-6">
        <DisplayNameForm
          current={(player.display_name as string | null) ?? null}
          discordUsername={session.username ?? ""}
        />
      </div>

      <PlatformAccountsSection accounts={platformAccounts} />

      <SettingsForm
        current={{
          tracker_url: player.tracker_url  ?? "",
          peak_3v3:    player.peak_3v3     ?? "",
          current_3v3: player.current_3v3  ?? "",
          peak_2v2:    player.peak_2v2     ?? "",
          current_2v2: player.current_2v2  ?? "",
          sub_willing: player.sub_willing  ?? false,
        }}
        pending={pending}
        rejected={rejected}
      />
    </div>
  );
}
