import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type PollHerdr, agentPane, checkoutPanes, events, fetch, owner, poll, pullRequests, remember,
  repoName, runs, screen, searchQuery, waitingItems, wakeMessage, worktrees,
} from "./github.ts";
import { notesTexts } from "./owners.ts";
import type { HerdrPane } from "./panes.ts";

function prNode(number: number, branch: string, {
  state = "OPEN", checks = null as string | null, failed = [] as string[], review = null as string | null,
  repo = "org/app", head = null as string | null,
} = {}) {
  const contexts: object[] = failed.map((name) => ({ __typename: "CheckRun", name, conclusion: "FAILURE" }));
  contexts.push({ __typename: "StatusContext", context: "ok", state: "SUCCESS" });
  const rollup = checks ? { state: checks, contexts: { nodes: contexts } } : null;
  return {
    number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, state,
    isDraft: false, headRefName: branch, reviewDecision: review,
    repository: { nameWithOwner: repo }, headRepository: { nameWithOwner: head ?? repo },
    commits: { nodes: [{ commit: { statusCheckRollup: rollup } }] },
  };
}

function search(...nodes: object[]): any {
  return { data: { search: { nodes } } };
}

function gitCheckout(path: string, branch: string, remote = "git@github.com:org/app.git") {
  mkdirSync(path, { recursive: true });
  execFileSync("git", ["-C", path, "init", "-q", "-b", branch]);
  execFileSync("git", ["-C", path, "remote", "add", "origin", remote]);
}

const tmp = () => mkdtempSync(join(tmpdir(), "herdr-project-web-"));

test("reads pull requests", () => {
  const prs = pullRequests(search(prNode(1, "a", { checks: "FAILURE", failed: ["test", "lint"] }), prNode(2, "b"), {}));
  assert.deepEqual(prs.map((p) => [p.number, p.checks, p.failed]), [[1, "FAILURE", ["lint", "test"]], [2, null, []]]);
  assert.equal(prs[0].repo, "org/app");
  assert.equal(prs[0].branch, "a");
  assert.deepEqual(prs[0].runs.map((r) => [r.name, r.state]), [["lint", "failed"], ["ok", "passed"], ["test", "failed"]]);
});

test("reads how each check went", () => {
  assert.deepEqual(runs([
    { __typename: "CheckRun", name: "build", conclusion: null, detailsUrl: "https://ci/1" },
    { __typename: "CheckRun", name: "docs", conclusion: "SKIPPED" },
    { __typename: "StatusContext", context: "deploy", state: "PENDING", targetUrl: "https://ci/2" },
    { __typename: "CheckRun", name: "e2e", conclusion: "TIMED_OUT" },
    { __typename: "CheckRun", name: "old", conclusion: "CANCELLED" },
  ]), [
    { name: "build", state: "running", url: "https://ci/1" },
    { name: "deploy", state: "running", url: "https://ci/2" },
    { name: "docs", state: "skipped", url: null },
    { name: "e2e", state: "failed", url: null },
    { name: "old", state: "cancelled", url: null },
  ]);
});

test("reads repo names", () => {
  assert.equal(repoName("git@github.com:org/app.git"), "org/app");
  assert.equal(repoName("https://github.com/org/app"), "org/app");
  assert.equal(repoName("https://github.com/org/app.git\n"), "org/app");
  assert.equal(repoName("ssh://git@github.com/org/app.git"), "org/app");
  assert.equal(repoName("git@gitlab.com:org/app.git"), null);
});

