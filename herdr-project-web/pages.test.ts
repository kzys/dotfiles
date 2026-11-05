import assert from "node:assert/strict";
import { test } from "node:test";
import { fileHref, pageTitle, projectHref, route, tab } from "./pages.ts";

test("routes to the page of a project's file", () => {
  const dir = "/p/20261026-a b";
  assert.deepEqual(route(fileHref(dir, "AGENT-main.md").slice(1)), { view: "file", dir, name: "AGENT-main.md" });
  assert.equal(pageTitle(route(fileHref(dir, "a/b.txt").slice(1))), "a/b.txt · 20261026-a b");
  assert.equal(tab(route("files/x/y")), "projects");
});

test("routes to the page of a project", () => {
  const dir = "/p/20261026-a b";
  assert.deepEqual(route(projectHref(dir).slice(1)), { view: "project", dir });
  assert.equal(pageTitle(route(projectHref(dir).slice(1))), "20261026-a b · Project");
  assert.equal(tab(route("projects/x")), "projects");
});

test("routes each view of the page", () => {
  const hashes = ["", "projects", "diffs", `diffs/${encodeURIComponent("/p/x/wt/")}`, "diffs/%E0", "diffs/", "learnings", "nope"];
  assert.deepEqual(hashes.map(route), [
    { view: "inbox" }, { view: "projects" }, { view: "worktrees" }, { view: "diff", dir: "/p/x/wt/" },
    { view: "diff", dir: "%E0" }, { view: "diff", dir: "" }, { view: "learnings" }, { view: "inbox" },
  ]);
  assert.deepEqual(hashes.map((h) => pageTitle(route(h))), [
    "Inbox", "Projects", "Worktrees", "wt · Diff", "%E0 · Diff", "Worktree · Diff", "Learnings", "Inbox",
  ]);
  assert.deepEqual(hashes.map((h) => tab(route(h))), [
    "inbox", "projects", "worktrees", "worktrees", "worktrees", "worktrees", "learnings", "inbox",
  ]);
});
