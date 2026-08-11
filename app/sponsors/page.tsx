import { getPublicSponsors, type PublicSponsor } from "@/app/lib/sponsors-public";
import { PromoCopyButton } from "./promo-copy-button";

export const dynamic = "force-dynamic";

function getYouTubeEmbedUrl(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return `https://www.youtube.com/embed/${match[1]}`;
  }
  return null;
}

function SponsorVideo({ url, className }: { url: string; className?: string }) {
  const embedUrl = getYouTubeEmbedUrl(url);
  if (embedUrl) {
    return (
      <iframe
        src={embedUrl}
        title="Sponsor video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className={className}
      />
    );
  }
  return <video src={url} controls className={className} />;
}

function SponsorLinks({ sponsor }: { sponsor: PublicSponsor }) {
  const links = sponsor.links.filter((l) => l.label && l.url);
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {links.map((l, i) => (
        <a
          key={i}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[#e88a24] hover:underline"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}

function BigSponsorCard({ sponsor }: { sponsor: PublicSponsor }) {
  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-4">
        {sponsor.logo_url && (
          <img
            src={sponsor.logo_url}
            alt={sponsor.name}
            className="w-16 h-16 rounded-xl object-cover border border-zinc-800"
          />
        )}
        <h2 className="text-2xl font-bold text-white">{sponsor.name}</h2>
      </div>

      {sponsor.video_url && (
        <SponsorVideo url={sponsor.video_url} className="w-full aspect-video rounded-xl border-0" />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SponsorLinks sponsor={sponsor} />
        {sponsor.promo_code && <PromoCopyButton code={sponsor.promo_code} />}
      </div>
    </div>
  );
}

function SmallSponsorCard({ sponsor }: { sponsor: PublicSponsor }) {
  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-3">
        {sponsor.logo_url && (
          <img
            src={sponsor.logo_url}
            alt={sponsor.name}
            className="w-10 h-10 rounded-lg object-cover border border-zinc-800"
          />
        )}
        <h3 className="text-sm font-semibold text-white">{sponsor.name}</h3>
      </div>
      <SponsorLinks sponsor={sponsor} />
      {sponsor.promo_code && <PromoCopyButton code={sponsor.promo_code} />}
    </div>
  );
}

export default async function SponsorsPage() {
  const sponsors = await getPublicSponsors();
  const bigSponsors = sponsors.filter((s) => s.tier === "big");
  const smallSponsors = sponsors.filter((s) => s.tier === "small");

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-16">
      <div className="max-w-4xl mx-auto space-y-12">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">Our Sponsors</h1>
          <p className="text-zinc-400">The organizations that make CRL West 6mans possible.</p>
        </div>

        {sponsors.length === 0 ? (
          <p className="text-center text-zinc-500">No sponsors yet — check back soon.</p>
        ) : (
          <>
            {bigSponsors.length > 0 && (
              <div className="grid gap-6 sm:grid-cols-2">
                {bigSponsors.map((s) => (
                  <BigSponsorCard key={s.id} sponsor={s} />
                ))}
              </div>
            )}

            {smallSponsors.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-3">
                {smallSponsors.map((s) => (
                  <SmallSponsorCard key={s.id} sponsor={s} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
