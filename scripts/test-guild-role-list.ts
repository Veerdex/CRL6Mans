import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { mergeCreatedRoles, type GuildRole } from "../app/lib/guild-role-list";

// What ensureRoles + a follow-up getGuildRoles() used to produce: the guild's roles
// as they stand after the creates. mergeCreatedRoles has to equal that exactly, since
// it is what replaced the second fetch.
function refetchWouldReturn(before: GuildRole[], created: Record<string, string>): GuildRole[] {
  const after = [...before];
  for (const [name, id] of Object.entries(created)) {
    if (!after.some((r) => r.id === id)) after.push({ id, name });
  }
  return after;
}

const GUILD: GuildRole[] = [
  { id: "100", name: "@everyone" },
  { id: "101", name: "Moderator" },
  { id: "102", name: "Team 1" },
  { id: "103", name: "Team 2" },
];

describe("mergeCreatedRoles — equals what the dropped refetch returned", () => {
  test("nothing created: the fetched list comes back untouched", () => {
    const merged = mergeCreatedRoles(GUILD, {});
    assert.deepEqual(merged, GUILD);
    assert.deepEqual(merged, refetchWouldReturn(GUILD, {}));
  });

  test("one created role is appended, existing entries unchanged", () => {
    const created = { "Team 3": "104" };
    const merged = mergeCreatedRoles(GUILD, created);
    assert.deepEqual(merged, refetchWouldReturn(GUILD, created));
    assert.deepEqual(merged.slice(0, GUILD.length), GUILD);
    assert.deepEqual(merged[GUILD.length], { id: "104", name: "Team 3" });
  });

  test("several created roles all land", () => {
    const created = { "Team 3": "104", "Team 4": "105", "Team 5": "106" };
    const merged = mergeCreatedRoles(GUILD, created);
    assert.deepEqual(merged, refetchWouldReturn(GUILD, created));
    assert.equal(merged.length, GUILD.length + 3);
  });

  test("a role already in the fetched list is not duplicated", () => {
    // ensureRoles maps existing names to their ids, so this is the shape a caller
    // passing the whole name→id map (not just the creates) produces.
    const created = { "Team 1": "102", "Team 2": "103", "Team 3": "104" };
    const merged = mergeCreatedRoles(GUILD, created);
    assert.deepEqual(merged, refetchWouldReturn(GUILD, created));
    assert.equal(merged.filter((r) => r.id === "102").length, 1);
    assert.equal(merged.length, GUILD.length + 1);
  });

  // Keyed on id rather than name: Discord permits duplicate role names, so a
  // name-keyed check would silently drop a genuinely new role.
  test("two roles sharing a name both survive", () => {
    const withDupeName: GuildRole[] = [...GUILD, { id: "200", name: "Prism" }];
    const created = { Prism: "201" };
    const merged = mergeCreatedRoles(withDupeName, created);
    assert.deepEqual(merged, refetchWouldReturn(withDupeName, created));
    assert.deepEqual(
      merged.filter((r) => r.name === "Prism").map((r) => r.id),
      ["200", "201"],
    );
  });

  test("the input list is not mutated", () => {
    const before = [...GUILD];
    mergeCreatedRoles(GUILD, { "Team 3": "104" });
    assert.deepEqual(GUILD, before);
  });

  test("an empty guild read still yields the creates", () => {
    assert.deepEqual(mergeCreatedRoles([], { "Team 1": "102" }), [{ id: "102", name: "Team 1" }]);
  });
});
