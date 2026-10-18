import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { halMessage } from "./hal.ts";
import { linkParts, projectItems, uniqueKeys, waiting, watchedItems } from "./inbox.ts";
import { agentState, readiness } from "./pulls.ts";
import { type PullRequest, agentStates, pullRequestLinks, readState, workspaceLabels } from "./state.ts";

test("guesses what waits on me as inbox.py does", () => {
  assert.deepEqual(
    [
      "Apply the change to staging (user)", "Cleanup left (ask): branches",
      "Agree on the design with the user", "Rollout not decided yet", "Branch is local only",
      "Offer: file a ticket", "Post outcome in the thread if user wants",
      "Rerun 4 timed-out clusters", "Unverified: GPU containers work",
      "[ ] Decide on the rollout", "[x] Decide on the rollout", "Is the user okay to push?",
      "Offers to file a ticket", "Wrote notes for the user", "Shared summary with the user",
      "PR approved, waiting on CI", "Decision: went with B", "Needs approval from the owner",
      "Confirm the plan with the user", "[you] Push it",
    ].map(waiting), [
    "?", "?", "?", "?", "?", "maybe", "maybe", null, null,
    "?", null, "?", "maybe", null, null, null, null, "?", "?", "you",
  ]);
});

test("closes roles and then the project", () => {
  const a = "closed: https://x/pull/1\n\n## Remaining\n- [you] Stale\n\n## Findings\n- etcd needs 3\n";
  const b = "## Remaining\n- None.\n";
  const c = "## Remaining\n- [you] Decide X\n\n## Log\n- closed: no\n";
  const notes: [string, string][] = [["a", a], ["b", b], ["c", c]];
  assert.deepEqual(projectItems("/p", null, notes).map((i) => [i.role, i.mark, i.text]), [
    ["c", "you", "Decide X"],
    ["b", "close", "Nothing remaining for b; tell its agent its part is done to close it"],
  ]);
  // The watcher's items hold the suggestions back.
  const watched = [{ project: "/p", role: null, mark: "pr", text: "app#1 failed" }];
  assert.deepEqual(projectItems("/p", null, notes, watched).map((i) => i.mark), ["you", "pr"]);

  notes[2][1] = "closed: decided X\n\n## Remaining\n";
  assert.deepEqual(projectItems("/p", null, notes).map((i) => i.text), [
    "Nothing remaining; tell its agent the task is done to close it",
  ]);
  assert.deepEqual(projectItems("/p", "---\nclosed: done\n---\n", notes), []);
  // Notes with CRLF line ends read the same.
  const crlf: [string, string][] = notes.map(([r, t]) => [r, t.replaceAll("\n", "\r\n")]);
  assert.deepEqual(projectItems("/p", null, crlf), projectItems("/p", null, notes));
});

test("skips watched items not in the watcher's form", () => {
  assert.deepEqual(
    watchedItems({
      Panes: [{ project: null, role: null, mark: "idle", text: "idle" }, { mark: "x" }, 3],
      Slack: "junk",
    }), [{ project: null, role: null, mark: "idle", text: "idle" }]);
  assert.deepEqual(watchedItems([]), []);
});

test("reads the watcher's files and the projects' notes", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const state = join(root, "state");
  const projects = join(root, "project");
  const p1 = join(projects, "20261018-a");
  const p2 = join(projects, "20261017-b");
  const closed = join(projects, "20261016-c");
  const hidden = join(projects, ".trash");
  for (const d of [state, p1, p2, closed, hidden]) mkdirSync(d, { recursive: true });
  writeFileSync(join(closed, "README.md"), "---\nclosed: done\n---\n");
  writeFileSync(join(hidden, "AGENT-main.md"), "## Remaining\n- [you] Old\n");
  writeFileSync(join(p1, "README.md"), "---\ntitle: Do A\nname: a\n---\n");
  writeFileSync(join(p1, "AGENT-main.md"), "## Remaining\n- [you] Pick one\n");
  writeFileSync(join(p2, "AGENT-main.md"), "## Remaining\n- [wait] CI\n");
  writeFileSync(
    join(state, "screen.json"),
    JSON.stringify([{ title: "Panes", at: null, lines: ["90% w1:p1 a"] }]),
  );
  writeFileSync(
    join(state, "inbox.json"),
    JSON.stringify({
      Panes: [{ project: p1, role: "main", mark: "ctx", text: "context 90% full" }],
      Slack: [{ project: join(projects, "gone"), role: null, mark: "slack", text: "hi" },
              { project: null, role: null, mark: "slack", text: "dm" }],
      "Pull requests": [{ project: closed, role: null, mark: "pr", text: "c#1 failed" }],
    }),
  );

  const s = readState(state, projects);
  assert.deepEqual(s.sections, [{ title: "Panes", at: null, lines: ["90% w1:p1 a"] }]);
  assert.notEqual(s.watchedAt, null);
  assert.deepEqual(s.projects.map((p) => [p.name, p.title, p.items.map((i) => i.text)]), [
    ["a", "Do A", ["Pick one", "context 90% full"]],
  ]);
  assert.deepEqual(s.unowned.map((i) => i.text), ["hi", "dm", "c#1 failed"]);

  assert.deepEqual(readState(join(root, "none"), join(root, "none")), {
    sections: null, watchedAt: null, projects: [], unowned: [], links: {}, agents: null,
  });
});

