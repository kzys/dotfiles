import assert from "node:assert/strict";
import { test } from "node:test";
import { pullRequests } from "./github/pullrequest.ts";
import { screen, shown, waitingItems } from "./github-section.ts";
import { prNode, search } from "./github/fixtures.ts";

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

test("shows a failed check with the items before", () => {
  const at = new Date("2026-11-19T10:00:00Z");
  const next = new Date("2026-11-19T10:05:00Z");
  const before = [{ project: null, role: null, mark: "pr", text: "app#1 approved" }];
  assert.deepEqual(shown(at, next, null, "gh: timeout", before), {
    title: "Pull requests",
    section: { title: "Pull requests", at: at.toISOString(), next: next.toISOString(), lines: ["Cannot check pull requests: gh: timeout"] },
    items: before,
  });
});
