import assert from "node:assert/strict";
import { test } from "node:test";
import { diffHref, fileHref, isPagePath, locationKey, movedTo, pageTitle, projectHref, route, tab } from "./pages.ts";

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
  const hashes = ["", "projects", "diffs", `diffs/${encodeURIComponent("/p/x/wt/")}`, "diffs/%E0", "diffs/", "learnings", "pulls", "nope"];
  assert.deepEqual(hashes.map(route), [
    { view: "inbox" }, { view: "projects" }, { view: "projects" }, { view: "diff", dir: "/p/x/wt/", project: null },
    { view: "diff", dir: "%E0", project: null }, { view: "diff", dir: "", project: null }, { view: "learnings" }, { view: "pulls" }, { view: "inbox" },
  ]);
  assert.deepEqual(hashes.map((h) => pageTitle(route(h))), [
    "Inbox", "Projects", "Projects", "wt · Diff", "%E0 · Diff", "Worktree · Diff", "Learnings", "Pull requests", "Inbox",
  ]);
  assert.deepEqual(hashes.map((h) => tab(route(h))), [
    "inbox", "projects", "projects", "projects", "projects", "projects", "learnings", "pulls", "inbox",
  ]);
});

test("reads views from the path or the hash", () => {
  assert.deepEqual(route(locationKey("/pulls", "")), { view: "pulls" });
  assert.deepEqual(route(locationKey("/", "#projects")), { view: "projects" });
  assert.deepEqual(route(locationKey("/pulls", "#projects")), { view: "projects" });
  assert.deepEqual(route(locationKey("/", "")), { view: "inbox" });
  assert.equal(movedTo("#pulls"), "/pulls");
  assert.equal(movedTo("#projects"), null);
  assert.equal(movedTo(""), null);
  assert.ok(isPagePath("/") && isPagePath("/pulls") && !isPagePath("/api/state"));
});

test("links diffs under their project", () => {
  const project = "/p/20261026-a b";
  const dir = "/p/20261026-a b/wt/x";
  assert.deepEqual(route(diffHref(project, dir).slice(1)), { view: "diff", dir, project });
  assert.equal(tab(route(diffHref(project, dir).slice(1))), "projects");
  assert.deepEqual(route(projectHref(project).slice(1)), { view: "project", dir: project });
});
