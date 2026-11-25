import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Asks, askMessage, askViews, askees, summarizeAll } from "./ask.ts";

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
  asks.ask("second", [{ pane: "w1:p1", label: "a" }, { pane: "w1:p2", label: "b" }, { pane: "w1:p3", label: "c" },
                       { pane: "w1:p4", label: "d" }], queue, 2);
  asks.all()[1].agents[2].reply = { text: "done", at: 3 };
  const queued = { "w1:p1": [{ id: "m2", text: "", at: 2 }], "w1:p2": [{ id: "m3", text: "", at: 2 }], "w1:p4": [{ id: "m5", text: "", at: 2 }] };
  // w1:p2 closed with its question queued, and w1:p4's is for a session it no longer runs.
  const views = askViews(asks.all(), queued, new Set(["m5"]), (pane) => pane !== "w1:p2");
  // Newest first.
  assert.deepEqual(views.map((v) => [v.text, v.agents.map((a) => [a.label, a.status])]), [
    ["second", [["a", "queued"], ["b", "gone"], ["c", "replied"], ["d", "gone"]]],
    ["first", [["a", "asked"]]],
  ]);
  assert.notEqual(asks.all()[0].id, asks.all()[1].id);
});

test("names each agent after its project and role", () => {
  const herdr = {
    workspaces: [],
    panes: [
      { pane_id: "w1:p1", workspace_id: "w1", cwd: "/p/a", agent: "claude", agent_status: "idle", agent_session: { value: "s1" },
        tokens: { role: "main" } },
      { pane_id: "w1:p2", workspace_id: "w1", cwd: "/home/x/repos/r", agent: "codex", agent_status: "working" },
      { pane_id: "w1:p3", workspace_id: "w1", cwd: "/p/a" },
      // Without a status, the outbox would never deliver to it.
      { pane_id: "w1:p4", workspace_id: "w1", cwd: "/p/a", agent: "claude" },
    ],
  };
  assert.deepEqual(askees(herdr, [{ name: "alpha", panes: [{ id: "w1:p1" }] }]), [
    { pane: "w1:p1", label: "alpha · main", session: "s1" },
    { pane: "w1:p2", label: "r · w1:p2" },
  ]);
  assert.deepEqual(askees(null, []), []);
});

test("makes one answer from the replies, again when more come", async () => {
  const asks = new Asks(path(), () => `t${Math.random()}`);
  let n = 0;
  asks.ask("Waiting on?", [{ pane: "w1:p1", label: "a · main" }, { pane: "w1:p2", label: "b · main" }], () => `m${++n}`, 1);
  const [first, second] = asks.all()[0].agents;
  const prompts: string[] = [];
  let made = 0;
  const answer = async (prompt: string) => (prompts.push(prompt), `answer ${prompts.length}`);
  // Nothing to make an answer from yet.
  await summarizeAll(asks, answer, () => made++);
  assert.deepEqual([prompts, made], [[], 0]);

  asks.reply(first.token, "CI on #12", 2);
  await summarizeAll(asks, answer, () => made++);
  assert.match(prompts[0], /Waiting on\?/);
  assert.match(prompts[0], /a · main:\nCI on #12/);
  assert.equal(made, 1);
  assert.deepEqual(asks.all()[0].summary?.text, "answer 1");
  // Made already from every reply there is.
  await summarizeAll(asks, answer, () => made++);
  assert.equal(prompts.length, 1);

  asks.reply(second.token, "nothing", 3);
  let view = askViews(asks.all(), {}, new Set(), () => true)[0];
  assert.deepEqual([view.summary?.replies, view.stale], [1, true]);
  await summarizeAll(asks, answer, () => made++);
  assert.match(prompts[1], /b · main:\nnothing/);
  view = askViews(asks.all(), {}, new Set(), () => true)[0];
  assert.deepEqual([view.summary?.text, view.summary?.replies, view.stale], ["answer 2", 2, false]);
  // One made from fewer replies, finishing late, doesn't replace it.
  asks.summarize(asks.all()[0].id, "late", 1);
  assert.equal(asks.all()[0].summary?.text, "answer 2");
});
