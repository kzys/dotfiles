import assert from "node:assert/strict";
import { test } from "node:test";
import { pageTitle } from "./pages.ts";

test("titles each view of the page", () => {
  assert.deepEqual(
    ["", "diffs", `diffs/${encodeURIComponent("/p/x/wt/")}`, "diffs/%E0", "diffs/", "learnings"].map(pageTitle),
    ["Projects", "Worktrees", "wt · Diff", "%E0 · Diff", "Worktree · Diff", "Learnings"],
  );
});
