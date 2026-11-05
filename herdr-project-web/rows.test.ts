import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type OpenHerdr, type PaneRecord, type PlanDeps, choices, inboxChoices, notes, open, paneRecords, plan, rowNotes, workspacesToName,
} from "./rows.ts";
import { transcriptDir } from "./sessions.ts";
import type { State } from "./state.ts";

const temp = () => mkdtempSync(join(tmpdir(), "rows-"));
const pane = (o: Partial<PaneRecord>): PaneRecord => ({ agent: "claude", workspace: "w1", cwd: "/x", pane: "w1:p1", session: "", role: "", ...o });

function project(root: string, name: string, front = "") {
  const dir = join(root, name);
  mkdirSync(dir);
  if (front !== null) writeFileSync(join(dir, "README.md"), `---\n${front}---\n`);
  return dir;
}

function transcript(home: string, dir: string, id: string, text: string) {
  mkdirSync(transcriptDir(dir, home), { recursive: true });
  writeFileSync(join(transcriptDir(dir, home), `${id}.jsonl`), text);
}

test("reads Herdr's panes", () => {
  assert.deepEqual(paneRecords({ workspaces: [], panes: [{
    pane_id: "w1:p1", workspace_id: "w1", cwd: "/x", agent: "claude", agent_session: { value: "s" }, tokens: { role: "main" },
  }] }), [{ agent: "claude", workspace: "w1", cwd: "/x", pane: "w1:p1", session: "s", role: "main" }]);
  assert.deepEqual(paneRecords(null), []);
});

test("lists running projects first, then open ones, newest first, with their sessions", () => {
  const home = temp();
  const root = temp();
  project(root, "20260101-a", "title: Old\n");
  const closed = project(root, "20260301-c", "title: Done\nclosed: x\n");
  const busy = project(root, "20260102-b", "title: Busy\n");
  transcript(home, busy, "s1", `${JSON.stringify({ type: "ai-title", aiTitle: "Work" })}\n`);
  writeFileSync(join(busy, "claude-s1.json"), '{"used_percentage": 12.7}');
  const rows = choices([pane({ cwd: join(busy, "sub"), session: "s1" })], root, [
    { id: "c1", cwd: busy, updated_at: 1, title: "Codex  work" },
  ], home);
  assert.deepEqual(rows.map((r) => r[0]), ["new", "project", "session", "session", "project", "project"]);
  assert.match(rows[1][3], /^20260102-b {2}Busy$/);
  assert.equal(rows[2][2], "claude:s1");
  assert.match(rows[2][3], /^ {2}● claude +\d\d-\d\d \d\d:\d\d +12% {2}Work$/);
  assert.match(rows[3][3], /codex .*Codex work$/);
  assert.match(rows[4][3], /Old$/);
  assert.equal(rows[5][1], closed);
  assert.match(rows[5][3], /Done \(closed\)$/);
});

test("says when a project has no notes or title", () => {
  const root = temp();
  mkdirSync(join(root, "bare"));
  project(root, "untitled");
  mkdirSync(join(root, ".hidden"));
  const rows = choices([], root, [], temp());
  assert.deepEqual(rows.slice(1).map((r) => r[3]), ["untitled  (no title)", "bare  (no notes)"]);
});

const report = (role: string) => `${JSON.stringify({ message: { content: [{
  type: "tool_use", input: { command: `herdr pane report-metadata "$HERDR_PANE_ID" --source x --token role=${role}` },
}] } })}\n`;

test("lists what waits on the user with the session it belongs to", () => {
  const home = temp();
  const dir = join(temp(), "20260101-a");
  mkdirSync(dir);
  transcript(home, dir, "s1", report("main"));
  transcript(home, dir, "s2", report("other"));
  const state = {
    projects: [
      { dir, title: "T", items: [{ mark: "you", role: "main", text: "decide" }, { mark: "?", role: "gone", text: "maybe" }] },
      { dir: "/quiet", title: "Q", items: [] },
    ],
    unowned: [{ mark: "pr", role: null, text: "fix" }],
  } as unknown as State;
  const rows = inboxChoices([pane({ cwd: dir, session: "s2", role: "other" })], [], state, home);
  assert.equal(rows.length, 4);
  assert.equal(rows[1][2], "claude:s1");
  assert.match(rows[1][3], /^ {4}claude +you +decide$/);
  assert.deepEqual(rows[3], ["new", "", "", "+ pr     fix"]);
});

test("shows a session's role's notes, or all of them", () => {
  const home = temp();
  const dir = temp();
  writeFileSync(join(dir, "README.md"), "readme\n");
  writeFileSync(join(dir, "AGENT-a.md"), "a\n");
  writeFileSync(join(dir, "AGENT-main.md"), "main\n");
  transcript(home, dir, "s1", report("main"));
  assert.equal(notes(dir), "readme\na\nmain\n");
  assert.equal(notes(dir, "none"), "readme\na\nmain\n");
  assert.equal(notes(""), "");
  assert.equal(rowNotes("session", dir, "claude:s1", home), "main\n");
  assert.equal(rowNotes("project", dir, "", home), "readme\na\nmain\n");
});

