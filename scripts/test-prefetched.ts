import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { orFetch, orFetchList } from "../app/lib/prefetched";

// A fetcher that records how many times it ran, so "reused the provided value"
// can be asserted as "never called" rather than only by its return value.
function spy<T>(value: T) {
  let calls = 0;
  return {
    fn: async () => { calls += 1; return value; },
    get calls() { return calls; },
  };
}

// orFetch backs notifyMatchChannel's knownChannelId: a caller that already selected
// discord_channel_id skips the extra select, and everything else behaves as before.
describe("orFetch — the channel-ID lookup notifyMatchChannel used to always make", () => {
  test("a provided value is returned without fetching", async () => {
    const s = spy("fetched");
    assert.equal(await orFetch("provided", s.fn), "provided");
    assert.equal(s.calls, 0);
  });

  test("undefined fetches exactly once — the caller passed nothing", async () => {
    const s = spy("fetched");
    assert.equal(await orFetch(undefined, s.fn), "fetched");
    assert.equal(s.calls, 1);
  });

  test("null fetches too, so a caller whose own select came back empty still reads", async () => {
    const s = spy("fetched");
    assert.equal(await orFetch(null, s.fn), "fetched");
    assert.equal(s.calls, 1);
  });

  test("a falsy-but-present value is reused, not refetched", async () => {
    const zero = spy(99);
    assert.equal(await orFetch(0, zero.fn), 0);
    assert.equal(zero.calls, 0);

    const empty = spy("fetched");
    assert.equal(await orFetch("", empty.fn), "");
    assert.equal(empty.calls, 0);

    const f = spy(true);
    assert.equal(await orFetch(false, f.fn), false);
    assert.equal(f.calls, 0);
  });
});

// orFetchList backs the guild role list threaded out of openReadyMatchChannels into
// execReportMatchResult's result post.
describe("orFetchList — the guild roles execReportMatchResult used to refetch", () => {
  test("a non-empty provided list is returned without fetching", async () => {
    const s = spy([{ id: "2", name: "Fetched" }]);
    const provided = [{ id: "1", name: "Team 1" }];
    assert.deepEqual(await orFetchList(provided, s.fn), provided);
    assert.equal(s.calls, 0);
  });

  test("null and undefined fetch exactly once", async () => {
    const a = spy([{ id: "1", name: "Team 1" }]);
    assert.deepEqual(await orFetchList(null, a.fn), [{ id: "1", name: "Team 1" }]);
    assert.equal(a.calls, 1);

    const b = spy([{ id: "1", name: "Team 1" }]);
    assert.deepEqual(await orFetchList(undefined, b.fn), [{ id: "1", name: "Team 1" }]);
    assert.equal(b.calls, 1);
  });

  // fetchRoles/getGuildChannels return [] on an HTTP failure rather than throwing.
  // Threading that [] onward would make one failed read stickier than the code this
  // replaced, which simply fetched again.
  test("an empty list is treated as missing and refetched", async () => {
    const s = spy([{ id: "1", name: "Team 1" }]);
    assert.deepEqual(await orFetchList([], s.fn), [{ id: "1", name: "Team 1" }]);
    assert.equal(s.calls, 1);
  });

  test("a provided list is handed back by identity, not copied", async () => {
    const provided = [{ id: "1", name: "Team 1" }];
    assert.equal(await orFetchList(provided, async () => []), provided);
  });
});
