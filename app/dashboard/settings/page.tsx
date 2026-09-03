import { cookies } from "next/headers";
import Link from "next/link";
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
import { PatreonConnectCard, type PatreonInfo, type PatreonBenefitRow } from "./patreon-connect-card";
import { PATREON_BENEFITS } from "@/app/lib/patreon-benefits";
import { benefitEnabled, benefitsForTier, getBenefitsByTier, type BenefitPrefRow } from "@/app/lib/patreon-entitlements";
import { getSettingsTabTheme } from "@/app/lib/sponsors-public";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ patreon?: string }>;
}) {
  const cookieStore = await cookies();
  const session = await decrypt(cookieStore.get("session")?.value);
  if (!session?.userId) redirect("/login");

  const { patreon: patreonBanner } = await searchParams;

  // status/theme/nav_layout/display_name are account-level (Tier 1) and exist
  // for every login; tracker/MMR/notification prefs only exist once someone has
  // a roster row, so those still come off `players`.
  const [{ data: player }, sponsorTheme, { data: account }] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select("id, tracker_url, peak_3v3, current_3v3, peak_2v2, current_2v2, sub_willing, notification_prefs")
      .eq("discord_id", session.userId)
      .single(),
    getSettingsTabTheme(),
    supabaseAdmin
      .from("accounts")
      .select("status, theme, nav_layout, display_name, patreon_status, patreon_tier_title, patreon_entitled_cents, patreon_public, patreon_benefit_prefs, patreon_name_color, patreon_name_outline, patreon_connected_at, patreon_tier_override")
      .eq("discord_id", session.userId)
      .single(),
  ]);

  // An override-pinned account gets the card too, otherwise the per-benefit
  // switches — the only way any benefit turns on at all — would be unreachable
  // for exactly the accounts a director pins in order to test them.
  const patreonOverride = (account?.patreon_tier_override as string | null) ?? null;
  const patreonLinked = !!account?.patreon_connected_at;
  const patreonInfo: PatreonInfo =
    patreonLinked || patreonOverride
      ? {
          status: account?.patreon_status as "active_patron" | "declined_patron" | "former_patron" | null,
          tierTitle: account?.patreon_tier_title as string | null,
          entitledCents: account?.patreon_entitled_cents as number | null,
          linked: patreonLinked,
          overrideTier: patreonOverride,
        }
      : null;

  // Entitlement is decided here, server-side; the card only renders switches
  // for benefits the tier already grants and never sees the rest.
  let patreonBenefits: PatreonBenefitRow[] = [];
  if (patreonInfo) {
    const entitled = benefitsForTier(
      await getBenefitsByTier(),
      patreonInfo.status,
      patreonInfo.tierTitle,
      patreonOverride,
    );
    patreonBenefits = PATREON_BENEFITS.filter((b) => entitled.has(b.id)).map((b) => ({
      id: b.id,
      title: b.title,
      description: b.description,
      enabled: benefitEnabled(account as BenefitPrefRow, b.id),
    }));
  }

  // Non-approved players (unregistered/pending/rejected) get a reduced settings
  // view — account preferences only. Platform account claims and MMR/tracker
  // edit requests require an approved roster spot.
  const isApproved = account?.status === "approved";

  let pending: PendingRequest | null = null;
  let rejected: RejectedRequest | null = null;
  const platformAccounts: Record<ClaimablePlatform, PlatformAccountRecord | null> = {
    steam: null,
    epic: null,
    playstation: null,
    xbox: null,
    switch: null,
  };

  if (isApproved && player) {
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

    pending = pendingRow
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

    rejected = rejectedRow ? { id: rejectedRow.id, adminNote: rejectedRow.admin_note as string | null } : null;

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
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
      <p className="text-zinc-400 text-sm mb-8">
        {isApproved
          ? "MMR and tracker changes require admin approval. Substitute availability is applied instantly."
          : "Notifications, nickname, platform account claims, and MMR/tracker edits unlock once your registration is approved."}
      </p>
      <Link
        href="/dashboard/help"
        className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 mb-4 hover:border-zinc-700 transition-colors"
      >
        <span className="text-sm font-semibold text-white">Help &amp; FAQ</span>
        <span className="text-zinc-500">↗</span>
      </Link>
      <div className="mb-4">
        <ThemeToggle
          initial={
            account?.theme === "dark" || account?.theme === "light" || (account?.theme === "sponsor" && sponsorTheme)
              ? account.theme
              : "crl6mans"
          }
          sponsorTheme={sponsorTheme}
        />
      </div>
      <div className="mb-4">
        <NavLayoutToggle initial={account?.nav_layout === "topbar" ? "topbar" : "sidebar"} />
      </div>
      <div className="mb-4">
        <PatreonConnectCard
          info={patreonInfo}
          benefits={patreonBenefits}
          banner={patreonBanner}
          nameColor={(account?.patreon_name_color as string | null) ?? null}
          nameOutline={account?.patreon_name_outline === true}
          previewName={(account?.display_name as string | null) || session.username || ""}
        />
      </div>
      <div className="mb-6 space-y-3">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Notifications</p>
        {isApproved ? (
          <>
            <NotificationButton />
            <NotificationPrefsForm
              initialPrefs={(player?.notification_prefs as Record<string, boolean> | null) ?? {}}
            />
          </>
        ) : (
          <p className="text-xs text-zinc-500">Available once your registration is approved.</p>
        )}
      </div>
      <div className="mb-6">
        {isApproved ? (
          <DisplayNameForm
            current={(account?.display_name as string | null) ?? null}
            discordUsername={session.username ?? ""}
          />
        ) : (
          <p className="text-xs text-zinc-500">
            Your display name will be your Discord username ({session.username}) until you&apos;re approved.
          </p>
        )}
      </div>

      {isApproved && player && (
        <>
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
        </>
      )}
    </div>
  );
}
