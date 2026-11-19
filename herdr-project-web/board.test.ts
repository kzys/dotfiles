import assert from "node:assert/strict";
import { test } from "node:test";
import { askCopilot, canAskCopilot, cards, moveTo, stage, stillAsked, stillMoved } from "./board.ts";
import type { PullRequest as Pull } from "./github/pullrequest.ts";

function pull(number: number, over: Partial<Pull> = {}): Pull {
  return {
    url: `https://github.com/org/app/pull/${number}`, repo: "org/app", head: "org/app", number, title: `PR ${number}`,
    branch: `b${number}`, state: "OPEN", draft: false, checks: null, failed: [], runs: [], review: null,
    mergedAt: null, copilot: "none", copilotReviews: 0, ...over,
  };
}

test("puts a pull request in the column of the furthest stage it reached", () => {
  assert.equal(stage(pull(1, { draft: true })), "draft");
  assert.equal(stage(pull(1, { checks: "SUCCESS", copilot: "unresolved" })), "draft");
  assert.equal(stage(pull(1, { checks: "PENDING" })), "ci");
  assert.equal(stage(pull(1, { checks: "FAILURE", copilot: "unresolved" })), "ci");
  assert.equal(stage(pull(1, { checks: "FAILURE", copilot: "passed" })), "copilot");
  assert.equal(stage(pull(1, { copilot: "passed" })), "copilot");
  assert.equal(stage(pull(1, { review: "APPROVED" })), "approved");
  // A column the user moved it to counts only if it is further.
  assert.equal(stage(pull(1, { copilot: "unresolved" }), "copilot"), "copilot");
  assert.equal(stage(pull(1, { copilot: "passed" }), "reviewed"), "reviewed");
  assert.equal(stage(pull(1), "reviewed"), "reviewed");
  assert.equal(stage(pull(1, { review: "APPROVED", state: "MERGED" }), "reviewed"), "merged");
});

test("moves cards only to the columns that are the user's", () => {
  assert.deepEqual(
    (["ci", "draft", "copilot", "reviewed", "approved", "merged"] as const).map((s) => [moveTo(s, 1), moveTo(s, -1)]),
    [[undefined, undefined], ["copilot", undefined], ["reviewed", null], [undefined, "copilot"], [undefined, undefined], [undefined, undefined]],
  );
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
  const shown = cards(prs, owners, (d) => `name of ${d}`, { [prs[0].url]: "reviewed" }, now);
  assert.deepEqual(shown.map((c) => [c.label, c.stage, c.moved, c.found, c.project, c.projectDir]), [
    ["app#1", "reviewed", "reviewed", "copilot", "name of /p/20261101-a", "/p/20261101-a"],
    ["app#2", "merged", null, "merged", null, null],
  ]);
});

test("forgets moves of pull requests no longer open", () => {
  const prs = [pull(1), pull(2, { state: "MERGED" }), pull(3, { state: "CLOSED" })];
  const missing = "https://github.com/org/app/pull/9";
  const moves = { [prs[0].url]: "copilot" as const, [prs[1].url]: "reviewed" as const, [prs[2].url]: "reviewed" as const,
                  [missing]: "reviewed" as const };
  assert.deepEqual(stillMoved(moves, prs), { [prs[0].url]: "copilot", [missing]: "reviewed" });
});

test("lets the user ask Copilot once checks pass and until its review lets a card on", () => {
  const prs = [
    pull(1, { checks: "PENDING" }),
    pull(2, { checks: "SUCCESS", copilot: "unresolved" }),
    pull(3, { copilot: "passed" }),
    pull(4, { review: "APPROVED" }),
    pull(5, { state: "MERGED" }),
    pull(6),
  ];
  const all = cards(prs, {}, (d) => d, { [prs[5].url]: "copilot" }, new Date(), {});
  assert.deepEqual(all.filter(canAskCopilot).map((c) => c.label), ["app#2"]);
});

test("keeps what came of each request to Copilot", async () => {
  const prs = [pull(1), pull(2)];
  const request = async (url: string) => {
    if (url === prs[1].url) throw new Error("could not request Copilot\nmore");
  };
  let asks = await askCopilot(prs[0].url, {}, request);
  asks = await askCopilot(prs[1].url, asks, request);
  assert.deepEqual(asks, { [prs[0].url]: "requested", [prs[1].url]: "could not request Copilot" });
  assert.equal(cards(prs, {}, (d) => d, {}, new Date(), asks)[1].copilotAsk, "could not request Copilot");
});

test("forgets requests to Copilot for pull requests no longer open", () => {
  assert.deepEqual(stillAsked({ a: "requested", b: "failed" }, ["b", "c"]), { b: "failed" });
});
