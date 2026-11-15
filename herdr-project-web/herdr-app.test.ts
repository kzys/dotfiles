import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appOpener, appPaneRecords, appPanes, claudeSessions } from "./herdr-app.ts";
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

test("leaves out terminals that end while it reads them", async () => {
  const run = async (_command: string, args: string[]) => {
    if (args[0] === "ls") return { terminals: [{ address: "t1", agent: "claude-code" }, { address: "t2" }] };
    if (args[1] === "t2") throw new Error("gone");
    return terminal({ agent: undefined });
  };
  assert.deepEqual((await appPanes(run, new Map())).map((p) => [p.pane, p.agent]), [["t1", "claude"]]);
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
