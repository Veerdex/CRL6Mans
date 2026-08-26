import { cropStyle } from "@/app/lib/media-crop";
import type { PublicSponsor } from "@/app/lib/sponsors-public";
import { formatPromoDescription } from "@/app/lib/sponsor-promo";
import { PromoCopyButton } from "@/app/sponsors/promo-copy-button";

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

export function SponsorVideo({ url, className }: { url: string; className?: string }) {
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

export function SponsorLinks({ sponsor }: { sponsor: PublicSponsor }) {
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

function SponsorHeader({ sponsor, clickable }: { sponsor: PublicSponsor; clickable?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      {sponsor.logo_url && (
        <div
          className={`relative w-16 h-16 rounded-xl border border-zinc-800 overflow-hidden shrink-0${
            clickable ? " transition-transform duration-200 ease-out group-hover:scale-105" : ""
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sponsor.logo_url}
            alt={sponsor.name}
            className="absolute inset-0 w-full h-full"
            style={cropStyle(sponsor.content_crop?.logo)}
          />
        </div>
      )}
      <h2
        className={`text-2xl font-bold text-white${
          clickable ? " transition-colors duration-200 group-hover:text-[#e88a24]" : ""
        }`}
      >
        {sponsor.name}
      </h2>
    </div>
  );
}

export function SponsorCard({ sponsor }: { sponsor: PublicSponsor }) {
  const promoText = formatPromoDescription(sponsor.promo_description, sponsor.promo_code);

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 space-y-4">
      {sponsor.click_url ? (
        <a
          href={sponsor.click_url}
          target="_blank"
          rel="noopener noreferrer"
          className="group block w-fit"
        >
          <SponsorHeader sponsor={sponsor} clickable />
        </a>
      ) : (
        <SponsorHeader sponsor={sponsor} />
      )}

      {sponsor.phrase && <p className="text-sm text-zinc-400 italic">{sponsor.phrase}</p>}
      {sponsor.overview && <p className="text-sm text-zinc-300 leading-relaxed">{sponsor.overview}</p>}

      {sponsor.video_url && (
        <SponsorVideo url={sponsor.video_url} className="w-full aspect-video rounded-xl border-0" />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SponsorLinks sponsor={sponsor} />
        {sponsor.promo_code && (
          <div className="flex items-center gap-2 flex-wrap">
            {promoText && <span className="text-sm text-zinc-400">{promoText}</span>}
            <PromoCopyButton code={sponsor.promo_code} />
          </div>
        )}
      </div>
    </div>
  );
}
