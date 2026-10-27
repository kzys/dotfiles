import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type PaneHerdr, checkPanes, ctx, projectDir, title, wakeMessage, watchWorkspace, withPanes } from "./panes.ts";
import type { Herdr } from "./state.ts";

type HerdrPane = Herdr["panes"][number];

function pane(pane_id: string, tab: string, more: Partial<HerdrPane> = {}, tokens: Record<string, string> = {}): HerdrPane {
  return { pane_id, workspace_id: "w", tab_id: tab, agent: null, agent_status: "unknown", cwd: "/h", tokens, ...more };
}

/** Returns a stand-in for Herdr listing listed, with texts by pane id,
 * and the calls it gets, as [command, pane id] pairs. run fails if
 * failRun is set. */
function fakeHerdr(listed: HerdrPane[], texts: Record<string, string> = {}, failRun = false) {
  const calls: string[][] = [];
  const herdr: PaneHerdr = {
    list: async () => {
      calls.push(["list"]);
      return listed;
    },
    read: async (id) => {
      if (!(id in texts)) throw new Error(`no ${id}`);
      return texts[id];
    },
    run: async (id, text) => {
      calls.push(["run", id, text]);
      if (failRun) throw new Error("herdr failed");
    },
  };
  return { herdr, calls };
}

const tmp = () => mkdtempSync(join(tmpdir(), "panes-"));
const day = 24 * 3600_000;
const hour = 3600_000;

test("checks panes", async () => {
  const dir = tmp();
  const root = join(dir, "project");
  const project = join(root, "20261016-a");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "---\nname: alpha\n---\n");
  const listed = [
    pane("w1:p1", "w1:t1", { agent: "claude", agent_status: "working", cwd: project }, { ctx: "85%", role: "main" }),
    pane("w1:p2", "w1:t1", { cwd: project }), // Follows the agent's notes.
    pane("w2:p1", "w2:t1"),
    pane("w3:p1", "w3:t1", { cwd: project }),
  ];
  const texts: Record<string, string> = { "w2:p1": "$ ls", "w3:p1": "$ make" };
  const { herdr, calls } = fakeHerdr(listed, texts);
  const state = join(dir, "state/panes.json");
  const start = Date.UTC(2026, 9, 16, 9);
  const check = (after: number) => checkPanes(herdr, root, state, new Date(start + after));

  let { lines, items } = await check(0);
  assert.deepEqual(lines, [" 85% w1:p1    alpha"]);
  assert.deepEqual(items, [
    { project, role: "main", mark: "ctx", text: "alpha: context 85% full, restart it from its notes" },
  ]);
  // A working agent isn't interrupted.
  assert.deepEqual(calls, [["list"]]);

  listed[0].agent_status = "idle";
  calls.length = 0;
  ({ lines, items } = await check(day + 2 * hour));
  assert.deepEqual(lines, [" 85% w1:p1    alpha", "  1d w2:p1    /h", "  1d w3:p1    alpha"]);
  // Only idle panes in projects go to the inbox.
  assert.deepEqual(items.slice(1), [
    { project, role: null, mark: "idle", text: "shell pane w3:p1 idle for 1d" },
  ]);
  assert.deepEqual(calls, [["list"], ["run", "w1:p1", wakeMessage(listed[0])]]);

  // The agent is told once, even while its ctx is unknown, and again
  // only after its context empties.
  calls.length = 0;
  delete listed[0].tokens!.ctx;
  await check(day + 3 * hour);
  listed[0].tokens!.ctx = "85%";
  await check(day + 4 * hour);
  assert.deepEqual(calls, [["list"], ["list"]]);
  listed[0].tokens!.ctx = "10%";
  await check(day + 5 * hour);
  listed[0].tokens!.ctx = "90%";
  calls.length = 0;
  await check(day + 6 * hour);
  assert.deepEqual(calls[1].slice(0, 2), ["run", "w1:p1"]);

  // New text restarts the idle clock.
  texts["w2:p1"] = "$ ls\nREADME.md";
  ({ lines } = await check(day + 7 * hour));
  assert.deepEqual(lines, [" 90% w1:p1    alpha", "  1d w3:p1    alpha"]);
  assert.deepEqual(JSON.parse(readFileSync(state, "utf8")).told, ["w1:p1"]);
});

test("tells only idle or done agents in projects", async () => {
  const dir = tmp();
  mkdirSync(join(dir, "a"));
  for (const [status, cwd, told] of [
    ["idle", "a", true], ["done", "a", true], ["idle", "", false],
    ["working", "a", false], ["blocked", "a", false], ["unknown", "a", false],
  ] as const) {
    const { herdr, calls } = fakeHerdr([
      pane("w1:p1", "t", { agent: "claude", agent_status: status, cwd: join(dir, cwd) }, { ctx: "90%" }),
    ]);
    const { items } = await checkPanes(herdr, dir, join(dir, `${status}${cwd}.json`), new Date());
    assert.equal(calls.length === 2, told, `${status} ${cwd}`);
    assert.equal(items.length, cwd ? 1 : 0);
  }
});

