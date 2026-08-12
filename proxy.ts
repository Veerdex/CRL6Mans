import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/app/lib/session";

const protectedRoutes = ["/dashboard"];

// Content-Security-Policy. Scripts are locked to same-origin plus a per-request
// nonce (Next.js stamps the nonce onto its own inline bootstrap scripts), so an
// injected <script> can't run. Inline styles are allowed because the app uses
// React style props and a background-image throughout; styles can't execute JS.
// Images allow https/data/blob to cover Supabase logos, Discord avatars, and
// canvas output. Media additionally allows Vercel Blob storage for uploaded
// sponsor video. Connect additionally allows Vercel Blob storage because
// client-side sponsor uploads (@vercel/blob/client) PUT the file directly
// from the browser to that host, bypassing the app server. Everything else
// (fonts, workers) is same-origin.
function buildCsp(nonce: string): string {
  // 'wasm-unsafe-eval' lets @react-pdf/renderer compile its WebAssembly layout
  // engine (for PDF export) without permitting general eval(). 'unsafe-eval' is
  // added only in dev — React's Fast Refresh/DevTools use eval() to reconstruct
  // stack traces, but production React never calls it, so prod stays strict.
  const scriptSrc = process.env.NODE_ENV === "production"
    ? `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' 'unsafe-eval'`;
  return [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https:`,
    `font-src 'self'`,
    `connect-src 'self' https://*.public.blob.vercel-storage.com`,
    `media-src 'self' blob: https://*.public.blob.vercel-storage.com`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `frame-src https://www.youtube.com`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join("; ");
}

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isProtected = protectedRoutes.some((r) => path.startsWith(r));

  const session = await decrypt(req.cookies.get("session")?.value);

  if (isProtected && !session?.userId) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (path === "/login" && session?.userId) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  // Fresh nonce per request. It's passed in via the request headers so the
  // renderer can read it, and set on the response so the browser enforces it.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Run on all pages except static assets and API routes. Skip prefetch
    // requests so a throwaway nonce isn't generated for them.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
