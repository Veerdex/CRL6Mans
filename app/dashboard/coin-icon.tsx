// The Westside Wages coin. This was 🪙 (U+1FA99) everywhere, but nothing in the
// font stack carries emoji, so every OS drew the currency with its own colour-emoji
// font — a different coin on Windows, iOS and Android. An image makes it the
// league's coin on every device.
//
// Sized in em rather than pixels because the call sites span text-[10px] to
// text-lg; the icon tracks whatever it sits in. At 1.5em it stands taller than
// the text it accompanies, so it centres on the line rather than sitting on the
// baseline — a baseline-anchored icon this size reads as floating above the
// figures beside it.
export function CoinIcon({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/crl-coin.png"
      alt=""
      aria-hidden
      className={`inline-block shrink-0 h-[1.5em] w-[1.5em] align-middle ${className}`}
    />
  );
}
