import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { type IncomingMessage, type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type AgentActions, Outbox, agentPath, forgetAnswered, fromPage, handleAgent, permission } from "./agents.ts";
import type { HookEvent } from "./hooks.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "outbox-")), "outbox.json");
const none = async () => {};
const yes = async () => true;

test("holds messages until the agent is idle, then sends them as one", async () => {
  const sent: [string, string][] = [];
  const outbox = new Outbox(file(), async (p, t) => void sent.push([p, t]), yes);
  outbox.add("w1:p1", "first");
  outbox.add("w1:p1", "second");
  for (const status of ["working", "blocked", "unknown"]) assert.equal(await outbox.deliver({ "w1:p1": status }), false);
  assert.equal(await outbox.deliver({}), false);
  assert.deepEqual(sent, []);
  assert.equal(await outbox.deliver({ "w1:p1": "idle" }), true);
  assert.deepEqual(sent, [["w1:p1", "first\n\nsecond"]]);
  assert.deepEqual(outbox.queued("w1:p1"), []);
});

test("keeps messages when sending fails, and across restarts", async () => {
  const path = file();
  const failing = new Outbox(path, async () => {
    throw new Error("gone");
  }, yes);
  failing.add("w1:p1", "hello");
  assert.equal(await failing.deliver({ "w1:p1": "done" }), false);
  assert.equal(new Outbox(path, none, yes).queued("w1:p1")[0].text, "hello");
});

test("sends a message once, and keeps one that arrives meanwhile", async () => {
  let release = () => {};
  const sent: string[] = [];
  const outbox = new Outbox(file(), (_, t) => {
    sent.push(t);
    return new Promise<void>((r) => (release = r));
  }, yes);
  outbox.add("w1:p1", "first");
  const [{ id }] = outbox.queued("w1:p1");
  const sending = outbox.deliver({ "w1:p1": "idle" });
  await outbox.deliver({ "w1:p1": "idle" });
  outbox.add("w1:p1", "second");
  // It may already have reached the agent.
  assert.equal(outbox.cancel("w1:p1", id), false);
  release();
  await sending;
  assert.deepEqual(sent, ["first"]);
  assert.deepEqual(outbox.queued("w1:p1").map((m) => m.text), ["second"]);
});

test("holds messages when the pane turns out not to be ready", async () => {
  const sent: string[] = [];
  let ready = false;
  const outbox = new Outbox(file(), async (_, t) => void sent.push(t), async () => ready);
  outbox.add("w1:p1", "hello");
  assert.equal(await outbox.deliver({ "w1:p1": "idle" }), false);
  assert.equal(outbox.queued("w1:p1").length, 1);
  ready = true;
  assert.equal(await outbox.deliver({ "w1:p1": "idle" }), true);
  assert.deepEqual(sent, ["hello"]);
});

test("cancels a waiting message", () => {
  const outbox = new Outbox(file(), none, yes);
  outbox.add("w1:p1", "hello");
  const [{ id }] = outbox.queued("w1:p1");
  assert.equal(outbox.cancel("w1:p1", "nope"), false);
  assert.equal(outbox.cancel("w1:p1", id), true);
  assert.deepEqual(outbox.queued("w1:p1"), []);
});

const asked: HookEvent = { agent: "claude", event: "PermissionRequest", session: "s", detail: "Bash: ls", at: 5 };

test("only a blocked agent that asked waits for permission", () => {
  assert.deepEqual(permission(asked, "blocked"), { detail: "Bash: ls", at: 5 });
  assert.equal(permission(asked, "working"), null);
  assert.equal(permission({ ...asked, event: "Notification" }, "blocked"), null);
  assert.equal(permission(undefined, "blocked"), null);
});

test("forgets a permission request once it is answered", () => {
  const latest = new Map([["w1:p1", asked], ["w1:p2", asked], ["w1:p3", { ...asked, event: "Stop" }]]);
  const before = { "w1:p1": "blocked", "w1:p2": "working", "w1:p3": "blocked" };
  forgetAnswered(latest, before, { "w1:p1": "working", "w1:p2": "blocked", "w1:p3": "idle" });
  assert.deepEqual([...latest.keys()], ["w1:p2", "w1:p3"]);
});

test("only the page itself passes as the page", () => {
  const hosts = new Set(["127.0.0.1:9000"]);
  const json = "application/json";
  assert.equal(fromPage({ origin: "http://127.0.0.1:9000", "content-type": json }, hosts), true);
  assert.equal(fromPage({ origin: "http://evil.example", "content-type": json }, hosts), false);
  assert.equal(fromPage({ origin: "http://127.0.0.1:9000", "content-type": "text/plain" }, hosts), false);
  assert.equal(fromPage({ "content-type": json }, hosts), false);
});

test("reads the pane and action from a path", () => {
  assert.deepEqual(agentPath("/api/agents/w1%3Ap1/messages"), { pane: "w1:p1", action: "messages" });
  assert.deepEqual(agentPath("/api/agents/w1%3Ap1/messages/7"), { pane: "w1:p1", action: "messages", id: "7" });
  assert.equal(agentPath("/api/agents/w1%3Ap1/nope"), null);
  assert.equal(agentPath("/api/agents/%E0%A4%A/focus"), null);
});

/** Serves handleAgent with actions, returning a function that sends a
 * request and returns its status. */
async function serve(t: { after: (f: () => void) => void }, actions: AgentActions) {
  const server: Server = createServer((req: IncomingMessage, res) => {
    handleAgent(req, res, agentPath(req.url!)!, actions);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  return async (method: string, path: string, body?: object) =>
    (await fetch(`http://127.0.0.1:${port}/api/agents/w1%3Ap1/${path}`, {
      method, body: body && JSON.stringify(body), headers: { Connection: "close" },
    })).status;
}

test("queues and cancels messages for known agents", async (t) => {
  const outbox = new Outbox(file(), none, yes);
  let changes = 0;
  const send = await serve(t, {
    outbox, known: (p) => p === "w1:p1", focus: none, changed: () => changes++,
  });
  assert.equal(await send("POST", "messages", { text: "  " }), 400);
  assert.equal(await send("POST", "messages", { text: " hi " }), 204);
  const [{ id, text }] = outbox.queued("w1:p1");
  assert.equal(text, "hi");
  assert.equal(await send("DELETE", `messages/${id}`), 204);
  assert.equal(await send("DELETE", `messages/${id}`), 404);
  assert.equal(changes, 2);
});

test("refuses agents it doesn't know", async (t) => {
  const send = await serve(t, {
    outbox: new Outbox(file(), none, yes), known: () => false, focus: none, changed: () => {},
  });
  assert.equal(await send("POST", "messages", { text: "hi" }), 404);
});

test("focuses a known agent's pane", async (t) => {
  const focused: string[] = [];
  const send = await serve(t, {
    outbox: new Outbox(file(), none, yes), known: () => true, focus: async (p) => void focused.push(p), changed: () => {},
  });
  assert.equal(await send("POST", "focus"), 204);
  assert.deepEqual(focused, ["w1:p1"]);
});
