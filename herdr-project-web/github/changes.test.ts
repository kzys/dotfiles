import assert from "node:assert/strict";
import { test } from "node:test";
import { pullRequests } from "./pullrequest.ts";
import { events, remember } from "./changes.ts";
import { prNode, search } from "./fixtures.ts";

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
