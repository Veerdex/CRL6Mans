import { cookies } from "next/headers";
import Link from "next/link";
import { decrypt } from "@/app/lib/session";
import { getPublicSponsors } from "@/app/lib/sponsors-public";
import { SponsorCard } from "@/app/lib/sponsor-display";

export const dynamic = "force-dynamic";

export default async function SponsorsPage() {
  const session = await decrypt((await cookies()).get("session")?.value);
  const sponsors = await getPublicSponsors();

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-16">
      {session?.userId && (
        <div className="max-w-4xl mx-auto mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
      )}
      <div className="max-w-4xl mx-auto space-y-12">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">Our Sponsors</h1>
          <p className="text-zinc-400">The organizations that make CRL West 6mans possible.</p>
        </div>

        {sponsors.length === 0 ? (
          <p className="text-center text-zinc-500">No sponsors yet — check back soon.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {sponsors.map((s) => (
              <SponsorCard key={s.id} sponsor={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
