import assert from "node:assert/strict";
import { test } from "node:test";
import { agentState, readiness } from "./pulls.ts";
import { type PullRequest, agentStates } from "./state.ts";

test("says where a pull request stands", () => {
  const pr: PullRequest = {
    url: "u", repo: "o/r", number: 1, label: "r#1", title: "t", draft: false,
    checks: "SUCCESS", failed: [], review: null, project: null, agent: false,
    runs: [{ name: "a", state: "passed", url: null }, { name: "b", state: "skipped", url: null }],
  };
  const running = [...pr.runs!, { name: "c", state: "running" as const, url: null }];
  const failed = [...running, { name: "d", state: "failed" as const, url: null }];
  assert.deepEqual(readiness(pr), ["ready for review", "ok"]);
  assert.deepEqual(readiness({ ...pr, review: "APPROVED" }), ["ready to merge", "done"]);
  assert.deepEqual(readiness({ ...pr, runs: running }), ["checks running", "wait"]);
  assert.deepEqual(readiness({ ...pr, runs: failed }), ["checks failing", "bad"]);
  assert.deepEqual(readiness({ ...pr, runs: failed, review: "CHANGES_REQUESTED" }),
                   ["changes requested", "bad"]);
  assert.deepEqual(readiness({ ...pr, runs: failed, draft: true }), ["draft", "wait"]);
  // A cancelled check fails GitHub's rollup but isn't failing here.
  const cancelled = [...pr.runs!, { name: "c", state: "cancelled" as const, url: null }];
  assert.deepEqual(readiness({ ...pr, runs: cancelled, checks: "FAILURE" }), ["ready for review", "ok"]);
  // Watchers that don't keep each check still give their rollup.
  assert.deepEqual(readiness({ ...pr, runs: undefined, checks: "PENDING" }), ["checks running", "wait"]);
});

test("tells a pull request still worked on from one that is ready", () => {
  const pr: PullRequest = {
    url: "u", repo: "o/r", number: 1, label: "r#1", title: "t", draft: false,
    checks: "SUCCESS", failed: [], review: null, project: null, agent: true, pane: "w1:p1",
    runs: [{ name: "a", state: "passed", url: null }],
  };
  assert.equal(agentState(pr, { "w1:p1": "working" }), "working");
  assert.equal(agentState(pr, { "w1:p1": "done" }), "idle");
  assert.equal(agentState(pr, { "w1:p1": "starting" }), "unknown");
  // Its pane has closed.
  assert.equal(agentState(pr, {}), null);
  // Herdr couldn't be asked, or the watcher only guessed the pane.
  assert.equal(agentState(pr, null), "unknown");
  assert.equal(agentState({ ...pr, pane: null }, { "w1:p1": "working" }), "unknown");
  assert.equal(agentState({ ...pr, agent: false, pane: null }, {}), null);

  assert.deepEqual(agentStates({
    workspaces: [],
    panes: [
      { pane_id: "w1:p1", workspace_id: "w1", agent: "claude", agent_status: "working" },
      { pane_id: "w1:p2", workspace_id: "w1", agent: null, agent_status: "unknown" },
    ],
  }), { "w1:p1": "working" });
  assert.equal(agentStates(null), null);

  assert.deepEqual(readiness(pr, "working"), ["agent working", "wait"]);
  assert.deepEqual(readiness(pr, "idle"), ["ready for review", "ok"]);
  assert.deepEqual(readiness({ ...pr, review: "APPROVED" }, "working"), ["agent working", "wait"]);
  // Failing checks matter more than the agent being at work on them.
  assert.deepEqual(readiness({ ...pr, checks: "FAILURE", runs: undefined }, "working"),
                   ["checks failing", "bad"]);
  // An agent waiting on the user matters most.
  assert.deepEqual(readiness({ ...pr, draft: true }, "blocked"), ["agent needs you", "bad"]);
});