test("finds agents in checkouts of pull requests", async () => {
  const root = tmp();
  gitCheckout(join(root, "repos/org/app"), "me/one");
  mkdirSync(join(root, "repos/org/app/sub"));
  gitCheckout(join(root, "repos/org/other"), "me/one", "git@github.com:org/other.git");
  gitCheckout(join(root, "repos/me/app"), "main", "git@github.com:me/app.git");
  const prs = pullRequests(search(
    prNode(1, "me/one"), prNode(2, "me/two"),
    // From a fork's main, which the upstream's main isn't.
    prNode(3, "main", { head: "me/app" }),
  ));
  const pane = (pane_id: string, agent: string | null, cwd: string): HerdrPane =>
    ({ pane_id, workspace_id: "w1", agent, cwd: join(root, cwd) });
  const panes = [
    pane("w1:p1", null, "repos/org/app"), pane("w1:p2", "claude", "repos/org/other"),
    pane("w1:p3", "claude", "repos/org/app/sub"), pane("w1:p4", "codex", "repos/org/app"),
    pane("w1:p5", "claude", "gone"), pane("w1:p6", "claude", "repos/me/app"),
  ];
  const found = await checkoutPanes(panes, prs);
  assert.deepEqual(Object.fromEntries(Object.entries(found).map(([url, p]) => [url, p.pane_id])), {
    "https://github.com/org/app/pull/1": "w1:p3",
    "https://github.com/org/app/pull/3": "w1:p6",
  });
});

test("finds projects of pull requests", async () => {
  const root = tmp();
  gitCheckout(join(root, "20261001-a/app"), "me/one");
  gitCheckout(join(root, "20261001-a/other"), "me/two", "git@github.com:org/other.git");
  mkdirSync(join(root, "20261002-b"));
  writeFileSync(join(root, "20261002-b/AGENT-prs.md"), "- app#3 and app#40 wait for review\n");
  writeFileSync(join(root, "20261002-b/README.md"), "app#3\n");
  mkdirSync(join(root, "20261003-c"));
  writeFileSync(join(root, "20261003-c/AGENT-main.md"), "https://github.com/org/app/pull/5 done\n");
  const [trees, texts] = [await worktrees(root), notesTexts(root)];
  const prs = Object.fromEntries(pullRequests(search(
    prNode(1, "me/one"), prNode(2, "me/two"), prNode(3, "x"), prNode(4, "y"), prNode(5, "z"),
  )).map((p) => [p.number, p]));
  const found = (n: number) => owner(prs[n], trees, texts);
  assert.deepEqual(found(1), { project: join(root, "20261001-a"), dir: join(root, "20261001-a/app"), role: null });
  // The checkout on me/two is of another repository.
  assert.equal(found(2), null);
  assert.deepEqual(found(3), { project: join(root, "20261002-b"), dir: null, role: "prs" });
  assert.equal(found(4), null);
  assert.equal(found(5)?.project, join(root, "20261003-c"));
});

test("needs the pull request's repo in the worktree", () => {
  const [pr] = pullRequests(search(prNode(1, "me/one", { repo: "Org/App" })));
  const tree = (repo: string | null) => [{ project: "/p/a", dir: "/p/a/app", branch: "me/one", repo }];
  assert.equal(owner(pr, tree("org/app"), [])?.dir, "/p/a/app");
  assert.equal(owner(pr, tree(null), []), null);
});

test("finds agent panes", () => {
  const pane = (pane_id: string, cwd: string, role?: string, agent: string | null = "claude"): HerdrPane =>
    ({ pane_id, workspace_id: "w1", agent, cwd: "/p/a", tokens: { cwd, ...(role ? { role } : {}) } });
  const panes = [pane("shell", "/p/a/app", undefined, null), pane("main", "/p/a", "main"),
                 pane("prs", "/p/a", "prs"), pane("app", "/p/a/app/sub"), pane("b", "/p/ab")];
  const find = (f: object) => agentPane(panes, { project: "/p/a", ...f })?.pane_id ?? null;
  assert.equal(find({ dir: "/p/a/app" }), "app");
  assert.equal(find({ role: "prs" }), "prs");
  assert.equal(find({ role: "gone" }), "main");
  assert.equal(find({ project: "/p/c" }), null);
});

