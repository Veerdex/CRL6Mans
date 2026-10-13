// Reuse a value the caller already has instead of fetching it again.
//
// Both helpers exist so a loop that calls the same read once per iteration can
// hoist it without the call sites growing a branch each. The distinction between
// them is load-bearing:
//
// `orFetch` treats only null/undefined as missing, so a legitimately falsy value
// — 0, "" — is reused rather than refetched.
//
// `orFetchList` additionally treats an empty array as missing, because the guild
// readers it is used with (`fetchRoles`, `getGuildChannels`) return [] on an HTTP
// failure rather than throwing. Threading that [] onward would convert one failed
// read into every later consumer seeing an empty guild, where the unhoisted code
// would have retried on the next iteration. Treating it as missing keeps that
// retry, so hoisting cannot make a failure stickier than it already was.

export async function orFetch<T>(
  provided: T | null | undefined,
  fetch: () => Promise<T>,
): Promise<T> {
  return provided === null || provided === undefined ? fetch() : provided;
}

export async function orFetchList<T>(
  provided: readonly T[] | null | undefined,
  fetch: () => Promise<T[]>,
): Promise<T[]> {
  return provided === null || provided === undefined || provided.length === 0
    ? fetch()
    : (provided as T[]);
}
