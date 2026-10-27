import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkParts } from "./inbox.ts";
import {
  type Herdr, namedCheckouts, projectFiles, pullRequestLinks, readProjectFile, readState, workspaceLabels,
} from "./state.ts";

test("lists a project's files and reads only those", () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  for (const n of ["notes.txt", "AGENT-z.md", "README.md", "AGENT-a.md", ".hidden", "bin", "claude-1.json", "codex-2.json"])
    writeFileSync(join(dir, n), n);
  writeFileSync(join(dir, "bin"), Buffer.from([1, 0, 2]));
  writeFileSync(join(dir, "big.log"), "x".repeat((1 << 20) + 1));
  mkdirSync(join(dir, "worktree"));
  symlinkSync(join(dir, "notes.txt"), join(dir, "link"));
  writeFileSync(join(dir, "locked"), "x", { mode: 0o000 });
  assert.deepEqual(projectFiles(dir).map((f) => f.name), [
    "README.md", "AGENT-a.md", "AGENT-z.md", "big.log", "bin", "locked", "notes.txt",
  ]);
  // Root reads any file.
  if (process.getuid?.() !== 0) assert.deepEqual(readProjectFile(dir, "locked"), { error: "It can't be read." });
  assert.deepEqual(readProjectFile(dir, "notes.txt"), { text: "notes.txt" });
  assert.deepEqual(readProjectFile(dir, "bin"), { error: "It isn't text." });
  assert.deepEqual(readProjectFile(dir, "big.log"), { error: "It is too large to show." });
  for (const name of [".hidden", "claude-1.json", "link", "worktree", "../README.md", "", "gone"])
    assert.equal(readProjectFile(dir, name), null, name);
  assert.deepEqual(projectFiles(join(dir, "gone")), []);
});

