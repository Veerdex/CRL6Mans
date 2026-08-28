import { supabaseAdmin } from "@/app/lib/supabase";
import { fetchCampaignMembers, type PatreonCampaignMember } from "@/app/lib/patreon";
import { getFreshCampaignAccessToken } from "@/app/lib/patreon-sync";
import { AdminSubSection } from "./admin-sub-section";
import { PatreonSyncButton } from "./patreon-sync-button";

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_LABELS: Record<string, string> = {
  active_patron: "Active",
  declined_patron: "Declined",
  former_patron: "Former",
};

type Row = {
  key: string;
  name: string;
  status: string | null;
  tierTitle: string | null;
  entitledCents: number | null;
  lifetimeCents: number | null;
  linked: boolean;
};

type TierStats = {
  tierTitle: string;
  activeCount: number;
  mrrCents: number;
  lifetimeCents: number;
};

const NO_TIER_LABEL = "No Tier";

// Tiers are whatever titles the campaign has actually configured on Patreon —
// grouping by `tierTitle` (rather than a hardcoded list) means a new tier
// shows up here automatically the next time a patron on it syncs.
function computeTierStats(rows: Row[]): TierStats[] {
  const byTier = new Map<string, TierStats>();
  for (const r of rows) {
    const key = r.tierTitle ?? NO_TIER_LABEL;
    let stats = byTier.get(key);
    if (!stats) {
      stats = { tierTitle: key, activeCount: 0, mrrCents: 0, lifetimeCents: 0 };
      byTier.set(key, stats);
    }
    if (r.status === "active_patron") {
      stats.activeCount += 1;
      stats.mrrCents += r.entitledCents ?? 0;
    }
    stats.lifetimeCents += r.lifetimeCents ?? 0;
  }
  return Array.from(byTier.values()).sort((a, b) => b.mrrCents - a.mrrCents);
}

