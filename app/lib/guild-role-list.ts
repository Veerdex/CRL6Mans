// `ensureRoles` fetches the guild's roles to find which of the names it was given
// are missing, then creates those. Callers that went on to need the role list
// fetched it a second time to pick up what was just created — two identical
// `GET /guilds/{id}/roles` back to back, for a guild holding 200+ roles.
//
// mergeCreatedRoles folds the creates into the list already in hand so the refetch
// can be dropped. It must produce exactly what that refetch would have returned:
// every role the guild already had, plus one entry per newly created role, with no
// duplicate for a name that was already present.

export type GuildRole = { id: string; name: string };

export function mergeCreatedRoles(
  fetched: readonly GuildRole[],
  created: Readonly<Record<string, string>>,
): GuildRole[] {
  const seen = new Set(fetched.map((r) => r.id));
  const merged = [...fetched];
  // Keyed on id, not name: Discord permits two roles with the same name, so a
  // name-keyed check would drop a genuinely new role whose name already existed.
  for (const [name, id] of Object.entries(created)) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({ id, name });
  }
  return merged;
}
