import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appAgentFree, appHerdrPanes, appOpener, appPaneRecords, appPanes, appTerminals, claudeSessions, routerAddress, toRouter } from "./herdr-app.ts";
import { open } from "./rows.ts";

const terminal = (o: object) => ({
  address: "t1", state: "live", cwd: "/start", agent: "claude-code",
  labels: { "herdr.space": "sp1" }, foreground: { pid: 10, cwd: "/now" }, ...o,
});

test("reads Claude's session files by process", () => {
  const dir = mkdtempSync(join(tmpdir(), "app-"));
  writeFileSync(join(dir, "10.json"), JSON.stringify({ pid: 10, sessionId: "s1" }));
  writeFileSync(join(dir, "11.json"), JSON.stringify({ peerToken: "x" }));
  writeFileSync(join(dir, "12.json"), "not json");
  assert.deepEqual([...claudeSessions(dir)], [[10, "s1"]]);
  assert.deepEqual([...claudeSessions(join(dir, "missing"))], []);
});

test("reads the panes of the app's spaces", () => {
  const sessions = new Map([[10, "s1"]]);
  assert.deepEqual(appPaneRecords([
    terminal({}),
    terminal({ address: "t2", agent: undefined, foreground: { pid: 10 } }),
    terminal({ address: "t3", labels: {} }),
    terminal({ address: "t4", state: "exited" }),
  ], sessions), [
    { agent: "claude", workspace: "sp1", cwd: "/now", pane: "t1", session: "s1", role: "" },
    { agent: null, workspace: "sp1", cwd: "/start", pane: "t2", session: "", role: "" },
  ]);
});

test("reads the agents of the app's spaces as Herdr's panes", () => {
  const sessions = new Map([[10, "s1"]]);
  const labels = { "herdr.space": "sp1", "herdr.tab": "tb1" };
  assert.deepEqual(appHerdrPanes([
    terminal({ labels, status: { app: "claude-code", state: "idle" }, foreground: { pid: 10, cwd: "/p/a" } }),
    terminal({ address: "t2", labels, status: null }),
    terminal({ address: "t3", labels: {}, status: { app: "codex", state: "working" } }),
  ], sessions), [
    { pane_id: "t1", workspace_id: "sp1", tab_id: "tb1", cwd: "/p/a", agent: "claude", agent_status: "idle", agent_session: { value: "s1" } },
    { pane_id: "t2", workspace_id: "sp1", tab_id: "tb1", cwd: "/now", agent: null, agent_status: undefined, agent_session: null },
  ]);
});

test("tells when an app agent waits for its next message", () => {
  assert.equal(appAgentFree({ status: { state: "done" } }), true);
  assert.equal(appAgentFree({ status: { state: "working" } }), false);
  assert.equal(appAgentFree({ status: null }), false);
});

test("leaves out terminals that end while it reads them", async () => {
  const run = async (_command: string, args: string[]) => {
    if (args[0] === "ls") return { terminals: [{ address: "t1", agent: "claude-code" }, { address: "t2" }] };
    if (args[1] === "t2") throw new Error("gone");
    return terminal({ agent: undefined });
  };
  assert.deepEqual((await appPanes(run, new Map())).map((p) => [p.pane, p.agent]), [["t1", "claude"]]);
  // Asked for all of them, it can't say which is missing.
  await assert.rejects(appTerminals(run, true), { message: "gone" });
});

test("opens rows with the app's commands", async () => {
  const ran: [string, object][] = [];
  const opener = appOpener(async (name, args) => void ran.push([name, args]));
  await open({ focus: "t7" }, opener);
  await open({ workspace: "sp1", directory: "/p/a", command: "hp --agent claude" }, opener);
  await open({ workspace: null, directory: mkdtempSync(join(tmpdir(), "app-")), command: "hp" }, opener);
  assert.deepEqual(ran.slice(0, 2), [
    ["pane.focus", { terminal: "t7" }],
    ["tab.new", { space: "sp1", folder: "/p/a", argv: ["sh", "-c", "hp --agent claude"] }],
  ]);
  assert.equal(ran[2][0], "space.new");
  assert.deepEqual((ran[2][1] as any).argv, ["sh", "-c", "hp"]);
});

test("gives text to the router, or starts one", async () => {
  const router = { address: "t2", state: "live", labels: { role: "router" }, foreground: { argv: ["claude", "--x"] } };
  const terminals = [
    { address: "t1", state: "live", labels: { role: "router" }, foreground: { argv: ["zsh"] } },
    { ...router, state: "exited" },
    router,
  ];
  assert.equal(routerAddress(terminals), "t2");
  assert.equal(routerAddress([{ ...router, foreground: { argv: ["/home/me/bin/herdr-router"] } }]), "t2");
  const calls: unknown[][] = [];
  const send = async (...args: unknown[]) => void calls.push(["send", ...args]);
  const command = async (...args: unknown[]) => void calls.push(["command", ...args]);
  await toRouter("hello", terminals, send, command);
  await toRouter("hello", terminals.slice(0, 2), send, command);
  assert.deepEqual(calls, [
    ["send", "t2", "hello"],
    ["command", "space.new", { name: "ROUTER", folder: homedir(), argv: ["herdr-router"], task: "hello", machine: "" }],
  ]);
});
