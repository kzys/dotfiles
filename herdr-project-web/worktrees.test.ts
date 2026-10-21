import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiff } from "./diff.ts";
import { checkoutDirs, lastSubject, summarize, worktreeDiff, worktreeDirs } from "./worktrees.ts";

test("diffs a worktree from where its branch left the remote's default", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const git = (dir: string, ...args: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "pipe" });
  const origin = join(root, "origin");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  writeFileSync(join(origin, "kept.txt"), "a\nb\n");
  writeFileSync(join(origin, "gone.txt"), "x\n");
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", "Start");

  const project = join(root, "project");
  const wt = join(project, "wt");
  mkdirSync(join(project, "notes"), { recursive: true });
  git(root, "clone", "-q", origin, wt);
  git(wt, "switch", "-q", "-c", "feature");
  git(wt, "rm", "-q", "gone.txt");
  git(wt, "commit", "-q", "-m", "Drop gone.txt");
  assert.equal(lastSubject(wt), "Drop gone.txt");
  writeFileSync(join(wt, "kept.txt"), "a\nB\n");
  writeFileSync(join(wt, "new.txt"), "n\n");
  writeFileSync(join(wt, "empty"), "");
  git(wt, "config", "diff.mnemonicPrefix", "true");
  // The remote moving on doesn't show in the branch's diff.
  writeFileSync(join(origin, "later.txt"), "l\n");
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", "Later");
  git(wt, "fetch", "-q");

  assert.deepEqual(worktreeDirs(project), [wt]);
  assert.deepEqual(checkoutDirs(root), [wt]);
  assert.deepEqual(await summarize(wt), {
    dir: wt, branch: "feature", base: "origin/main", ahead: 1,
    files: 2, added: 1, removed: 2, untracked: 2, error: null,
  });
  const diff = await worktreeDiff(wt);
  assert.deepEqual(diff.commits.map((c) => c.subject), ["Drop gone.txt"]);
  assert.deepEqual(parseDiff(diff.diff).map((f) => [f.from, f.to, f.status, f.added, f.removed]), [
    ["gone.txt", null, "deleted", 0, 1],
    ["kept.txt", "kept.txt", "modified", 1, 1],
    [null, "empty", "added", 0, 0],
    [null, "new.txt", "added", 1, 0],
  ]);
  assert.equal(diff.omitted, 0);

  // A directory of untracked files counts as one, and one of ignored
  // files not at all.
  mkdirSync(join(wt, "more"));
  writeFileSync(join(wt, "more", "a.txt"), "a\n");
  writeFileSync(join(wt, "more", "b.txt"), "b\n");
  mkdirSync(join(wt, "cache"));
  writeFileSync(join(wt, "cache", "c.pyc"), "");
  writeFileSync(join(wt, ".git", "info", "exclude"), "*.pyc\n");
  assert.equal((await summarize(wt)).untracked, 3);
  const more = await worktreeDiff(wt);
  assert.equal(more.omitted, 0);
  assert.equal(parseDiff(more.diff).length, 6);

  // Without a remote, it shows what changed since HEAD.
  git(wt, "remote", "remove", "origin");
  assert.equal((await summarize(wt)).base, null);
  assert.equal((await summarize(wt)).files, 1);

  const broken = join(project, "broken");
  mkdirSync(broken);
  writeFileSync(join(broken, ".git"), "gitdir: /nonexistent\n");
  assert.match((await summarize(broken)).error ?? "", /not a git repository/);
  assert.equal(lastSubject(broken), null);
});

test("names a worktree's last commit again once it changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "pipe" });
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "First");
  assert.equal(lastSubject(dir), "First");
  git("commit", "-q", "--allow-empty", "-m", "Second");
  assert.equal(lastSubject(dir), "Second");
});
