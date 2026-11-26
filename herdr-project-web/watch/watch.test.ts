import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "node:net";
import { answers, backgroundEnv, bindSockets, rememberWatcher, retryDelay, serverArgs, serverEnv, startWatcher, stateDirOf, watcherFile } from "./watch.ts";

const env = () => ({ HOME: "/home/me", XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "watch-")) });

/** Returns a stand-in for Herdr, answering from replies by subcommand. */
function herdr(replies: Record<string, (args: string[]) => unknown>) {
  const calls: string[][] = [];
  return { calls, run: (...args: string[]) => (calls.push(args), replies[args.slice(0, 2).join(" ")](args)) };
}

const list = (...labels: string[]) => () => ({ result: { workspaces: labels.map((label) => ({ label })) } });
const created = () => ({ result: { root_pane: { pane_id: "w9:p1" } } });

test("finds the state directory", () => {
  assert.equal(stateDirOf({ HOME: "/h" }), "/h/.local/state/herdr-project");
  assert.equal(stateDirOf({ HOME: "/h", XDG_STATE_HOME: "/s" }), "/s/herdr-project");
});

test("binds the socket, which stays when closed here once handed on", async () => {
  const path = join(env().XDG_STATE_HOME, "run/server.sock");
  // One left by an earlier run.
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
  const bound = await bindSockets(path);
  assert.ok(bound);
  assert.equal(await answers(path), true);
  await new Promise((resolve) => bound.socket.close(resolve));
  assert.ok(existsSync(path));
});

test("leaves the socket to a server already answering on it", async (t) => {
  const path = join(env().XDG_STATE_HOME, "server.sock");
  const running = createServer().listen(path);
  t.after(() => running.close());
  await new Promise((resolve) => running.once("listening", resolve));
  assert.equal(await bindSockets(path), null);
});

test("lets one of those starting together bind the socket", async (t) => {
  const path = join(env().XDG_STATE_HOME, "server.sock");
  const bound = await Promise.all([bindSockets(path, 0), bindSockets(path, 0)]);
  t.after(() => bound.forEach((b) => (b?.socket.close(), b?.page?.close())));
  assert.equal(bound.filter((b) => b).length, 1);
});

test("waits longer each time the server fails to start", () => {
  assert.deepEqual([1, 2, 3, 5, 9].map(retryDelay), [1000, 2000, 4000, 10_000, 10_000]);
});

test("starts the watcher in the background without its starter's pane", () => {
  assert.deepEqual(backgroundEnv({ HOME: "/h", HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1", WATCH_TTY: "/dev/pts/1" }), { HOME: "/h" });
});

test("remembers the watcher's arguments for its pane", () => {
  const e = env();
  rememberWatcher("w1:p1", ["org"], e);
  assert.equal(readFileSync(watcherFile("w1:p1", e), "utf8"), "org\n");
});

test("starts the watcher in a workspace of its own", () => {
  const e = env();
  const h = herdr({ "workspace list": list("other"), "workspace create": created });
  assert.equal(startWatcher(h.run, e), true);
  assert.ok(h.calls[1].includes("HERDR_PROJECT_WATCH=1"));
  assert.ok(existsSync(watcherFile("w9:p1", e)));
});

test("leaves a watcher that runs alone", () => {
  const e = env();
  assert.equal(startWatcher(herdr({ "workspace list": list("watch") }).run, e), false);
  rememberWatcher("w1:p1", [], e);
  const h = herdr({ "workspace list": list(), "pane get": () => ({}) });
  assert.equal(startWatcher(h.run, e), false);
  assert.ok(!h.calls.some((c) => c[1] === "create"));
});

test("forgets panes that are gone, but not on other failures", () => {
  const e = env();
  rememberWatcher("w1:p1", [], e);
  const gone = () => {
    throw new Error('{"code":"pane_not_found"}');
  };
  assert.equal(startWatcher(herdr({ "workspace list": list(), "pane get": gone, "workspace create": created }).run, e), true);
  assert.ok(!existsSync(watcherFile("w1:p1", e)));
  const other = env();
  rememberWatcher("w1:p1", [], other);
  const failing = () => {
    throw new Error("socket gone");
  };
  assert.throws(() => startWatcher(herdr({ "workspace list": list(), "pane get": failing }).run, other));
  assert.ok(existsSync(watcherFile("w1:p1", other)));
});

test("another shell starting the watcher leaves it to that shell", () => {
  const e = env();
  mkdirSync(stateDirOf(e), { recursive: true });
  writeFileSync(join(stateDirOf(e), "watcher.lock"), "");
  assert.equal(startWatcher(herdr({}).run, e), false);
});

test("runs the server as the watcher", () => {
  const web = mkdtempSync(join(tmpdir(), "web-"));
  assert.deepEqual(serverArgs(web).slice(-1), [join(web, "main.ts")]);
  assert.deepEqual(
    serverEnv({ A: "1" }, ["org"], "/dev/pts/1"),
    { A: "1", HERDR_PROJECT_ORGS: '["org"]', HERDR_PROJECT_TTY: "/dev/pts/1" },
  );
});