test("reports pull request changes", () => {
  const before = pullRequests(search(
    prNode(1, "a", { checks: "PENDING" }), prNode(2, "b", { checks: "PENDING" }),
    prNode(3, "c", { checks: "SUCCESS" }), prNode(4, "d", { checks: "FAILURE" }),
  ));
  assert.deepEqual(events(null, before), []);
  const old = remember(null, before);
  const after = pullRequests(search(
    prNode(1, "a", { checks: "FAILURE", failed: ["test"] }),
    prNode(2, "b", { checks: "SUCCESS", review: "APPROVED" }),
    prNode(3, "c", { state: "MERGED", checks: "SUCCESS" }),
    prNode(4, "d", { checks: "FAILURE" }),
    prNode(5, "e", { checks: "FAILURE", failed: ["lint"] }),
    prNode(6, "f", { checks: "PENDING" }),
  ));
  assert.deepEqual(events(old, after).map(([p, m, w]) => [p.number, m, w]), [
    [1, "checks failed: test", true], [2, "checks passed", false], [2, "approved", false],
    [3, "merged", false], [5, "checks failed: lint", true],
  ]);
  assert.deepEqual(Object.keys(remember(old, after)).sort(),
                   [1, 2, 4, 5, 6].map((n) => `https://github.com/org/app/pull/${n}`));
});

test("reports errored and unnamed checks", () => {
  const old = remember(null, pullRequests(search(prNode(1, "a", { checks: "PENDING" }))));
  const node = prNode(1, "a", { checks: "ERROR" });
  (node.commits.nodes[0].commit.statusCheckRollup!.contexts.nodes as object[]).push(
    { __typename: "StatusContext", state: "ERROR" });
  assert.deepEqual(events(old, pullRequests(search(node))).map(([, m, w]) => [m, w]), [["checks failed: ?", true]]);
});

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

test("searches pull requests in orgs", () => {
  const since = new Date(2026, 9, 2, 12);
  assert.equal(searchQuery(since), "is:pr author:@me archived:false updated:>=2026-10-02 sort:updated-desc");
  assert.equal(searchQuery(since, ["a", "b"]),
               "is:pr author:@me archived:false org:a org:b updated:>=2026-10-02 sort:updated-desc");
  assert.equal(searchQuery(since, ["a"], true),
               "is:pr author:@me archived:false is:open org:a updated:>=2026-10-02 sort:updated-desc");
});

test("reads open pull requests beyond the recent ones", () => {
  const data = search(prNode(2, "me/one", { state: "MERGED" }), prNode(1, "me/one"));
  data.data.open = { nodes: [prNode(1, "me/one"), prNode(3, "me/two")] };
  assert.deepEqual(pullRequests(data).map((p) => [p.number, p.state]), [[1, "OPEN"], [3, "OPEN"], [2, "MERGED"]]);
});

test("draws the watcher's pane", () => {
  assert.equal(screen("Pull requests", new Date(2026, 9, 16, 15, 4), ["a", "b"]), "Pull requests at 15:04\na\nb");
  assert.equal(screen("Pull requests", new Date(2026, 9, 16, 9, 5), []), "Pull requests at 09:05");
});

test("shows why gh failed", async () => {
  const gh = join(tmp(), "gh");
  writeFileSync(gh, '#!/bin/sh\necho "HTTP 502: Bad Gateway" >&2\nexit 1\n');
  chmodSync(gh, 0o755);
  await assert.rejects(fetch(gh), { message: "HTTP 502: Bad Gateway" });
});

// Returns Herdr with panes, keeping what it is told to do in calls.
function fakeHerdr(panes: () => HerdrPane[], calls: unknown[][]): PollHerdr {
  return {
    panes: async () => panes(),
    notify: async (...args) => void calls.push(["notify", ...args]),
    run: async (...args) => void calls.push(["run", ...args]),
  };
}

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
