import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pullRequests } from "./pullrequest.ts";
import { agentPane, checkoutPanes, owner, worktrees } from "./match.ts";
import { gitCheckout, prNode, search, tmp } from "./fixtures.ts";
import { notesTexts } from "../checks/owners.ts";
import type { HerdrPane } from "../checks/panes.ts";

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
