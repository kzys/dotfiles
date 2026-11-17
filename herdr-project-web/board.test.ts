import assert from "node:assert/strict";
import { test } from "node:test";
import { askCopilot, cards, copilotComments, nextCopilotSeen, routerMessage, moveTo, stage, stillMoved, toAskCopilot } from "./board.ts";
import type { Pull } from "./github.ts";

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

test("asks Copilot once checks pass on a draft it hasn't reviewed", () => {
  const prs = [
    pull(1, { checks: "SUCCESS" }),
    pull(2, { checks: "PENDING" }),
    pull(3, { checks: "FAILURE" }),
    pull(4, { checks: "SUCCESS", copilot: "unresolved" }),
    pull(5, { checks: "SUCCESS" }),
    pull(6, { checks: "SUCCESS" }),
    pull(7, { checks: "SUCCESS", review: "APPROVED" }),
    pull(8, { checks: "SUCCESS", state: "MERGED" }),
    pull(9, { checks: "SUCCESS", draft: true }),
    pull(10),
  ];
  // A failed request is tried again.
  const asks = { [prs[4].url]: "requested", [prs[8].url]: "HTTP 502" };
  assert.deepEqual(toAskCopilot(prs, { [prs[5].url]: "copilot" }, asks).map((p) => p.number), [1, 9, 10]);
});

test("keeps what came of each request to Copilot", async () => {
  const prs = [pull(1, { checks: "SUCCESS" }), pull(2, { checks: "SUCCESS" }), pull(3, { checks: "SUCCESS" })];
  const asked: string[] = [];
  const request = async (url: string) => {
    asked.push(url);
    if (url === prs[1].url) throw new Error("could not request Copilot\nmore");
  };
  const asks = await askCopilot(prs, {}, { [prs[2].url]: "requested" }, request);
  assert.deepEqual(asked, [prs[0].url, prs[1].url]);
  assert.deepEqual(asks, {
    [prs[2].url]: "requested", [prs[0].url]: "requested", [prs[1].url]: "could not request Copilot",
  });
  assert.equal(cards(prs, {}, (d) => d, {}, new Date(), asks)[1].copilotAsk, "could not request Copilot");
});

test("routes each review of Copilot's that leaves threads open", () => {
  const prs = [
    pull(1, { copilot: "unresolved", copilotReviews: 1 }),
    pull(2, { copilot: "unresolved", copilotReviews: 1 }),
    pull(3, { copilot: "passed", copilotReviews: 1 }),
    pull(4, { copilot: "unresolved", copilotReviews: 1, state: "MERGED" }),
  ];
  const seen = { [prs[1].url]: 1, "https://github.com/org/app/pull/9": 2 };
  const routed = copilotComments(prs, seen);
  assert.deepEqual(routed.map((p) => p.number), [1]);
  const next = nextCopilotSeen(seen, prs, [prs[0].url, prs[1].url, prs[2].url]);
  assert.deepEqual(next, { [prs[0].url]: 1, [prs[1].url]: 1, [prs[2].url]: 1 });
  assert.deepEqual(copilotComments(prs, next), []);
  // Another review is routed, even while the first one's threads are open.
  assert.deepEqual(copilotComments([pull(2, { copilot: "unresolved", copilotReviews: 2 })], next).map((p) => p.number), [2]);
  assert.equal(
    routerMessage([prs[0], prs[1]], { [prs[0].url]: { project: "/p/a", dir: null, role: null } }),
    `Copilot left review comments on ${prs[0].url} (project /p/a), ${prs[1].url}. ` +
      "Give each to the agent working on it, to address the comments, push the fixes, and reply to each, " +
      "leaving the threads unresolved.",
  );
});
