import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { APP_NAME } from "@/app/lib/constants";
import { VisitTracker } from "./visit-tracker";

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
  const theme = raw === "dark" || raw === "light" || raw === "crl6mans" ? raw : "crl6mans";
  return (
    <html
      lang="en"
      data-theme={theme}
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

        {/* Beta indicator */}
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900/90 border border-zinc-700/60 rounded-full text-xs font-semibold text-zinc-400 backdrop-blur-sm shadow-lg pointer-events-none select-none">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
          Beta
        </div>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
