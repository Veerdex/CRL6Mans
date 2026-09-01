import "server-only";

// Patreon API v2 (JSON:API). v1 retires 2026-10-07 so v2 is the only viable
// target. Docs are known-incomplete in places (exact token TTL, refresh-token
// rotation behavior) — see the defensive handling below.
const PATREON_API_BASE = "https://www.patreon.com/api/oauth2/v2";
const PATREON_TOKEN_URL = "https://www.patreon.com/api/oauth2/token";
const PATREON_AUTHORIZE_URL = "https://www.patreon.com/oauth2/authorize";
const USER_AGENT = "CRLWest6Mans-Website/1.0";

// Requesting bare `identity` (not the broader `identity.memberships`) is
// expected to auto-scope `include=memberships` to just our own campaign —
// unconfirmed in Patreon's docs, so this is overridable without a code change
// if a live test shows otherwise (see PATREON_CAMPAIGN_ID below).
export const PATREON_SUPPORTER_SCOPE = process.env.PATREON_SUPPORTER_SCOPE || "identity";
export const PATREON_CAMPAIGN_OWNER_SCOPE = "identity campaigns campaigns.members";

export function patreonAuthorizeUrl(clientId: string, redirectUri: string, state: string, scope: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
  });
  return `${PATREON_AUTHORIZE_URL}?${params}`;
}

export type PatreonTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
};

function tokensFromResponse(json: { access_token: string; refresh_token: string; expires_in: number }): PatreonTokens {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

export async function exchangePatreonCode(code: string, redirectUri: string): Promise<PatreonTokens | null> {
  const { PATREON_CLIENT_ID, PATREON_CLIENT_SECRET } = process.env;
  if (!PATREON_CLIENT_ID || !PATREON_CLIENT_SECRET) return null;
  try {
    const res = await fetch(PATREON_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: PATREON_CLIENT_ID,
        client_secret: PATREON_CLIENT_SECRET,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) return null;
    return tokensFromResponse(await res.json());
  } catch {
    return null;
  }
}

export type PatreonRefreshResult =
  | { ok: true; tokens: PatreonTokens }
  // revoked: true only when Patreon told us the refresh token itself is dead
  // (400/invalid_grant) — the link should be cleared. Any other failure
  // (network error, missing env vars, 429/5xx) is transient and must NOT
  // clear a live link; the caller should just retry on the next run.
  | { ok: false; revoked: boolean };

// Patreon's docs don't confirm whether refresh tokens rotate on use. Always
// persist the returned refresh_token (even if unchanged) so a rotating
// provider doesn't silently break the link on the next refresh.
export async function refreshPatreonToken(refreshToken: string): Promise<PatreonRefreshResult> {
  const { PATREON_CLIENT_ID, PATREON_CLIENT_SECRET } = process.env;
  if (!PATREON_CLIENT_ID || !PATREON_CLIENT_SECRET) return { ok: false, revoked: false };
  let res: Response;
  try {
    res = await fetch(PATREON_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: PATREON_CLIENT_ID,
        client_secret: PATREON_CLIENT_SECRET,
      }),
    });
  } catch {
    return { ok: false, revoked: false };
  }
  if (!res.ok) return { ok: false, revoked: res.status === 400 };
  return { ok: true, tokens: tokensFromResponse(await res.json()) };
}

type JsonApiResource = { id: string; type: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id: string; type: string } | { id: string; type: string }[] | null }> };
type JsonApiDoc = { data?: JsonApiResource | JsonApiResource[]; included?: JsonApiResource[] };

