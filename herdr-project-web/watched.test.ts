import assert from "node:assert/strict";
import { test } from "node:test";
import type { Herdr } from "./state.ts";
import { title, watchWorkspace, withFound } from "./watched.ts";

test("puts the server's checks after the pull requests", () => {
  const panes = { title: "Panes", at: "2026-10-16T09:00:00.000Z", lines: ["a"] };
  const slack = { title: "Slack", at: "2026-10-16T09:01:00.000Z", lines: ["b"] };
  const item = { project: null, role: null, mark: "idle", text: "x" };
  const report = {
    sections: [{ title: "Pull requests", at: null, lines: [] }, { title: "Slack", at: null, lines: ["old"] },
               { title: "Other", at: null, lines: [] }],
    inbox: { Slack: [item, item], "Pull requests": [item] },
    at: "2026-10-16T10:00:00.000Z",
  };
  // Theirs replace the poller's, and one without a section shows none.
  assert.deepEqual(
    withFound(report, [
      { title: "Panes", section: panes, items: [item] },
      { title: "Slack", section: slack, items: [] },
      { title: "Linear", section: null, items: [] },
    ]),
    {
      sections: [report.sections[0], panes, slack, report.sections[2]],
      inbox: { Slack: [], "Pull requests": [item], Panes: [item], Linear: [] },
      at: report.at,
    },
  );
  // Before the poller reports, they stand alone.
  assert.deepEqual(withFound(null, [{ title: "Panes", section: panes, items: [] }]), {
    sections: [panes], inbox: { Panes: [] }, at: panes.at,
  });
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
