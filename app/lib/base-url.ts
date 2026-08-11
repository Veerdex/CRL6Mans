// Prefer an explicit env var; fall back to Vercel's canonical production URL.
// Shared by anything that needs to build an absolute URL (OAuth redirects,
// sponsor invite links) so the fallback chain lives in exactly one place.
const CONFIGURED_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined);

export function getBaseUrl(originFallback: string): string {
  return CONFIGURED_BASE_URL ?? originFallback;
}
