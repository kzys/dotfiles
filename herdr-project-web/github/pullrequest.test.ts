import assert from "node:assert/strict";
import { test } from "node:test";
import { type PullRequest as Pull, copilotReview, pullBases, pullRequests, repoName, runs } from "./pullrequest.ts";
import { prNode, search } from "./fixtures.ts";

test("reads pull requests", () => {
  const prs = pullRequests(search(prNode(1, "a", { checks: "FAILURE", failed: ["test", "lint"] }), prNode(2, "b"), {}));
  assert.deepEqual(prs.map((p) => [p.number, p.checks, p.failed]), [[1, "FAILURE", ["lint", "test"]], [2, null, []]]);
  assert.equal(prs[0].repo, "org/app");
  assert.equal(prs[0].branch, "a");
  assert.deepEqual(prs[0].runs.map((r) => [r.name, r.state]), [["lint", "failed"], ["ok", "passed"], ["test", "failed"]]);
});

test("reads how far Copilot's review has come", () => {
  const thread = (isResolved: boolean, login: string) => ({ isResolved, comments: { nodes: [{ author: { login } }] } });
  const node = (reviews: number, ...threads: object[]) => ({
    copilotReviews: { totalCount: reviews }, reviewThreads: { pageInfo: { hasNextPage: false }, nodes: threads },
  });
  assert.equal(copilotReview({}), "none");
  assert.equal(copilotReview(node(0)), "none");
  assert.equal(copilotReview(node(1)), "passed");
  assert.equal(copilotReview(node(1, thread(true, "copilot-pull-request-reviewer"), thread(false, "someone"))), "passed");
  assert.equal(copilotReview(node(1, thread(false, "copilot-pull-request-reviewer"))), "unresolved");
  // Threads it can't read all of may hide an unresolved one.
  assert.equal(copilotReview({ copilotReviews: { totalCount: 1 } }), "unresolved");
  assert.equal(copilotReview({ ...node(1), reviewThreads: { pageInfo: { hasNextPage: true }, nodes: [] } }), "unresolved");
  const [pr] = pullRequests(search({ ...prNode(1, "a"), mergedAt: "2026-11-15T13:00:00Z", ...node(1) }));
  assert.deepEqual([pr.mergedAt, pr.copilot], ["2026-11-15T13:00:00Z", "passed"]);
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

test("reads open pull requests beyond the recent ones", () => {
  const data = search(prNode(2, "me/one", { state: "MERGED" }), prNode(1, "me/one"));
  data.data.open = { nodes: [prNode(1, "me/one"), prNode(3, "me/two")] };
  assert.deepEqual(pullRequests(data).map((p) => [p.number, p.state]), [[1, "OPEN"], [3, "OPEN"], [2, "MERGED"]]);
});

test("reads what open pull requests in the repository merge into", () => {
  const pr = (over: object) => ({ repo: "o/r", head: "o/r", branch: "b", base: "parent", state: "OPEN", ...over }) as Pull;
  assert.deepEqual(pullBases([
    pr({}), pr({ branch: "merged", state: "MERGED" }), pr({ branch: "fork", head: "me/r" }), pr({ branch: "none", base: undefined }),
  ]), { "o/r:b": "parent" });
});
