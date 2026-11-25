import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { CoreFeed, applyEvent } from "./core.ts";

test("applies herdr-core's events to its terminals", () => {
  const terminals = new Map<string, any>();
  applyEvent(terminals, "created", "t1", { address: "t1", state: "live", title: "" });
  applyEvent(terminals, "title", "t1", { title: "work" });
  applyEvent(terminals, "status", "t1", { reported: true, status: { app: "claude-code", state: "working" } });
  applyEvent(terminals, "foreground", "t1", { pid: 2, name: "claude", argv: ["claude"], cwd: "/p" });
  applyEvent(terminals, "labels", "t2", { labels: {} }); // Not known: left out.
  assert.deepEqual([...terminals.values()], [{
    address: "t1", state: "live", title: "work", reported: true, status: { app: "claude-code", state: "working" },
    foreground: { pid: 2, name: "claude", argv: ["claude"], cwd: "/p" },
  }]);
  applyEvent(terminals, "lost", "t1", { reason: "signal" });
  assert.equal(terminals.get("t1").state, "live");
  // A status's state is not the terminal's.
  applyEvent(terminals, "turn", "t1", { turn: 2, state: "done" });
  assert.equal(terminals.get("t1").state, "live");
  assert.equal(terminals.get("t1").turn, 2);
  applyEvent(terminals, "finished", "t1", { exit_code: 0 });
  assert.equal(terminals.get("t1").state, "finished");
  applyEvent(terminals, "restarted", "t1", { address: "t1", state: "live", status: null });
  assert.equal(terminals.get("t1").state, "live");
  applyEvent(terminals, "finished", "t1", { exit_code: 0 });
  applyEvent(terminals, "removed", "t1", {});
  assert.equal(terminals.size, 0);
});

/** Returns a stand-in for hc connect, which records what it is sent. */
function fakeHc() {
  const child: any = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.sent = [] as any[];
  child.stdin.on("data", (d: Buffer) => child.sent.push(...d.toString().trim().split("\n").map((l) => JSON.parse(l))));
  child.kill = () => child.emit("exit");
  child.say = (message: object) => child.stdout.write(`${JSON.stringify(message)}\n`);
  return child;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("follows terminals and documents, and subscribes again when hc falls behind", async () => {
  const started: any[] = [];
  const seen: string[][] = [];
  const docs: string[] = [];
  let subscriptions = 0;
  const feed = new CoreFeed({
    terminals: (ts) => seen.push(ts.map((t) => `${t.address}:${t.title}`)),
    doc: (name) => docs.push(name),
    subscribed: () => subscriptions++,
    start: () => (started.push(fakeHc()), started.at(-1)),
    retryMs: 0,
  });
  const hc = started[0];
  await settle();
  assert.equal(hc.sent[0].method, "events.subscribe");
  hc.say({ jsonrpc: "2.0", id: 1, result: { terminals: [{ address: "t1", title: "a" }] } });
  hc.say({ jsonrpc: "2.0", method: "event", params: { type: "title", terminal: "t1", data: { title: "b" } } });
  hc.say({ jsonrpc: "2.0", method: "event", params: { type: "doc", data: { name: "herdr-app", version: 2 } } });
  hc.say({ jsonrpc: "2.0", method: "heartbeat", params: {} });
  await settle();
  assert.deepEqual(seen, [["t1:a"], ["t1:b"]]);
  assert.deepEqual(docs, ["herdr-app"]);
  assert.equal(subscriptions, 1);
  hc.say({ jsonrpc: "2.0", method: "missed", params: {} });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(started.length, 2);
  // The old one says nothing more that counts.
  hc.say({ jsonrpc: "2.0", method: "event", params: { type: "title", terminal: "t1", data: { title: "c" } } });
  await settle();
  assert.deepEqual(seen, [["t1:a"], ["t1:b"]]);
  feed.close();
});
