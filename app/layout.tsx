import type { CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { APP_NAME } from "@/app/lib/constants";
import { VisitTracker } from "./visit-tracker";
import { getSettingsTabTheme } from "@/app/lib/sponsors-public";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Competitive Rocket League pickup queue",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME,
  },
};

export const viewport: Viewport = {
  themeColor: "#3736ac",
  userScalable: false,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const raw = (await cookies()).get("theme")?.value;
  const validTheme = raw === "dark" || raw === "light" || raw === "crl6mans" || raw === "sponsor" ? raw : "crl6mans";
  const sponsorTheme = await getSettingsTabTheme();
  // A stale "sponsor" selection (the admin unset the settings-tab sponsor since
  // the player picked it) falls back to the default brand theme instead of
  // rendering with no colors set.
  const theme = validTheme === "sponsor" && !sponsorTheme ? "crl6mans" : validTheme;
  const sponsorStyle: CSSProperties = sponsorTheme
    ? ({
        "--sponsor-accent": sponsorTheme.accent,
        "--sponsor-shell": sponsorTheme.shell,
        "--sponsor-secondary": sponsorTheme.secondary,
      } as CSSProperties)
    : {};
  return (
    <html
      lang="en"
      data-theme={theme}
      data-sponsor-mode={theme === "sponsor" ? sponsorTheme?.mode ?? "light" : undefined}
      style={sponsorStyle}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-x-hidden bg-zinc-950">
        <VisitTracker />
        {/* Portrait-only guard — covers the app when a phone is held in landscape */}
        <div className="rotate-overlay fixed inset-0 z-[100] bg-zinc-950 flex-col items-center justify-center text-center px-10 gap-4">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#e88a24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="7" y="2" width="10" height="20" rx="2" ry="2" />
            <path d="M11 18h2" />
            <path d="M2 9a9 9 0 0 1 4-4" />
            <polyline points="6 2 6 5 9 5" />
          </svg>
          <p className="text-lg font-bold text-white">Please rotate your device</p>
          <p className="text-sm text-zinc-400 max-w-xs">
            CRL West 6mans is designed for portrait mode. Turn your phone upright to continue.
          </p>
        </div>

        {/* Diagonal tiled logo watermark — sits behind all content */}
        <div
          aria-hidden="true"
          style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}
        >
          <div
            style={{
              position: "absolute",
              inset: "-100%",
              backgroundImage: "url('/crl-logo-tile.png')",
              backgroundRepeat: "repeat",
              backgroundSize: "160px 160px",
              transform: "rotate(-30deg)",
              opacity: 0.06,
            }}
          />
        </div>
        {children}

        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