test("ignores background sessions' ctx", async () => {
  const dir = tmp();
  const { herdr, calls } = fakeHerdr([
    pane("w1:p1", "t", { agent: "claude", agent_status: "idle" }, { ctx: "95%", bg: "bg" }),
  ]);
  const { lines, items } = await checkPanes(herdr, dir, join(dir, "panes.json"), new Date());
  assert.deepEqual([lines, items, calls], [["Nothing to clean up."], [], [["list"]]]);
});

test("keeps going when an agent can't be told", async () => {
  const dir = tmp();
  mkdirSync(join(dir, "a"));
  const { herdr } = fakeHerdr(
    [pane("w1:p1", "t", { agent: "claude", agent_status: "done", cwd: join(dir, "a") }, { ctx: "99%" })],
    {},
    true,
  );
  const state = join(dir, "panes.json");
  const { lines } = await checkPanes(herdr, dir, state, new Date());
  assert.deepEqual(lines, [" 99% w1:p1    a"]);
  assert.deepEqual(JSON.parse(readFileSync(state, "utf8")).told, []);
});

test("starts over from bad state, and from what the Python watcher kept", async () => {
  const dir = tmp();
  const state = join(dir, "panes.json");
  writeFileSync(state, '{"panes": [], "told": 5}');
  const { herdr } = fakeHerdr([pane("w1:p1", "t")], { "w1:p1": "" });
  assert.deepEqual((await checkPanes(herdr, dir, state, new Date())).lines, ["Nothing to clean up."]);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(state, "utf8")).panes), ["w1:p1"]);

  // Its times have microseconds and an offset.
  const kept = JSON.parse(readFileSync(state, "utf8"));
  kept.panes["w1:p1"].since = "2026-10-14T09:00:00.123456-07:00";
  writeFileSync(state, JSON.stringify(kept));
  const { lines } = await checkPanes(herdr, dir, state, new Date("2026-10-16T16:00:01Z"));
  assert.deepEqual(lines, ["  2d w1:p1    /h"]);
});

test("finds the project a pane works in", () => {
  const dir = tmp();
  mkdirSync(join(dir, "real/20261016-a"), { recursive: true });
  mkdirSync(join(dir, "real/..notes"));
  symlinkSync(join(dir, "real"), join(dir, "project"));
  const root = join(dir, "project");
  assert.equal(projectDir(join(dir, "real/20261016-a/wt"), root), join(root, "20261016-a"));
  // Through the link, even where the worktree is gone.
  assert.equal(projectDir(join(root, "20261016-a/gone/deeper"), root), join(root, "20261016-a"));
  assert.equal(projectDir(join(root, "..notes"), root), join(root, "..notes"));
  assert.equal(projectDir(root, root), null);
  assert.equal(projectDir(dir, root), null);
  assert.equal(projectDir("", root), null);
});

test("reads ctx", () => {
  assert.equal(ctx(pane("p", "t", {}, { ctx: "17%" })), 17);
  assert.equal(ctx(pane("p", "t", {}, { ctx: "17%", bg: "bg" })), null);
  assert.equal(ctx(pane("p", "t", {}, { ctx: "x" })), null);
  assert.equal(ctx(pane("p", "t", {}, { ctx: "85.5%" })), null);
  assert.equal(ctx({ pane_id: "p", workspace_id: "w" }), null);
});

test("puts the panes after the pull requests", () => {
  const section = { title: "Panes", at: "2026-10-16T09:00:00.000Z", lines: ["a"] };
  const item = { project: null, role: null, mark: "idle", text: "x" };
  const report = {
    sections: [{ title: "Pull requests", at: null, lines: [] }, { title: "Slack", at: null, lines: [] }],
    inbox: { Slack: [item] },
    at: "2026-10-16T10:00:00.000Z",
  };
  assert.deepEqual(withPanes(report, section, [item]), {
    sections: [report.sections[0], section, report.sections[1]],
    inbox: { Slack: [item], Panes: [item] },
    at: report.at,
  });
  // Before the poller reports, the panes stand alone.
  assert.deepEqual(withPanes(null, section, []), { sections: [section], inbox: { Panes: [] }, at: section.at });
});

test("titles the watch workspace", () => {
  assert.equal(title({ "Pull requests": [{}, {}], Panes: [], Slack: [{}] }), "Pull requests: 2 · Slack: 1");
  assert.equal(title({ Panes: [], x: "junk" }), "Nothing waiting");
  assert.equal(title(null), "Nothing waiting");

  const herdr: Herdr = {
    workspaces: [{ workspace_id: "w1", label: "watch" }, { workspace_id: "w2", label: "proj" }],
    panes: [],
  };
  assert.equal(watchWorkspace({ HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1" }, herdr), "w1");
  assert.equal(watchWorkspace({ HERDR_PANE_ID: "w2:p1", HERDR_WORKSPACE_ID: "w2" }, herdr), null);
  assert.equal(watchWorkspace({ HERDR_WORKSPACE_ID: "w1" }, herdr), null);
  assert.equal(watchWorkspace({ HERDR_PANE_ID: "w1:p1" }, herdr), null);
  assert.equal(watchWorkspace({ HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1" }, null), null);
});
