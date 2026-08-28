import { getTabSponsor } from "@/app/lib/sponsors-public";
import { cropStyle } from "@/app/lib/media-crop";
import type { NavTabKey } from "@/app/lib/nav-tabs";

export async function SponsoredByLine({ tabKey }: { tabKey: NavTabKey }) {
  const sponsor = await getTabSponsor(tabKey);
  if (!sponsor) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 align-middle">
      {sponsor.logoUrl && (
        <span className="relative h-4 w-4 rounded-[28%] overflow-hidden shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sponsor.logoUrl}
            alt=""
            className="absolute inset-0 h-full w-full"
            style={cropStyle(sponsor.logoCrop)}
          />
        </span>
      )}
      Sponsored by <span className="text-zinc-300 font-medium">{sponsor.name}</span>
    </span>
  );
}
