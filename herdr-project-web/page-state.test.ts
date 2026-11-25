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
  const state = pageState(facts({ acting: { queued, hooks: new Map(), board: [], asks: [] } }));
  assert.deepEqual(state.controls, {
    "w1:p1": { queued: queued["w1:p1"], permission: null },
    t1: { queued: queued.t1, permission: null },
  });
  // The app's terminals haven't been read, so t1's may yet be delivered.
  assert.deepEqual(state.undelivered?.map((u) => u.pane), ["w1:p1"]);
  assert.deepEqual(state.board, []);
});

test("tells an agent asked gone only once what it ran in has been read", () => {
  const asked = (pane: string, message: string) => ({ pane, label: pane, message, token: pane, reply: null });
  const asks = [{ id: "1", text: "q", at: 1, agents: [asked("w1:p1", "m1"), asked("w1:p9", "m2"), asked("t9", "m3")] }];
  const statuses = (over: object) => pageState(facts({ ...over, acting: { queued: {}, hooks: new Map(), board: [], asks } }))
    .asks?.[0].agents.map((a) => a.status);
  // w1:p9 is gone from Herdr; the app's t9 may just not be read yet.
  assert.deepEqual(statuses({}), ["asked", "gone", "asked"]);
  assert.deepEqual(statuses({ appRead: true }), ["asked", "gone", "gone"]);
  // While Herdr can't be asked, its panes may still be there.
  assert.deepEqual(statuses({ herdr: null }), ["asked", "asked", "asked"]);
});
