import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BoardStore, boardCards } from "./board-store.ts";
import type { PullCheck } from "./github/poll.ts";
import { pullRequests } from "./github/pullrequest.ts";
import { prNode, search } from "./github/fixtures.ts";

test("keeps the user's moves and requests to Copilot across restarts, until their pull requests go", async () => {
  const dir = mkdtempSync(join(tmpdir(), "board-"));
  const pulls = pullRequests(search(prNode(1, "a", { checks: "SUCCESS" }), prNode(2, "b", { checks: "SUCCESS" })));
  const [one, two] = pulls.map((p) => p.url);
  const check = { pulls, owners: {}, names: {}, urls: [one, two] } as unknown as PullCheck;
  const store = new BoardStore(dir);
  let changes = 0;
  store.subscribe(() => changes++);
  const before = store.state();
  assert.equal(store.move(one, "reviewed"), true);
  assert.equal(store.move(one, "reviewed"), false);
  assert.equal(changes, 1);
  assert.notEqual(store.state().moves, before.moves);
  assert.equal(await store.askCopilot(two, async () => {}), true);
  assert.equal(await store.askCopilot(one, async () => { throw new Error("no\nmore"); }), false);
  assert.deepEqual(boardCards(check, new BoardStore(dir).state()).map((c) => [c.stage, c.moved, c.copilotAsk]),
                   [["reviewed", "reviewed", "no"], ["draft", null, "requested"]]);
  // The second merged, and the first went out of sight.
  store.forget({ ...check, pulls: [pulls[0], { ...pulls[1], state: "MERGED" }], urls: [one] } as PullCheck);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "copilot.json"), "utf8")), { [one]: "no" });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "moves.json"), "utf8")), { [one]: "reviewed" });
  assert.deepEqual(boardCards(null, store.state()), []);
});