export async function PatreonAdminSection({ userIsDirector }: { userIsDirector: boolean }) {
  const { data: settings } = await supabaseAdmin
    .from("league_settings")
    .select("patreon_campaign_id, patreon_campaign_refresh_token")
    .single();

  const linkedAccountsPromise = supabaseAdmin
    .from("accounts")
    .select("discord_id, username, display_name, patreon_user_id, patreon_status, patreon_tier_title, patreon_entitled_cents, patreon_lifetime_cents")
    .not("patreon_user_id", "is", null);

  let rows: Row[] = [];
  // campaignConnected: the campaign-owner OAuth link itself is set up and its
  // token is valid — independent of whether the member fetch succeeded.
  let campaignConnected = false;
  // partial: true unless `rows` is the full campaign member list. Drives the
  // warning banner and description — never key those off campaignConnected
  // alone, since a connected campaign can still have a failed/incomplete fetch.
  let partial = true;

  if (settings?.patreon_campaign_id && settings?.patreon_campaign_refresh_token) {
    const [fresh, { data: linkedAccounts }] = await Promise.all([
      getFreshCampaignAccessToken(),
      linkedAccountsPromise,
    ]);

    if (fresh) {
      campaignConnected = true;
      const byPatreonUserId = new Map(
        (linkedAccounts ?? []).map((a) => [a.patreon_user_id as string, a])
      );

      const { members, complete }: { members: PatreonCampaignMember[]; complete: boolean } =
        await fetchCampaignMembers(fresh.accessToken, fresh.campaignId);

      rows = members.map((m) => {
        const linked = m.patreonUserId ? byPatreonUserId.get(m.patreonUserId) : undefined;
        return {
          key: m.memberId,
          name: (linked?.display_name as string | null) ?? (linked?.username as string | null) ?? m.fullName ?? "Unknown",
          status: m.status,
          tierTitle: m.tierTitle,
          entitledCents: m.entitledCents,
          lifetimeCents: m.lifetimeCents,
          linked: !!linked,
        };
      });
      partial = !complete;
    }
  }

  if (partial && rows.length === 0) {
    // No campaign-owner connection, or the campaign fetch returned nothing
    // usable — fall back to the per-supporter-linked accounts only. This is
    // a subset of real patrons: anyone who supports on Patreon but never
    // connects their CRL account is invisible here. (If the campaign fetch
    // got a partial page before failing, keep those rows instead — they're
    // a superset of the self-linked fallback.)
    const { data: linkedAccounts } = await linkedAccountsPromise;
    rows = (linkedAccounts ?? [])
      .filter((a) => a.patreon_status)
      .map((a) => ({
        key: a.discord_id as string,
        name: (a.display_name as string | null) ?? (a.username as string | null) ?? "Unknown",
        status: a.patreon_status as string | null,
        tierTitle: a.patreon_tier_title as string | null,
        entitledCents: a.patreon_entitled_cents as number | null,
        lifetimeCents: a.patreon_lifetime_cents as number | null,
        linked: true,
      }));
  }

  const activePatrons = rows.filter((r) => r.status === "active_patron");
  const mrrCents = activePatrons.reduce((sum, r) => sum + (r.entitledCents ?? 0), 0);
  const lifetimeCents = rows.reduce((sum, r) => sum + (r.lifetimeCents ?? 0), 0);
  const tierStats = computeTierStats(rows);

  return (
    <AdminSubSection
      sectionId="data"
      tabId="patrons"
      title="Patrons"
      value={activePatrons.length}
      description={
        !partial
          ? "Every campaign patron, cross-referenced against linked CRL accounts where available."
          : campaignConnected
          ? "The last sync from the Patreon campaign didn't finish — showing what was fetched before it failed."
          : "Only players who've connected their own Patreon account from Settings — connect the campaign for the full list."
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="grid grid-cols-3 gap-4 flex-1 min-w-[280px]">
            <StatCard label="Active Patrons" value={activePatrons.length} />
            <StatCard label="MRR" value={formatCents(mrrCents)} />
            <StatCard label="Lifetime" value={formatCents(lifetimeCents)} />
          </div>
          <div className="flex items-center gap-2">
            {userIsDirector && campaignConnected && <PatreonSyncButton />}
            {userIsDirector && !campaignConnected && (
              <a
                href="/api/auth/patreon-admin"
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Connect Campaign
              </a>
            )}
          </div>
        </div>

        {partial && (
          <p className="text-xs text-amber-400 bg-amber-950/40 border border-amber-700/50 rounded-lg px-3 py-2">
            {campaignConnected
              ? "Partial data — the last sync from the Patreon campaign didn't finish. Try Sync now, or check back later."
              : `Partial data — the campaign-owner connection isn't set up${userIsDirector ? "" : " (a director needs to connect it)"}, so only self-linked players are shown below.`}
          </p>
        )}

        {tierStats.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 whitespace-nowrap">Tier</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-400 whitespace-nowrap">Active Patrons</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-400 whitespace-nowrap">MRR</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-400 whitespace-nowrap">Lifetime</th>
                </tr>
              </thead>
              <tbody>
                {tierStats.map((t) => (
                  <tr key={t.tierTitle} className="border-b border-zinc-800/40 last:border-b-0 bg-zinc-900/50">
                    <td className="px-4 py-2.5 font-medium text-white whitespace-nowrap">{t.tierTitle}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 tabular-nums">{t.activeCount}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono tabular-nums">{formatCents(t.mrrCents)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono tabular-nums">{formatCents(t.lifetimeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">No patrons yet.</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm">
                <span className="flex-1 text-white font-medium truncate">{r.name}</span>
                {!r.linked && <span className="text-xs text-zinc-600">unlinked</span>}
                {r.tierTitle && <span className="text-xs text-zinc-400">{r.tierTitle}</span>}
                {r.status && (
                  <span className={`text-xs ${r.status === "active_patron" ? "text-emerald-400" : "text-zinc-500"}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                )}
                {r.entitledCents != null && (
                  <span className="text-xs text-zinc-400 font-mono w-16 text-right">{formatCents(r.entitledCents)}/mo</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminSubSection>
  );
}
