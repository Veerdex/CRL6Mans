import { getPublicSponsors } from "@/app/lib/sponsors-public";
import { SponsorCard } from "@/app/lib/sponsor-display";
import { SponsoredByLine } from "@/app/dashboard/sponsored-by-line";

export default async function SponsorsPage() {
  const sponsors = await getPublicSponsors();

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-12">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <h1 className="text-4xl font-bold text-white tracking-tight">Our Sponsors</h1>
            <SponsoredByLine tabKey="sponsors" />
          </div>
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
