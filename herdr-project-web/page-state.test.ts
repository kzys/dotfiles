import assert from "node:assert/strict";
import { test } from "node:test";
import { type PageFacts, pageState } from "./page-state.ts";

const project = (dir: string, title: string) => ({ dir, readme: `---\ntitle: ${title}\n---\n`, notes: [], worktrees: [], files: [] });

const facts = (over: Partial<PageFacts> = {}): PageFacts => ({
  herdr: { workspaces: [{ workspace_id: "w1", label: "a" }], panes: [
    { pane_id: "w1:p1", workspace_id: "w1", cwd: "/p/a", agent: "claude", agent_status: "idle", agent_session: { value: "s1" } },
  ] },
  appPanes: [{ pane_id: "t1", workspace_id: "sp1", cwd: "/p/b", agent: "claude", agent_status: "working", agent_session: { value: "s2" } }],
  appRead: false,
  watched: null,
  projects: [project("/p/a", "A"), project("/p/b", "B")],
  acting: null,
  ...over,
});

test("shows the projects with their panes", () => {
  const state = pageState(facts());
  assert.deepEqual(state.projects.map((p) => [p.title, p.panes.map((q) => q.id)]), [["A", ["w1:p1"]], ["B", ["t1"]]]);
  assert.deepEqual(state.agents, { "w1:p1": "idle", t1: "working" });
  assert.equal("controls" in state, false);
});

test("shows what the watcher's server acts on, telling undelivered only what has been read", () => {
  const queued = { "w1:p1": [{ id: "1", text: "hi", at: 1, session: "old" }], t1: [{ id: "2", text: "yo", at: 2, session: "old" }] };
  const state = pageState(facts({ acting: { queued, hooks: new Map(), board: [] } }));
  assert.deepEqual(state.controls, {
    "w1:p1": { queued: queued["w1:p1"], permission: null },
    t1: { queued: queued.t1, permission: null },
  });
  // The app's terminals haven't been read, so t1's may yet be delivered.
  assert.deepEqual(state.undelivered?.map((u) => u.pane), ["w1:p1"]);
  assert.deepEqual(state.board, []);
});
