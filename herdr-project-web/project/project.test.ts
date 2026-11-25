import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Herdr } from "../herdr/backend.ts";
import { Project, checkoutOf, linkCheckout, namedCheckouts, projectFiles, readProjectFile } from "./project.ts";

/** Returns the project in dir with nothing read of its files, where herdr
 * shows it. */
const at = (dir: string, herdr: Herdr | null) => new Project({ dir, readme: null, notes: [], worktrees: [], files: [] }, herdr);

test("finds the checkout holding a directory", () => {
  assert.equal(checkoutOf("/home/me/repos/o/r/sub/dir", "/home/me"), "/home/me/repos/o/r");
  assert.equal(checkoutOf("/home/me/repos/o/r", "/home/me"), "/home/me/repos/o/r");
  assert.equal(checkoutOf("/home/me/repos/o", "/home/me"), null);
  assert.equal(checkoutOf("/home/me/project/p", "/home/me"), null);
  assert.equal(checkoutOf("/elsewhere/a/b", "/home/me"), null);
  assert.equal(checkoutOf("/home/me/repos/o/.cache/x", "/home/me"), null);
});

test("remembers each checkout a project works in once", () => {
  const links = {};
  assert.equal(linkCheckout(links, "/p", "/r1"), true);
  assert.equal(linkCheckout(links, "/p", "/r1"), false);
  assert.equal(linkCheckout(links, "/p", "/r2"), true);
  assert.deepEqual(links, { "/p": ["/r1", "/r2"] });
});

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

test("gives each agent in a project the title its terminal shows", () => {
  const pane = (pane_id: string, terminal_title?: string) =>
    ({ pane_id, workspace_id: "w1", cwd: "/p/a", agent: "claude", agent_status: "idle", terminal_title });
  const herdr = { workspaces: [], panes: [pane("t1", "Fix the board"), pane("t2", "")] };
  assert.deepEqual(at("/p/a", herdr).panes().map((p) => [p.id, p.title]), [["t1", "Fix the board"], ["t2", undefined]]);
});

test("counts the tabs with panes in a project", () => {
  const pane = (tab_id: string, cwd: string) => ({ pane_id: `${tab_id}:${cwd}`, workspace_id: "w1", tab_id, cwd });
  const herdr = { workspaces: [], panes: [pane("t1", "/p/a"), pane("t1", "/p/a/wt"), pane("t2", "/p/a"), pane("t3", "/p/b")] };
  assert.equal(at("/p/a", herdr).tabs(), 2);
  assert.equal(at("/p/c", herdr).tabs(), 0);
  assert.equal(at("/p/a", null).tabs(), 0);
});

test("names the workspaces with panes in a project", () => {
  const herdr: Herdr = {
    workspaces: [{ workspace_id: "w1", label: "custom" }, { workspace_id: "w2" },
                 { workspace_id: "w3", label: "other" }],
    panes: [{ pane_id: "w1:p1", workspace_id: "w1", cwd: "/p/a/wt" },
            { pane_id: "w2:p1", workspace_id: "w2", cwd: "/home", foreground_cwd: "/p/a" },
            { pane_id: "w3:p1", workspace_id: "w3", cwd: "/p/ab" }],
  };
  assert.deepEqual(at("/p/a", herdr).workspaces(), ["custom", "w2"]);
  assert.deepEqual(at("/p/a", null).workspaces(), []);
});
