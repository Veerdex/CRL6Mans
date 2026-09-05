// v2 adds what a player profile needs and v1 could not supply: a discord_id on
// every roster entry (usernames change, so they cannot join a result to an
// account), the placement each team finished in, and the prize pool. Bumped
// rather than added silently so a reader can tell which archives carry them.
export const ARCHIVE_SCHEMA_VERSION = 2 as const;
