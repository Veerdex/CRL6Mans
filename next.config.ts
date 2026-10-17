import type { NextConfig } from "next";

// Static security headers applied to every response. The Content-Security-Policy
// is NOT here — it carries a per-request nonce and is set in proxy.ts instead.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // Only enforced over HTTPS; browsers ignore it on http://localhost.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["web-push"],
  turbopack: {
    root: __dirname,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The game under public/send-it/ is a standalone document that /dashboard/game
      // frames. X-Frame-Options has no same-origin middle ground applied globally —
      // DENY refuses our own page too — so the framed document, and only it, is
      // relaxed to SAMEORIGIN. A later rule wins on a repeated key, so this overrides
      // the entry above rather than sitting beside it. Everything else stays DENY.
      {
        source: "/send-it/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;
