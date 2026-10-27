import assert from "node:assert/strict";
import { test } from "node:test";
import type { Herdr } from "./state.ts";
import { title, watchWorkspace, watchedFrom } from "./watched.ts";

test("puts what the checks found together", () => {
  const prs = { title: "Pull requests", at: "2026-10-16T09:00:00.000Z", lines: ["a"] };
  const panes = { title: "Panes", at: "2026-10-16T09:01:00.000Z", lines: ["b"] };
  const item = { project: null, role: null, mark: "idle", text: "x" };
  // One without a section shows none.
  assert.deepEqual(
    watchedFrom([
      { title: "Pull requests", section: prs, items: [item] },
      { title: "Panes", section: panes, items: [] },
      { title: "Slack", section: null, items: [] },
    ], ["https://github.com/o/r/pull/1"]),
    {
      sections: [prs, panes],
      inbox: { "Pull requests": [item], Panes: [], Slack: [] },
      urls: ["https://github.com/o/r/pull/1"],
      at: prs.at,
    },
  );
});

test("titles the watch workspace", () => {
  assert.equal(title({ "Pull requests": [{}, {}], Panes: [], Slack: [{}] }), "Pull requests: 2 · Slack: 1");
  assert.equal(title({ Panes: [], x: "junk" }), "Nothing waiting");
  assert.equal(title(null), "Nothing waiting");

  const herdr: Herdr = {
    workspaces: [{ workspace_id: "w1", label: "watch" }, { workspace_id: "w2", label: "proj" }],
    panes: [],
  };
  assert.equal(watchWorkspace({ HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1" }, herdr), "w1");
  assert.equal(watchWorkspace({ HERDR_PANE_ID: "w2:p1", HERDR_WORKSPACE_ID: "w2" }, herdr), null);
  assert.equal(watchWorkspace({ HERDR_WORKSPACE_ID: "w1" }, herdr), null);
  assert.equal(watchWorkspace({ HERDR_PANE_ID: "w1:p1" }, herdr), null);
  assert.equal(watchWorkspace({ HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1" }, null), null);
});
