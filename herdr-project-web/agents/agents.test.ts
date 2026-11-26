import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { type AgentActions, Outbox, forgetAnswered, fromPage, permission, routeAgents, undelivered } from "./agents.ts";
import type { HookEvent } from "./hooks.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "outbox-")), "outbox.json");
const none = async () => {};
const yes = async () => "";

test("holds messages while the agent is blocked, then sends them as one", async () => {
  const sent: [string, string][] = [];
  const outbox = new Outbox(file(), async (p, t) => void sent.push([p, t]), yes);
  outbox.add("w1:p1", "first");
  outbox.add("w1:p1", "second");
  for (const status of ["blocked", "unknown"]) assert.equal(await outbox.deliver({ "w1:p1": status }), false);
  assert.equal(await outbox.deliver({}), false);
  assert.deepEqual(sent, []);
  // Only Claude Code takes what is typed while it works.
  assert.equal(await outbox.deliver({ "w1:p1": "working" }, { "w1:p1": "codex" }), false);
  assert.equal(await outbox.deliver({ "w1:p1": "working" }, { "w1:p1": "claude" }), true);
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
  let ready: string | null = null;
  const outbox = new Outbox(file(), async (_, t) => void sent.push(t), async () => ready);
  outbox.add("w1:p1", "hello");
  assert.equal(await outbox.deliver({ "w1:p1": "idle" }), false);
  assert.equal(outbox.queued("w1:p1").length, 1);
  ready = "";
  assert.equal(await outbox.deliver({ "w1:p1": "idle" }), true);
  assert.deepEqual(sent, ["hello"]);
});

test("sends only what is for the session in the pane", async () => {
  const sent: string[] = [];
  const outbox = new Outbox(file(), async (_, t) => void sent.push(t), async () => "s2");
  outbox.add("w1:p1", "for the old one", "s1");
  outbox.add("w1:p1", "for this one", "s2");
  outbox.add("w1:p1", "for anyone");
  assert.equal(await outbox.deliver({ "w1:p1": "idle" }), true);
  assert.deepEqual(sent, ["for this one\n\nfor anyone"]);
  assert.deepEqual(outbox.queued("w1:p1").map((m) => m.text), ["for the old one"]);
  assert.equal(await outbox.deliver({ "w1:p1": "idle" }), false);
  assert.equal(sent.length, 1);
});

test("nothing delivers messages to a pane without their agent", () => {
  const m = (id: string, session?: string) => ({ id, text: id, at: 0, ...(session ? { session } : {}) });
  const queued = { gone: [m("a")], same: [m("b", "s1")], other: [m("c", "s1"), m("d")], unknown: [m("e", "s1")] };
  assert.deepEqual(undelivered(queued, { same: "s1", other: "s2", unknown: "" }), [
    { pane: "gone", messages: [m("a")] }, { pane: "other", messages: [m("c", "s1")] },
  ]);
});

test("lists the panes with messages waiting", () => {
  const outbox = new Outbox(file(), none, yes);
  outbox.add("w1:p1", "hello");
  assert.deepEqual(Object.keys(outbox.all()), ["w1:p1"]);
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
  const kept = forgetAnswered(latest, before, { "w1:p1": "working", "w1:p2": "blocked", "w1:p3": "idle" });
  assert.deepEqual([...kept.keys()], ["w1:p2", "w1:p3"]);
  assert.equal(latest.size, 3);
});

test("only the page itself passes as the page", () => {
  const hosts = new Set(["127.0.0.1:9000"]);
  const json = "application/json";
  assert.equal(fromPage(new Headers({ origin: "http://127.0.0.1:9000", "content-type": json }), hosts), true);
  assert.equal(fromPage(new Headers({ origin: "http://evil.example", "content-type": json }), hosts), false);
  assert.equal(fromPage(new Headers({ origin: "http://127.0.0.1:9000", "content-type": "text/plain" }), hosts), false);
  assert.equal(fromPage(new Headers({ "content-type": json }), hosts), false);
});

/** Routes agents' actions with actions, returning a function that sends
 * a request for path under /api/agents/ and returns its status. */
function serve(actions: AgentActions, allowed?: () => boolean) {
  const app = new Hono();
  routeAgents(app, actions, allowed);
  return async (method: string, path: string, body?: object) =>
    (await app.request(`/api/agents/${path}`, { method, body: body && JSON.stringify(body) })).status;
}

test("queues and cancels messages for known agents", async () => {
  const outbox = new Outbox(file(), none, yes);
  let changes = 0;
  outbox.subscribe(() => changes++);
  const before = outbox.all();
  const send = serve({ outbox, known: (p) => p === "w1:p1", session: () => "s1", focus: none });
  assert.equal(await send("POST", "w1%3Ap1/messages", { text: "  " }), 400);
  assert.equal(await send("POST", "w1%3Ap1/messages", { text: " hi " }), 204);
  const [{ id, text }] = outbox.queued("w1:p1");
  assert.equal(text, "hi");
  assert.equal(outbox.queued("w1:p1")[0].session, "s1");
  assert.equal(await send("DELETE", `w1%3Ap1/messages/${id}`), 204);
  assert.equal(await send("DELETE", `w1%3Ap1/messages/${id}`), 404);
  assert.equal(changes, 2);
  // Each change is a new object, so that what holds the last one sees it.
  assert.notEqual(outbox.all(), before);
});

test("routes only an agent's actions, and only those allowed", async () => {
  const actions = { outbox: new Outbox(file(), none, yes), known: (p: string) => p === "w1:p1", session: () => undefined, focus: none };
  const send = serve(actions);
  assert.equal(await send("POST", "w1%3Ap1/nope"), 404);
  assert.equal(await send("GET", "w1%3Ap1/focus"), 404);
  assert.equal(await send("POST", "%E0%A4%A/focus"), 404);
  assert.equal(await serve(actions, () => false)("POST", "w1%3Ap1/focus"), 403);
});

test("refuses agents it doesn't know", async () => {
  const send = serve({
    outbox: new Outbox(file(), none, yes), known: () => false, session: () => undefined, focus: none
  });
  assert.equal(await send("POST", "w1%3Ap1/messages", { text: "hi" }), 404);
});

test("focuses a known agent's pane", async () => {
  const focused: string[] = [];
  const send = serve({
    outbox: new Outbox(file(), none, yes), known: () => true, session: () => undefined, focus: async (p) => void focused.push(p)
  });
  assert.equal(await send("POST", "w1%3Ap1/focus"), 204);
  assert.deepEqual(focused, ["w1:p1"]);
});
