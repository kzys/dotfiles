import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pullRequests } from "./pullrequest.ts";
import { wakeMessage } from "./changes.ts";
import { poll, screen, waitingItems } from "./poll.ts";
import { fakeHerdr, gitCheckout, prNode, search, tmp } from "./fixtures.ts";

test("lists pull requests waiting on me", () => {
  const prs = pullRequests(search(
    prNode(1, "a", { checks: "FAILURE", failed: ["test"] }),
    prNode(2, "b", { checks: "SUCCESS", review: "CHANGES_REQUESTED" }),
    prNode(3, "c", { checks: "SUCCESS", review: "APPROVED" }),
    prNode(4, "d", { checks: "PENDING", review: "APPROVED" }),
    prNode(5, "e", { state: "MERGED", checks: "FAILURE" }),
    prNode(6, "f", { checks: "SUCCESS" }),
  ));
  const owners = { [prs[0].url]: { project: "/p/a", dir: "/p/a/app" } };
  assert.deepEqual(waitingItems(prs, owners).map((i) => [i.project, i.text]), [
    ["/p/a", "app#1 checks failed: test: PR 1"],
    [null, "app#2 changes requested: PR 2"],
    [null, "app#3 approved, ready to merge: PR 3"],
  ]);
});

test("draws the watcher's pane", () => {
  assert.equal(screen("Pull requests", new Date(2026, 9, 16, 15, 4), ["a", "b"]), "Pull requests at 15:04\na\nb");
  assert.equal(screen("Pull requests", new Date(2026, 9, 16, 9, 5), []), "Pull requests at 09:05");
});

test("polls pull requests", async () => {
  // Only GitHub and Herdr are replaced; git, the notes and the state
  // file are real.
  const root = tmp();
  const project = join(root, "project/20261001-a");
  gitCheckout(join(project, "app"), "me/one");
  writeFileSync(join(project, "README.md"), "---\nname: one\n---\n");
  const responses = [search(prNode(1, "me/one", { checks: "PENDING" })),
                     search(prNode(1, "me/one", { checks: "FAILURE", failed: ["test"] }))];
  const fetchPrs = async () => responses.shift();
  const calls: unknown[][] = [];
  const herdr = fakeHerdr(() => [
    { pane_id: "w1:p1", workspace_id: "w1", agent: "claude", agent_status: "idle", cwd: project, tokens: {} },
  ], calls);
  const state = join(root, "state/pull-requests.json");
  let found = await poll(herdr, join(root, "project"), state, [], fetchPrs);
  assert.deepEqual(found.items, []);
  // The agent is in the project but not the checkout, so may be busy
  // with something else.
  assert.deepEqual(found.rows.map((r) => [r.label, r.project, r.agent, r.pane, r.checks]),
                   [["app#1", "one", true, null, "PENDING"]]);
  assert.equal(found.owners["https://github.com/org/app/pull/1"]?.project, project);
  assert.deepEqual(found.lines, [`… ● ${"app#1".padEnd(24)} ${"one".padEnd(20)} PR 1`]);
  assert.deepEqual(calls, []);

  found = await poll(herdr, join(root, "project"), state, [], fetchPrs);
  assert.deepEqual(found.items, [{ project, role: null, mark: "pr", text: "app#1 checks failed: test: PR 1" }]);
  assert.ok(found.lines[0].startsWith("✗ ● app#1"));
  const [pr] = pullRequests(search(prNode(1, "me/one")));
  assert.deepEqual(calls, [
    ["notify", "app#1 checks failed: test", "PR 1 (20261001-a)", "request"],
    ["run", "w1:p1", wakeMessage(pr, "checks failed: test")],
  ]);
  assert.equal(JSON.parse(readFileSync(state, "utf8"))[pr.url].checks, "FAILURE");
  // The page links the open pull requests the state keeps, even those the
  // search no longer finds.
  writeFileSync(state, JSON.stringify({ "https://github.com/org/old/pull/9": { state: "OPEN", checks: null, review: null } }));
  responses.push(search(prNode(1, "me/one", { checks: "FAILURE", failed: ["test"] })));
  assert.deepEqual((await poll(herdr, join(root, "project"), state, [], fetchPrs)).urls,
                   ["https://github.com/org/old/pull/9", pr.url]);
});

test("keeps changes for later while Herdr is down", async () => {
  const root = tmp();
  mkdirSync(join(root, "project"), { recursive: true });
  const responses = [search(prNode(1, "a", { checks: "PENDING" })), search(prNode(1, "a", { checks: "SUCCESS" })),
                     search(prNode(1, "a", { checks: "SUCCESS" }))];
  const calls: unknown[][] = [];
  let up = true;
  const herdr = fakeHerdr(() => {
    if (!up) throw new Error("connect ECONNREFUSED");
    return [];
  }, calls);
  const state = join(root, "state/pull-requests.json");
  const fetchPrs = async () => responses.shift();
  await poll(herdr, join(root, "project"), state, [], fetchPrs);
  up = false;
  const { rows } = await poll(herdr, join(root, "project"), state, [], fetchPrs);
  assert.deepEqual(rows.map((r) => r.checks), ["SUCCESS"]);
  assert.deepEqual(calls, []);
  up = true;
  await poll(herdr, join(root, "project"), state, [], fetchPrs);
  assert.deepEqual(calls, [["notify", "app#1 checks passed", "PR 1", "done"]]);
});

test("wakes the agent in the checkout over one in the project", async () => {
  const root = tmp();
  const project = join(root, "project/20261001-a");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "AGENT-main.md"), "- watch app#1\n");
  gitCheckout(join(root, "repos/org/app"), "me/one");
  const responses = [search(prNode(1, "me/one", { checks: "PENDING" })),
                     search(prNode(1, "me/one", { checks: "FAILURE" }))];
  const calls: unknown[][] = [];
  const herdr = fakeHerdr(() => [
    { pane_id: "w1:p1", workspace_id: "w1", agent: "claude", agent_status: "idle", cwd: project, tokens: {} },
    { pane_id: "w2:p1", workspace_id: "w2", agent: "claude", agent_status: "idle", cwd: join(root, "repos/org/app"),
      tokens: {} },
  ], calls);
  const state = join(root, "state/pull-requests.json");
  const { rows } = await poll(herdr, join(root, "project"), state, [], async () => responses.shift());
  assert.deepEqual(rows.map((r) => [r.project, r.agent, r.pane]), [["20261001-a", true, "w2:p1"]]);
  await poll(herdr, join(root, "project"), state, [], async () => responses.shift());
  assert.deepEqual(calls.filter((c) => c[0] === "run").map((c) => c[1]), ["w2:p1"]);
});