const deps = (over: Partial<PlanDeps> = {}): PlanDeps => ({
  background: async () => null, stop: async () => true, now: () => new Date(2026, 10, 4), ...over,
});

test("focuses a running session", async () => {
  const panes = [pane({ session: "s1", pane: "w2:p3" })];
  assert.deepEqual(await plan(["session", "/p", "claude:s1", ""], "codex", panes, "/projects", "/b/hp", deps()), { focus: "w2:p3" });
});

test("resumes a saved session with its own agent, in its project's workspace", async () => {
  const panes = [pane({ cwd: "/p/sub", workspace: "w9" })];
  assert.deepEqual(await plan(["session", "/p", "codex:s1", ""], "claude", panes, "/projects", "/b/hp", deps()), {
    workspace: "w9", directory: "/p", command: "'/b/hp' --agent 'codex' --resume 's1'",
  });
});

test("starts the selected agent in a project, or a new one", async () => {
  assert.deepEqual(await plan(["project", "/p", "", ""], "opencode", [], "/projects", "/b/hp", deps()), {
    workspace: null, directory: "/p", command: "'/b/hp' --agent 'opencode'",
  });
  const root = temp();
  const made = await plan(["new", "", "", ""], "claude", [], root, "/b/hp", deps());
  assert.ok(made && "directory" in made && made.directory.startsWith(`${root}/20261104-`));
});

test("takes over a background session: resuming an idle one, attaching otherwise", async () => {
  const row = ["session", "/p", "claude:s1", ""] as [string, string, string, string];
  const stopped: string[] = [];
  const idle = deps({ background: async () => ["b1", "idle"], stop: async (id) => (stopped.push(id), true) });
  assert.match((await plan(row, "claude", [], "/x", "/b/hp", idle) as { command: string }).command, /--resume 's1'$/);
  assert.deepEqual(stopped, ["b1"]);
  const busy = deps({ background: async () => ["b1", "working"] });
  assert.equal((await plan(row, "claude", [], "/x", "/b/hp", busy) as { command: string }).command, "claude attach 'b1'");
  const stuck = deps({ background: async () => ["b1", "idle"], stop: async () => false });
  assert.equal((await plan(row, "claude", [], "/x", "/b/hp", stuck) as { command: string }).command, "claude attach 'b1'");
});

/** Returns a stand-in for Herdr recording what it was asked. */
function recorder() {
  const calls: unknown[][] = [];
  const herdr: OpenHerdr = {
    focus: async (p) => void calls.push(["focus", p]),
    tab: async (w, d) => (calls.push(["tab", w, d]), "w1:p9"),
    workspace: async (d, l) => (calls.push(["workspace", d, l]), { workspace: "w5", pane: "w5:p1" }),
    title: async (w, d) => void calls.push(["title", w, d]),
    run: async (p, c) => void calls.push(["run", p, c]),
  };
  return { calls, herdr };
}

test("names the workspaces of agents in projects with a name, once each", () => {
  const herdr = { workspaces: [], panes: [
    { pane_id: "w1:p1", workspace_id: "w1", agent: "opencode", cwd: "/project/a/sub" },
    { pane_id: "w1:p2", workspace_id: "w1", agent: "claude", cwd: "/x", tokens: { cwd: "/project/a" } },
    { pane_id: "w2:p1", workspace_id: "w2", agent: "claude", cwd: "/project/done" },
    { pane_id: "w3:p1", workspace_id: "w3", agent: "claude", cwd: "/project/unnamed" },
    { pane_id: "w4:p1", workspace_id: "w4", agent: null, cwd: "/project/shell" },
    { pane_id: "w5:p1", workspace_id: "w5", agent: "claude", cwd: "/elsewhere" },
  ] };
  const projectOf = (cwd: string) => /^\/project\/[^/]+/.exec(cwd)?.[0] ?? null;
  const nameOf = (dir: string) => (dir.endsWith("unnamed") ? "" : dir.split("/").pop()!);
  assert.deepEqual(workspacesToName(herdr, new Set(["/project/done"]), projectOf, nameOf), [
    { dir: "/project/a", workspace: "w1", name: "a" },
  ]);
});

test("opens a plan in a tab, or a workspace named for the project", async () => {
  const dir = project(temp(), "p", "name: short\n");
  const a = recorder();
  await open({ workspace: "w1", directory: dir, command: "hp" }, a.herdr);
  assert.deepEqual(a.calls, [["tab", "w1", dir], ["run", "w1:p9", "hp"]]);
  const b = recorder();
  await open({ workspace: null, directory: dir, command: "claude attach 'b1'" }, b.herdr);
  assert.deepEqual(b.calls, [["workspace", dir, "short"], ["title", "w5", dir], ["run", "w5:p1", "claude attach 'b1'"]]);
  const c = recorder();
  await open({ focus: "w2:p3" }, c.herdr);
  assert.deepEqual(c.calls, [["focus", "w2:p3"]]);
});
