import assert from "node:assert/strict";
import { test } from "node:test";
import { pageTitle, route, tab } from "./pages.ts";

test("routes each view of the page", () => {
  const hashes = ["", "diffs", `diffs/${encodeURIComponent("/p/x/wt/")}`, "diffs/%E0", "diffs/", "learnings", "nope"];
  assert.deepEqual(hashes.map(route), [
    { view: "projects" }, { view: "worktrees" }, { view: "diff", dir: "/p/x/wt/" }, { view: "diff", dir: "%E0" },
    { view: "diff", dir: "" }, { view: "learnings" }, { view: "projects" },
  ]);
  assert.deepEqual(hashes.map((h) => pageTitle(route(h))), [
    "Projects", "Worktrees", "wt · Diff", "%E0 · Diff", "Worktree · Diff", "Learnings", "Projects",
  ]);
  assert.deepEqual(hashes.map((h) => tab(route(h))), [
    "projects", "worktrees", "worktrees", "worktrees", "worktrees", "learnings", "projects",
  ]);
});
