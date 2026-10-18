import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectItems, waiting, watchedItems } from "./inbox.ts";
import { readState, workspaceLabels } from "./state.ts";

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
    sections: null, watchedAt: null, projects: [], unowned: [],
  });
});

test("names the workspaces with panes in a project", () => {
  const herdr = {
    workspaces: [{ workspace_id: "w1", label: "custom" }, { workspace_id: "w2" },
                 { workspace_id: "w3", label: "other" }],
    panes: [{ workspace_id: "w1", cwd: "/p/a/wt" }, { workspace_id: "w2", cwd: "/home",
              foreground_cwd: "/p/a" }, { workspace_id: "w3", cwd: "/p/ab" }],
  };
  assert.deepEqual(workspaceLabels("/p/a", herdr), ["custom", "w2"]);
  assert.deepEqual(workspaceLabels("/p/a", null), []);
});