test("names the workspaces with panes in a project", () => {
  const herdr = {
    workspaces: [{ workspace_id: "w1", label: "custom" }, { workspace_id: "w2" },
                 { workspace_id: "w3", label: "other" }],
    panes: [{ pane_id: "w1:p1", workspace_id: "w1", cwd: "/p/a/wt" },
            { pane_id: "w2:p1", workspace_id: "w2", cwd: "/home", foreground_cwd: "/p/a" },
            { pane_id: "w3:p1", workspace_id: "w3", cwd: "/p/ab" }],
  };
  assert.deepEqual(workspaceLabels("/p/a", herdr), ["custom", "w2"]);
  assert.deepEqual(workspaceLabels("/p/a", null), []);
});

test("links pull requests by their labels", () => {
  const links = pullRequestLinks({
    "https://github.com/kzys/dotfiles/pull/80": { state: "OPEN" },
    "https://github.com/kzys/containerd/pull/12": { state: "OPEN" },
    "https://github.com/containerd/containerd/pull/12": { state: "OPEN" },
    "https://example.com/x": {},
  });
  assert.deepEqual(links, {
    "kzys/dotfiles#80": "https://github.com/kzys/dotfiles/pull/80",
    "dotfiles#80": "https://github.com/kzys/dotfiles/pull/80",
    "kzys/containerd#12": "https://github.com/kzys/containerd/pull/12",
    "containerd/containerd#12": "https://github.com/containerd/containerd/pull/12",
  });
  assert.deepEqual(pullRequestLinks(null), {});

  assert.deepEqual(linkParts("✓ ● dotfiles#80     dotfiles   Add it", links), [
    ["✓ ● "], ["dotfiles#80", "https://github.com/kzys/dotfiles/pull/80"],
    ["     dotfiles   Add it"]]);
  // A label two pull requests share links only with its owner.
  assert.deepEqual(linkParts("containerd#12 and containerd/containerd#12", links), [
    ["containerd#12"], [" and "],
    ["containerd/containerd#12", "https://github.com/containerd/containerd/pull/12"]]);
  // Another owner's pull request with the same name isn't this one.
  assert.deepEqual(linkParts("other/dotfiles#80 is done", links), [
    ["other/dotfiles#80"], [" is done"]]);
  assert.deepEqual(linkParts("see https://x.test/pull/1#c-2) or x#1", links), [
    ["see "], ["https://x.test/pull/1#c-2", "https://x.test/pull/1#c-2"], [") or "], ["x#1"]]);
  assert.deepEqual(linkParts("__proto__#1 constructor", links), [["__proto__#1"], [" constructor"]]);
});

test("has HAL say what needs attention first", () => {
  const ok = { connected: true, running: true, stale: false, waiting: 0, hour: 9 };
  assert.equal(halMessage(ok), "Good morning. All systems functional. Nothing requires your attention.");
  assert.equal(halMessage({ ...ok, waiting: 1, hour: 20 }), "Good evening. One matter requires your attention.");
  assert.equal(halMessage({ ...ok, waiting: 3, hour: 2 }), "Working late. 3 matters require your attention.");
  assert.match(halMessage({ ...ok, stale: true, waiting: 3 }), /stopped reporting/);
  assert.match(halMessage({ ...ok, running: false, stale: true }), /isn't running/);
  assert.match(halMessage({ ...ok, connected: false, running: false }), /lost contact/);
});

test("numbers repeated keys", () => {
  assert.deepEqual(uniqueKeys(["a", "b", "a", "a"]), ["a", "b", "a#1", "a#2"]);
});

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
