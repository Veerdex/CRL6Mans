// Deliberately not a "use client" module: the admin page is a Server Component
// and needs the real ACCESS_RANK object to filter sections. Importing a runtime
// value out of a client module gives the server a client-reference proxy whose
// property reads are undefined, which silently filters every section away.

// Minimum staff rank that may see a tab. The page filters SECTIONS by this and
// drops any section left with no visible tabs, so a moderator never sees a
// dropdown whose contents are all above them.
export type AccessLevel = "moderator" | "director" | "ceo";

export const ACCESS_RANK: Record<AccessLevel, number> = { moderator: 1, director: 2, ceo: 3 };

export const ACCESS_LABEL: Record<AccessLevel, string> = {
  moderator: "Moderator +",
  director: "Director +",
  ceo: "CEO",
};
