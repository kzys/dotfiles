import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pullRequests } from "./pullrequest.ts";
import { wakeMessage } from "./changes.ts";
import { type Snapshot, look, poll } from "./poll.ts";
import { view } from "../github-section.ts";
import { fakeHerdr, gitCheckout, prNode, search, tmp } from "./fixtures.ts";

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
  assert.deepEqual(view(found).items, []);
  // The agent is in the project but not the checkout, so may be busy
  // with something else.
  assert.deepEqual(view(found).rows.map((r) => [r.label, r.project, r.agent, r.pane, r.checks]),
                   [["app#1", "one", true, null, "PENDING"]]);
  assert.equal(found.owners["https://github.com/org/app/pull/1"]?.project, project);
  assert.deepEqual(view(found).lines, [`… ● ${"app#1".padEnd(24)} ${"one".padEnd(20)} PR 1`]);
  assert.deepEqual(calls, []);

  found = await poll(herdr, join(root, "project"), state, [], fetchPrs);
  assert.deepEqual(view(found).items, [{ project, role: null, mark: "pr", text: "app#1 checks failed: test: PR 1" }]);
  assert.ok(view(found).lines[0].startsWith("✗ ● app#1"));
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
  const { rows } = view(await poll(herdr, join(root, "project"), state, [], fetchPrs));
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
  const { rows } = view(await poll(herdr, join(root, "project"), state, [], async () => responses.shift()));
  assert.deepEqual(rows.map((r) => [r.project, r.agent, r.pane]), [["20261001-a", true, "w2:p1"]]);
  await poll(herdr, join(root, "project"), state, [], async () => responses.shift());
  assert.deepEqual(calls.filter((c) => c[0] === "run").map((c) => c[1]), ["w2:p1"]);
});

test("finds what to show and tell from what a check read", () => {
  const prs = pullRequests(search(prNode(1, "me/one", { checks: "FAILURE", failed: ["test"] }), prNode(2, "two")));
  const pane = { pane_id: "w1:p1", workspace_id: "w1", agent: "claude", agent_status: "idle", cwd: "/p/a/app", tokens: {} };
  const snapshot: Snapshot = {
    prs,
    trees: [{ project: "/p/a", dir: "/p/a/app", branch: "me/one", repo: "org/app" }],
    texts: [],
    panes: [pane],
    checkouts: { [prs[0].url]: pane },
    seen: { [prs[0].url]: { state: "OPEN", checks: "PENDING", review: null } },
  };
  const found = look(snapshot);
  assert.deepEqual(view(found).rows.map((r) => [r.label, r.projectDir, r.pane]), [["app#1", "/p/a", "w1:p1"], ["app#2", null, null]]);
  assert.deepEqual(found.tells, [{
    title: "app#1 checks failed: test", body: "PR 1 (a)", sound: "request",
    wake: { pane: "w1:p1", text: wakeMessage(prs[0], "checks failed: test") },
  }]);
  assert.deepEqual(Object.keys(found.seen ?? {}), [prs[0].url, prs[1].url]);
  // Without Herdr's panes, it tells nothing and keeps the state before.
  const later = look({ ...snapshot, panes: null, checkouts: {} });
  assert.deepEqual([later.tells, later.seen], [[], null]);
});

