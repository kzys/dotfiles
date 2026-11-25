import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Asks, askMessage, askViews, askees } from "./ask.ts";

const path = () => join(mkdtempSync(join(tmpdir(), "asks-")), "asks.json");

test("asks each agent with its own token, and keeps their replies", () => {
  const file = path();
  let n = 0;
  const asks = new Asks(file, () => `tok${++n}`);
  const queued: [string, string, string | undefined][] = [];
  const queue = (pane: string, text: string, session?: string) => (queued.push([pane, text, session]), `m${queued.length}`);
  asks.ask("What are you waiting on?", [{ pane: "w1:p1", label: "a · main", session: "s1" }, { pane: "t2", label: "b · t2" }], queue, 1000);
  assert.deepEqual(queued, [
    ["w1:p1", askMessage("What are you waiting on?", "tok1"), "s1"],
    ["t2", askMessage("What are you waiting on?", "tok2"), undefined],
  ]);
  assert.match(queued[0][1], /herdr-project --reply tok1 /);
  assert.equal(asks.reply("tok2", "CI on #12", 2000), true);
  assert.equal(asks.reply("nope", "x"), false);
  // Kept across restarts.
  const again = new Asks(file);
  assert.deepEqual(again.all()[0].agents.map((a) => [a.pane, a.message, a.reply]), [
    ["w1:p1", "m1", null], ["t2", "m2", { text: "CI on #12", at: 2000 }],
  ]);
});

test("says where each agent's question stands", () => {
  const asks = new Asks(path(), () => "t");
  let n = 0;
  const queue = () => `m${++n}`;
  asks.ask("first", [{ pane: "w1:p1", label: "a" }], queue, 1);
  asks.ask("second", [{ pane: "w1:p1", label: "a" }, { pane: "w1:p2", label: "b" }, { pane: "w1:p3", label: "c" }], queue, 2);
  asks.all()[1].agents[2].reply = { text: "done", at: 3 };
  const views = askViews(asks.all(), { "w1:p1": [{ id: "m2", text: "", at: 2 }] }, (pane) => pane !== "w1:p2");
  // Newest first.
  assert.deepEqual(views.map((v) => [v.text, v.agents.map((a) => [a.label, a.status])]), [
    ["second", [["a", "queued"], ["b", "gone"], ["c", "replied"]]],
    ["first", [["a", "asked"]]],
  ]);
});

test("names each agent after its project and role", () => {
  const herdr = {
    workspaces: [],
    panes: [
      { pane_id: "w1:p1", workspace_id: "w1", cwd: "/p/a", agent: "claude", agent_session: { value: "s1" }, tokens: { role: "main" } },
      { pane_id: "w1:p2", workspace_id: "w1", cwd: "/home/x/repos/r", agent: "codex" },
      { pane_id: "w1:p3", workspace_id: "w1", cwd: "/p/a" },
    ],
  };
  assert.deepEqual(askees(herdr, [{ name: "alpha", panes: [{ id: "w1:p1" }] }]), [
    { pane: "w1:p1", label: "alpha · main", session: "s1" },
    { pane: "w1:p2", label: "r · w1:p2" },
  ]);
  assert.deepEqual(askees(null, []), []);
});
