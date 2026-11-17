import assert from "node:assert/strict";
import { test } from "node:test";
import { cards, stage, stillReviewed } from "./board.ts";
import type { Pull } from "./github.ts";

function pull(number: number, over: Partial<Pull> = {}): Pull {
  return {
    url: `https://github.com/org/app/pull/${number}`, repo: "org/app", head: "org/app", number, title: `PR ${number}`,
    branch: `b${number}`, state: "OPEN", draft: false, checks: null, failed: [], runs: [], review: null,
    mergedAt: null, copilot: "none", ...over,
  };
}

test("puts a pull request in the column of the furthest stage it reached", () => {
  assert.equal(stage(pull(1, { draft: true }), false), "draft");
  assert.equal(stage(pull(1, { copilot: "unresolved" }), false), "draft");
  assert.equal(stage(pull(1, { copilot: "passed" }), false), "copilot");
  assert.equal(stage(pull(1, { copilot: "passed" }), true), "reviewed");
  assert.equal(stage(pull(1), true), "reviewed");
  assert.equal(stage(pull(1, { review: "APPROVED" }), false), "approved");
  assert.equal(stage(pull(1, { review: "APPROVED", state: "MERGED" }), true), "merged");
});

test("shows open pull requests and those merged within a day", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const prs = [
    pull(1, { copilot: "passed" }),
    pull(2, { state: "MERGED", mergedAt: "2026-11-15T13:00:00Z" }),
    pull(3, { state: "MERGED", mergedAt: "2026-11-15T11:00:00Z" }),
    pull(4, { state: "CLOSED" }),
  ];
  const owners = { [prs[0].url]: { project: "/p/20261101-a", dir: null, role: null } };
  const shown = cards(prs, owners, (d) => `name of ${d}`, new Set([prs[0].url]), now);
  assert.deepEqual(shown.map((c) => [c.label, c.stage, c.reviewed, c.project, c.projectDir]), [
    ["app#1", "reviewed", true, "name of /p/20261101-a", "/p/20261101-a"],
    ["app#2", "merged", false, null, null],
  ]);
});

test("forgets reviews of pull requests no longer open", () => {
  const prs = [pull(1), pull(2, { state: "MERGED" }), pull(3, { state: "CLOSED" })];
  const missing = "https://github.com/org/app/pull/9";
  assert.deepEqual(stillReviewed([prs[0].url, prs[1].url, prs[2].url, missing], prs), [prs[0].url, missing]);
});