async function patreonGet(path: string, accessToken: string): Promise<JsonApiDoc | null> {
  try {
    const res = await fetch(`${PATREON_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export type PatreonMemberStatus = "active_patron" | "declined_patron" | "former_patron";

export type PatreonSupporterStatus = {
  patreonUserId: string;
  memberId: string | null;
  status: PatreonMemberStatus | null;
  tierTitle: string | null;
  entitledCents: number | null;
  lifetimeCents: number | null;
};

function pickHighestTier(memberRes: JsonApiResource, included: JsonApiResource[]): { title: string | null; amountCents: number | null } | null {
  const tierRel = memberRes.relationships?.currently_entitled_tiers?.data;
  const tierRefs = Array.isArray(tierRel) ? tierRel : tierRel ? [tierRel] : [];
  const tiers = tierRefs
    .map((ref) => included.find((r) => r.type === "tier" && r.id === ref.id))
    .filter((t): t is JsonApiResource => !!t);
  if (tiers.length === 0) return null;
  const best = tiers.reduce((a, b) =>
    ((b.attributes?.amount_cents as number) ?? 0) > ((a.attributes?.amount_cents as number) ?? 0) ? b : a
  );
  return {
    title: (best.attributes?.title as string | undefined) ?? null,
    amountCents: (best.attributes?.amount_cents as number | undefined) ?? null,
  };
}

// Fetches the connected supporter's own identity + (if PATREON_SUPPORTER_SCOPE
// stays bare `identity`) their membership to just our own campaign. If a
// PATREON_CAMPAIGN_ID is configured, filters `included` members to that
// campaign — only needed if the scope-only auto-filtering doesn't hold.
export async function fetchPatreonIdentity(accessToken: string): Promise<PatreonSupporterStatus | null> {
  const fields = new URLSearchParams({
    include: "memberships.currently_entitled_tiers",
    "fields[member]": "patron_status,currently_entitled_amount_cents,campaign_lifetime_support_cents",
    "fields[tier]": "title,amount_cents",
  });
  const doc = await patreonGet(`/identity?${fields}`, accessToken);
  if (!doc?.data || Array.isArray(doc.data)) return null;

  const patreonUserId = doc.data.id;
  const included = doc.included ?? [];
  const campaignId = process.env.PATREON_CAMPAIGN_ID;

  const members = included.filter((r) => r.type === "member");
  const member = campaignId
    ? members.find((m) => {
        const rel = m.relationships?.campaign?.data;
        return !Array.isArray(rel) && rel?.id === campaignId;
      })
    : members[0];

  if (!member) return { patreonUserId, memberId: null, status: null, tierTitle: null, entitledCents: null, lifetimeCents: null };

  return {
    patreonUserId,
    memberId: member.id,
    status: (member.attributes?.patron_status as PatreonMemberStatus | undefined) ?? null,
    tierTitle: pickHighestTier(member, included)?.title ?? null,
    entitledCents: (member.attributes?.currently_entitled_amount_cents as number | undefined) ?? null,
    lifetimeCents: (member.attributes?.campaign_lifetime_support_cents as number | undefined) ?? null,
  };
}

// Resolves the campaign owned by the connected (creator-level) account.
// The OAuth client must have been created from the account that owns the
// CRL6Mans campaign, or this comes back empty regardless of scope.
export async function fetchOwnedCampaignId(accessToken: string): Promise<string | null> {
  const doc = await patreonGet("/campaigns", accessToken);
  const first = Array.isArray(doc?.data) ? doc.data[0] : null;
  return first?.id ?? null;
}

export type PatreonCampaignMember = {
  memberId: string;
  patreonUserId: string | null;
  fullName: string | null;
  status: PatreonMemberStatus | null;
  tierTitle: string | null;
  tierAmountCents: number | null;
  entitledCents: number | null;
  lifetimeCents: number | null;
};

export type PatreonCampaignMembersResult = {
  members: PatreonCampaignMember[];
  // false if any page fetch failed — callers must treat `members` as an
  // incomplete/partial list in that case, not as "there are only this many
  // patrons." A failed first page still returns whatever prior pages
  // succeeded (empty on a first-page failure).
  complete: boolean;
};

export type PatreonCampaignTier = {
  id: string;
  title: string | null;
  amountCents: number | null;
};

// All tiers configured on the campaign, regardless of whether anyone has
// subscribed to them yet — unlike fetchCampaignMembers, which can only see a
// tier once a real patron is entitled to it. This is what lets admins assign
// benefits to a brand-new tier before it has any subscribers.
export async function fetchCampaignTiers(accessToken: string, campaignId: string): Promise<PatreonCampaignTier[] | null> {
  const fields = new URLSearchParams({
    include: "tiers",
    "fields[tier]": "title,amount_cents",
  });
  const doc = await patreonGet(`/campaigns/${campaignId}?${fields}`, accessToken);
  if (!doc) return null;
  return (doc.included ?? [])
    .filter((r) => r.type === "tier")
    .map((t) => ({
      id: t.id,
      title: (t.attributes?.title as string | undefined) ?? null,
      amountCents: (t.attributes?.amount_cents as number | undefined) ?? null,
    }));
}

// Full campaign-wide member list, for the admin-only view — this is the only
// call site that needs creator-level scope, and it never attributes a member
// to a CRL account by name/email; that link only ever comes from the
// per-supporter connect flow (patreon_user_id match).
export async function fetchCampaignMembers(accessToken: string, campaignId: string): Promise<PatreonCampaignMembersResult> {
  const members: PatreonCampaignMember[] = [];
  let path: string | null =
    `/campaigns/${campaignId}/members?` +
    new URLSearchParams({
      include: "currently_entitled_tiers,user",
      "fields[member]": "full_name,patron_status,currently_entitled_amount_cents,campaign_lifetime_support_cents",
      "fields[tier]": "title,amount_cents",
      "fields[user]": "full_name",
      "page[count]": "100",
    });

  while (path) {
    const doc: JsonApiDoc | null = await patreonGet(path, accessToken);
    if (!doc?.data || !Array.isArray(doc.data)) return { members, complete: false };
    const included = doc.included ?? [];
    for (const m of doc.data) {
      const userRel = m.relationships?.user?.data;
      const userId = !Array.isArray(userRel) ? (userRel?.id ?? null) : null;
      const highestTier = pickHighestTier(m, included);
      members.push({
        memberId: m.id,
        patreonUserId: userId,
        fullName: (m.attributes?.full_name as string | undefined) ?? null,
        status: (m.attributes?.patron_status as PatreonMemberStatus | undefined) ?? null,
        tierTitle: highestTier?.title ?? null,
        tierAmountCents: highestTier?.amountCents ?? null,
        entitledCents: (m.attributes?.currently_entitled_amount_cents as number | undefined) ?? null,
        lifetimeCents: (m.attributes?.campaign_lifetime_support_cents as number | undefined) ?? null,
      });
    }
    const next = (doc as unknown as { links?: { next?: string } }).links?.next;
    path = next ? next.replace(PATREON_API_BASE, "") : null;
  }

  return { members, complete: true };
}
