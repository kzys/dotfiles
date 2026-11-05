import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rememberWatcher, serverArgs, serverEnv, startWatcher, stateDirOf, watcherFile } from "./watch.ts";

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

test("runs the server as the watcher, restarted by its stamp", () => {
  const web = mkdtempSync(join(tmpdir(), "web-"));
  assert.deepEqual(serverArgs(web).slice(-1), [join(web, "main.ts")]);
  assert.ok(existsSync(join(web, "restart.stamp")));
  assert.deepEqual(
    serverEnv({ A: "1" }, ["org"], "/dev/pts/1"),
    { A: "1", HERDR_PROJECT_ORGS: '["org"]', HERDR_PROJECT_TTY: "/dev/pts/1" },
  );
});
