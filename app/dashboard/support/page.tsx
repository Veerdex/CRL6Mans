import { getPatreonUrl } from "@/app/lib/patreon-public";
import { APP_NAME } from "@/app/lib/constants";
import { supabaseAdmin } from "@/app/lib/supabase";
import { SponsoredByLine } from "@/app/dashboard/sponsored-by-line";

const REASONS = [
  "Tournament prize pools that make competing worth it",
  "Server hosting, bot infrastructure, and site costs",
  "Equipment and tools that keep matches running smoothly",
];

export default async function SupportPage() {
  const [patreonUrl, { data: patrons }] = await Promise.all([
    getPatreonUrl(),
    supabaseAdmin
      .from("accounts")
      .select("display_name, username, patreon_tier_title, patreon_entitled_cents")
      .eq("patreon_status", "active_patron")
      .eq("patreon_public", true)
      .order("patreon_entitled_cents", { ascending: false }),
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto space-y-10 text-center">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <h1 className="text-4xl font-bold text-white tracking-tight">Support {APP_NAME}</h1>
            <SponsoredByLine tabKey="patreon" />
          </div>
          <p className="text-zinc-400">
            {`${APP_NAME} is run by the community, for the community. If you'd like to help keep it going, you can become a Patron — every tier helps.`}
          </p>
        </div>

        <ul className="text-left space-y-3 mx-auto max-w-md">
          {REASONS.map((reason) => (
            <li key={reason} className="flex items-start gap-3 text-zinc-300">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-indigo-400">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>{reason}</span>
            </li>
          ))}
        </ul>

        {patreonUrl ? (
          <a
            href={patreonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Become a Patron
          </a>
        ) : (
          <p className="text-sm text-zinc-500">Patron sign-ups are coming soon — check back shortly.</p>
        )}

        {patrons && patrons.length > 0 && (
          <div className="space-y-3 pt-4">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Our Patrons</p>
            <div className="flex flex-wrap justify-center gap-2">
              {patrons.map((p, i) => (
                <span
                  key={i}
                  className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-300"
                >
                  {(p.display_name as string | null) || (p.username as string | null)}
                  {p.patreon_tier_title ? (
                    <span className="text-zinc-500"> — {p.patreon_tier_title as string}</span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