test("reads the watcher's files and the projects' notes", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const state = join(root, "state");
  const projects = join(root, "project");
  const p1 = join(projects, "20261018-a");
  const p2 = join(projects, "20261017-b");
  const p3 = join(projects, "20261019-z");
  const closed = join(projects, "20261016-c");
  const hidden = join(projects, ".trash");
  for (const d of [state, p1, p2, p3, closed, hidden]) mkdirSync(d, { recursive: true });
  writeFileSync(join(closed, "README.md"), "---\nclosed: done\n---\n");
  writeFileSync(join(hidden, "AGENT-main.md"), "## Remaining\n- [you] Old\n");
  writeFileSync(join(p1, "README.md"), "---\ntitle: Do A\nname: a\n---\n");
  writeFileSync(join(p1, "AGENT-main.md"), "## Remaining\n- [you] Pick one\n");
  writeFileSync(join(p2, "AGENT-main.md"), "## Remaining\n- [wait] CI\n");
  mkdirSync(join(p1, "repo"));
  writeFileSync(join(p1, "repo", ".git"), "gitdir: elsewhere\n");
  mkdirSync(join(p1, "logs"));
  writeFileSync(
    join(state, "screen.json"),
    JSON.stringify([{ title: "Panes", at: null, lines: [" 85% w2:p1    20261019-z", "  2d w3:p1    a", " 90% w9:p1    /tmp/x"] }]),
  );
  writeFileSync(
    join(state, "inbox.json"),
    JSON.stringify({
      Panes: [{ project: p1, role: "main", mark: "ctx", text: "context 90% full" }],
      Slack: [{ project: join(projects, "gone"), role: null, mark: "slack", text: "hi" },
              { project: null, role: null, mark: "slack", text: "dm" }],
      "Pull requests": [{ project: closed, role: null, mark: "pr", text: "c#1 failed" }],
    }),
  );

  const s = readState(state, projects);
  // Without Herdr, which panes are in projects isn't known.
  assert.deepEqual(s.sections?.[0].lines.length, 3);
  assert.notEqual(s.watchedAt, null);
  // The worktree's repository is gone, so git can't name its last commit.
  assert.deepEqual(s.projects.map((p) => [p.name, p.title, p.worktrees, p.items.map((i) => i.text)]), [
    ["a", "Do A", [{ dir: join(p1, "repo"), subject: null }], ["Pick one", "context 90% full"]],
    ["20261019-z", "(no title)", [], []],
    ["20261017-b", "(no title)", [], []],
  ]);
  // Projects open in Herdr come before the quiet ones too, and those
  // with an agent whose context is full before all.
  const herdr: Herdr = {
    workspaces: [{ workspace_id: "w1", label: "bee" }, { workspace_id: "w2", label: "zed" },
                 { workspace_id: "w5", label: "done" }],
    panes: [
      { pane_id: "w1:p1", workspace_id: "w1", cwd: p2 },
      { pane_id: "w2:p1", workspace_id: "w2", cwd: p3, agent: "claude", agent_status: "idle",
        tokens: { role: "main", ctx: "85%" } },
      { pane_id: "w2:p2", workspace_id: "w2", cwd: join(p3, "wt"), agent: "claude", agent_status: "working",
        tokens: { ctx: "90%", bg: "1" } },
      // A shell, and an agent placed by the directory it reports.
      { pane_id: "w3:p1", workspace_id: "w3", foreground_cwd: p1 },
      { pane_id: "w4:p1", workspace_id: "w4", cwd: "/home", agent: "claude", agent_status: "idle",
        tokens: { cwd: join(p2, "wt"), ctx: "85.5%" } },
      // A closed project still open in a workspace.
      { pane_id: "w5:p1", workspace_id: "w5", cwd: closed },
    ],
  };
  const withHerdr = readState(state, projects, herdr);
  assert.deepEqual(withHerdr.projects.map((p) => [p.name, p.workspaces, p.panes]), [
    ["20261019-z", ["zed"], [{ id: "w2:p1", role: "main", status: "idle", ctx: 85 },
                             { id: "w2:p2", role: null, status: "working", ctx: null }]],
    ["a", [], []],
    ["20261017-b", ["bee"], [{ id: "w4:p1", role: null, status: "idle", ctx: null }]],
    ["20261016-c", ["done"], []],
  ]);
  // Panes in projects show with them, not in the watcher's section,
  // which goes when no others are left.
  // A closed project has no items, so the watcher's stay unowned.
  assert.deepEqual(withHerdr.unowned.map((i) => i.text), ["hi", "dm", "c#1 failed"]);
  assert.deepEqual(withHerdr.sections, [{ title: "Panes", at: null, lines: [" 90% w9:p1    /tmp/x"] }]);
  writeFileSync(
    join(state, "screen.json"),
    JSON.stringify([{ title: "Panes", at: null, lines: [" 85% w2:p1    20261019-z"] },
                    { title: "Slack", at: null, lines: ["Nothing to clean up."] }]),
  );
  assert.deepEqual(readState(state, projects, herdr).sections, [
    { title: "Slack", at: null, lines: ["Nothing to clean up."] },
  ]);
  writeFileSync(join(state, "screen.json"), JSON.stringify([{ title: "Panes", at: null, lines: ["Nothing to clean up."] }]));
  assert.deepEqual(readState(state, projects).sections, []);
  assert.deepEqual(s.unowned.map((i) => i.text), ["hi", "dm", "c#1 failed"]);

  assert.deepEqual(readState(join(root, "none"), join(root, "none")), {
    sections: null, watchedAt: null, projects: [], unowned: [], links: {}, agents: null,
  });
});

test("finds the checkouts that notes name", () => {
  assert.deepEqual(
    namedCheckouts(
      "Work in ~/repos/kzys/dotfiles. See /home/u/repos/a/b-c/sub and ~/repos/kzys/dotfiles/x.\n" +
        "Not ~/repos/<org>/<repo>, ~/repos/a/.. or /other/repos/x/y.",
      "/home/u",
    ),
    ["/home/u/repos/kzys/dotfiles", "/home/u/repos/a/b-c"],
  );
});

