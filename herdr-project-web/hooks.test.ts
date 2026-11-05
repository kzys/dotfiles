import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { type HookEvent, ancestors, hookPath, hookServer, listenOn, ownsPane } from "./hooks.ts";

const shim = join(import.meta.dirname, "../bin/agent-hook");

/** Starts a hook server on a socket under a new state directory. */
async function start(lineage = async (_: number): Promise<string[] | null> => ["claude"]) {
  const state = mkdtempSync(join(tmpdir(), "hk-"));
  const socketPath = join(state, "herdr-project/run/server.sock");
  const latest = new Map<string, HookEvent>();
  const server = hookServer(latest, lineage);
  await listenOn(server, socketPath);
  return { state, socketPath, latest, server };
}

/** Sends a request to the socket, returning its status and body. */
function send(socketPath: string, method: string, path: string, headers: object = {}, body = ""): Promise<[number, string]> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path, headers: headers as Record<string, string>, agent: false }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => resolve([res.statusCode!, text]));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const pane = { "X-Herdr-Pane": "w1:p1", "X-Agent-Pid": "1234" };

test("reads a hook's agent and event from its path", () => {
  assert.deepEqual(hookPath("/hooks/claude/SessionStart"), { agent: "claude", event: "SessionStart" });
  assert.equal(hookPath("/hooks/nobody/SessionStart"), null);
  assert.equal(hookPath("/hooks/claude"), null);
});

test("background sessions don't own their pane", () => {
  assert.equal(ownsPane(["sh agent-hook", "claude"]), true);
  assert.equal(ownsPane(["sh agent-hook", "claude --bg-pty-host 3"]), false);
});

test("a Claude started by another doesn't own the pane", () => {
  assert.equal(ownsPane(["sh agent-hook", "claude -p hi", "bash -c claude", "/usr/bin/claude --resume x", "zsh"]), false);
  // Only the program counts, not what its arguments mention.
  assert.equal(ownsPane(["sh agent-hook", "bash -c claude", "claude --add-dir /x/claude", "zsh"]), true);
});

test("ancestors that can't be read don't own the pane", async () => {
  assert.equal(ownsPane(null), false);
  // Past the highest pid Linux allows.
  assert.equal(await ancestors(1 << 23), null);
});

test("lists this process's ancestors, starting with itself", async () => {
  const commands = await ancestors(process.pid);
  assert.match(commands![0], /node/);
});

test("keeps each pane's last event", async (t) => {
  const { socketPath, latest, server } = await start();
  t.after(() => server.close());
  const body = JSON.stringify({ session_id: "s1" });
  assert.equal((await send(socketPath, "POST", "/hooks/claude/SessionStart", pane, body))[0], 204);
  assert.equal((await send(socketPath, "POST", "/hooks/claude/Stop", pane, body))[0], 204);
  assert.deepEqual(
    { ...latest.get("w1:p1"), at: 0 },
    { agent: "claude", event: "Stop", session: "s1", at: 0 },
  );
  const [status, listed] = await send(socketPath, "GET", "/hooks");
  assert.equal(status, 200);
  assert.equal(JSON.parse(listed)["w1:p1"].event, "Stop");
});

test("ignores subagents and processes outside the pane", async (t) => {
  const { socketPath, latest, server } = await start(async () => ["claude --bg-pty-host 3"]);
  t.after(() => server.close());
  await send(socketPath, "POST", "/hooks/claude/Stop", pane, "{}");
  assert.equal(latest.size, 0);

  const owned = await start();
  t.after(() => owned.server.close());
  await send(owned.socketPath, "POST", "/hooks/claude/Stop", pane, JSON.stringify({ agent_id: "a1" }));
  assert.equal(owned.latest.size, 0);
});

test("refuses what isn't a hook's event", async (t) => {
  const { socketPath, latest, server } = await start();
  t.after(() => server.close());
  assert.equal((await send(socketPath, "POST", "/hooks/claude/Stop", pane, "not json"))[0], 400);
  assert.equal((await send(socketPath, "POST", "/hooks/claude/Stop", pane, "x".repeat(2 << 20)))[0], 413);
  assert.equal((await send(socketPath, "POST", "/hooks/nobody/Stop", pane, "{}"))[0], 404);
  assert.equal(latest.size, 0);
});

test("only this user can reach the socket, and a stale one is replaced", async (t) => {
  const socketPath = join(mkdtempSync(join(tmpdir(), "hk-")), "run/server.sock");
  // Left behind by a run that didn't clean up, as loosely as it likes.
  mkdirSync(dirname(socketPath), { mode: 0o755 });
  writeFileSync(socketPath, "");
  const server = hookServer(new Map());
  t.after(() => server.close());
  await listenOn(server, socketPath);
  assert.equal(statSync(dirname(socketPath)).mode & 0o777, 0o700);
  assert.equal((await send(socketPath, "GET", "/hooks"))[0], 200);
});

test("the shim posts stdin as the pane's event", async (t) => {
  const { state, latest, server } = await start();
  t.after(() => server.close());
  const run = promisify(execFile)(shim, ["claude", "Stop"], {
    env: { ...process.env, XDG_STATE_HOME: state, HERDR_ENV: "1", HERDR_PANE_ID: "w2:p3" },
  });
  run.child.stdin!.end(JSON.stringify({ session_id: "s2" }));
  await run;
  assert.equal(latest.get("w2:p3")?.session, "s2");
});

test("the shim succeeds with the server down, and outside Herdr", async () => {
  const state = mkdtempSync(join(tmpdir(), "hk-"));
  const env = { ...process.env, XDG_STATE_HOME: state };
  for (const extra of [{ HERDR_ENV: "1", HERDR_PANE_ID: "w2:p3" }, { HERDR_ENV: "", HERDR_PANE_ID: "" }]) {
    const run = promisify(execFile)(shim, ["claude", "Stop"], { env: { ...env, ...extra } });
    run.child.stdin!.end("{}");
    await run;
  }
});