test("lists the checkouts a project works in after its worktrees", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const projects = join(root, "project");
  const [p1, p2] = [join(projects, "20261018-a"), join(projects, "20261017-b")];
  for (const d of [join(p1, "wt"), p2, join(root, "repos/o/r1"), join(root, "repos/o/r2")])
    mkdirSync(d, { recursive: true });
  for (const d of [join(p1, "wt"), join(root, "repos/o/r1"), join(root, "repos/o/r2")])
    writeFileSync(join(d, ".git"), "gitdir: elsewhere\n");
  // The field wins over what the notes name.
  writeFileSync(join(p1, "README.md"), "---\nrepositories: ~/repos/o/r2 ~/repos/o/gone\n---\nIn ~/repos/o/r1.\n");
  writeFileSync(join(p1, "AGENT-main.md"), "## Remaining\n- [you] Pick one\n");
  writeFileSync(join(p2, "AGENT-main.md"), "## Remaining\n- [you] Check ~/repos/o/r1\n");

  const s = readState(join(root, "state"), projects, null, root);
  assert.deepEqual(s.projects.map((p) => p.worktrees.map((w) => w.dir)), [
    [join(p1, "wt"), join(root, "repos/o/r2")],
    [join(root, "repos/o/r1")],
  ]);
});

test("names the workspaces with panes in a project", () => {
  const herdr: Herdr = {
    workspaces: [{ workspace_id: "w1", label: "custom" }, { workspace_id: "w2" },
                 { workspace_id: "w3", label: "other" }],
    panes: [{ pane_id: "w1:p1", workspace_id: "w1", cwd: "/p/a/wt" },
            { pane_id: "w2:p1", workspace_id: "w2", cwd: "/home", foreground_cwd: "/p/a" },
            { pane_id: "w3:p1", workspace_id: "w3", cwd: "/p/ab" }],
  };
  assert.deepEqual(workspaceLabels("/p/a", herdr), ["custom", "w2"]);
  assert.deepEqual(workspaceLabels("/p/a", null), []);
});

test("links pull requests by their labels", () => {
  const links = pullRequestLinks({
    "https://github.com/kzys/dotfiles/pull/80": { state: "OPEN" },
    "https://github.com/kzys/containerd/pull/12": { state: "OPEN" },
    "https://github.com/containerd/containerd/pull/12": { state: "OPEN" },
    "https://example.com/x": {},
  });
  assert.deepEqual(links, {
    "kzys/dotfiles#80": "https://github.com/kzys/dotfiles/pull/80",
    "dotfiles#80": "https://github.com/kzys/dotfiles/pull/80",
    "kzys/containerd#12": "https://github.com/kzys/containerd/pull/12",
    "containerd/containerd#12": "https://github.com/containerd/containerd/pull/12",
  });
  assert.deepEqual(pullRequestLinks(null), {});

  assert.deepEqual(linkParts("✓ ● dotfiles#80     dotfiles   Add it", links), [
    ["✓ ● "], ["dotfiles#80", "https://github.com/kzys/dotfiles/pull/80"],
    ["     dotfiles   Add it"]]);
  // A label two pull requests share links only with its owner.
  assert.deepEqual(linkParts("containerd#12 and containerd/containerd#12", links), [
    ["containerd#12"], [" and "],
    ["containerd/containerd#12", "https://github.com/containerd/containerd/pull/12"]]);
  // Another owner's pull request with the same name isn't this one.
  assert.deepEqual(linkParts("other/dotfiles#80 is done", links), [
    ["other/dotfiles#80"], [" is done"]]);
  assert.deepEqual(linkParts("see https://x.test/pull/1#c-2) or x#1", links), [
    ["see "], ["https://x.test/pull/1#c-2", "https://x.test/pull/1#c-2"], [") or "], ["x#1"]]);
  assert.deepEqual(linkParts("__proto__#1 constructor", links), [["__proto__#1"], [" constructor"]]);
});
