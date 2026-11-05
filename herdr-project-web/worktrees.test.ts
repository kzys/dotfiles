import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiff } from "./diff.ts";
import { checkoutDirs, createdFrom, fileLines, lastSubject, setBase, summarize, worktreeDiff, worktreeDirs } from "./worktrees.ts";

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
    dir: wt, branch: "feature", base: "origin/main", source: "default", ahead: 1,
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

  // Without a remote, it starts from the branch it was created from, and
  // without that, it shows what changed since HEAD.
  git(wt, "remote", "remove", "origin");
  assert.equal((await summarize(wt)).base, "main");
  git(wt, "branch", "-q", "-D", "main");
  assert.equal((await summarize(wt)).base, null);
  assert.equal((await summarize(wt)).files, 1);

  const broken = join(project, "broken");
  mkdirSync(broken);
  writeFileSync(join(broken, ".git"), "gitdir: /nonexistent\n");
  // Newer git says the gitfile doesn't point to a valid repository.
  assert.match((await summarize(broken)).error ?? "",
               /not a git repository|does not point to a valid repository/);
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

test("shows ten lines of context around a change", async () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
  const lines = Array.from({ length: 41 }, (_, i) => `line ${i}`);
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start");
  writeFileSync(join(dir, "f"), lines.join("\n"));
  git("add", "f");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "file");
  lines[20] = "changed";
  writeFileSync(join(dir, "f"), lines.join("\n"));
  assert.equal((await worktreeDiff(dir)).diff.split("\n").filter((l) => l.startsWith(" ")).length, 20);
});

test("reads lines of a file in the worktree and nothing outside it", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const dir = join(root, "wt");
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "sub/f"), "one\ntwo\nthree\n");
  writeFileSync(join(root, "secret"), "no\n");
  symlinkSync(join(root, "secret"), join(dir, "link"));
  assert.deepEqual(fileLines(dir, "sub/f", 2, 3), ["two", "three"]);
  assert.deepEqual(fileLines(dir, "sub/f", 3, 20), ["three"]);
  assert.deepEqual(fileLines(dir, "sub/f", 4, 20), []);
  assert.equal(fileLines(dir, "../secret", 1, 1), null);
  assert.equal(fileLines(dir, "link", 1, 1), null);
  assert.equal(fileLines(dir, "missing", 1, 1), null);
});

const log = (...entries: [number, string][]) => entries.map(([at, message]) => `refs/heads/x@{${at}} ${message}`).join("\n");

test("reads what a branch was created from", () => {
  assert.equal(createdFrom(log([9, "commit: x"], [5, "branch: Created from parent"]), "", "child"), "parent");
  assert.equal(createdFrom(log([5, "branch: Created from refs/heads/parent"]), "", "child"), "parent");
  assert.equal(createdFrom(log([5, "branch: Created from refs/remotes/origin/parent"]), "", "child"), "parent");
  assert.equal(createdFrom(log([5, "branch: Created from origin/parent"]), "", "child"), "parent");
});

test("a branch checked out from its own remote branch has no parent", () => {
  assert.equal(createdFrom(log([5, "branch: Created from refs/remotes/origin/child"]), "", "child"), null);
});

test("what HEAD moved from counts only as the branch was created", () => {
  const created = log([50, "branch: Created from HEAD"]);
  const head = log([90, "checkout: moving from other to child"], [50, "checkout: moving from parent to child"], [10, "checkout: moving from old to child"]);
  assert.equal(createdFrom(created, head, "child"), "parent");
  assert.equal(createdFrom(created, log([90, "checkout: moving from other to child"]), "child"), null);
  assert.equal(createdFrom(created, "", "child"), null);
});

test("a log that doesn't start with its creation says nothing", () => {
  const head = log([5, "checkout: moving from other to main"]);
  assert.equal(createdFrom(log([5, "clone: from /origin"]), head, "main"), null);
  assert.equal(createdFrom("", head, "main"), null);
});

/** Returns a clone of a new repository on GitHub's name, with main, parent
 * on top of it, and child on top of that checked out, and a function that
 * runs git in the clone. */
function stacked() {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const [origin, dir] = [join(root, "origin"), join(root, "wt")];
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "pipe", encoding: "utf8" });
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  git(origin, "config", "receive.denyCurrentBranch", "ignore");
  writeFileSync(join(origin, "base"), "b\n");
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", "Start");
  git(root, "clone", "-q", origin, dir);
  const commit = (name: string) => {
    writeFileSync(join(dir, name), "x\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", name);
  };
  git(dir, "switch", "-q", "-c", "parent");
  commit("parent.txt");
  git(dir, "switch", "-q", "-c", "child");
  commit("child.txt");
  return { dir, git: (...args: string[]) => git(dir, ...args), commit };
}

test("a stacked branch shows only its own commits", async () => {
  const { dir } = stacked();
  const wt = await worktreeDiff(dir);
  assert.deepEqual([wt.base, wt.source, wt.ahead, wt.files], ["parent", "created from", 1, 1]);
  assert.deepEqual(wt.commits.map((c) => c.subject), ["child.txt"]);
  assert.deepEqual(wt.baseOptions.sort(), ["main", "parent"]);
});

test("a branch from the default one has the default base", async () => {
  const { dir, git } = stacked();
  git("switch", "-q", "main");
  git("switch", "-q", "-c", "plain");
  assert.deepEqual([(await summarize(dir)).base, (await summarize(dir)).source], ["origin/main", "default"]);
});

test("a parent since merged no longer counts", async () => {
  const { dir, git } = stacked();
  git("push", "-q", "origin", "parent:main");
  git("fetch", "-q");
  const wt = await summarize(dir);
  assert.deepEqual([wt.base, wt.source, wt.ahead], ["origin/main", "default", 1]);
});

test("a chosen base wins over the log, and can be forgotten", async () => {
  const { dir } = stacked();
  assert.equal(await setBase(dir, "child", "main"), true);
  const chosen = await summarize(dir);
  assert.deepEqual([chosen.base, chosen.source, chosen.ahead], ["main", "setting", 2]);
  assert.equal((await worktreeDiff(dir)).chosenBase, "main");
  assert.equal(await setBase(dir, "child", null), true);
  assert.equal(await setBase(dir, "child", null), true);
  assert.equal((await summarize(dir)).source, "created from");
});

test("a pull request's base wins over everything", async () => {
  const { dir, git } = stacked();
  git("remote", "set-url", "origin", "https://github.com/o/r.git");
  await setBase(dir, "child", "parent");
  git("update-ref", "refs/remotes/origin/other", "main");
  const wt = await summarize(dir, { "o/r:child": "other", "o/r2:child": "wrong", "x/y:child": "wrong" });
  assert.deepEqual([wt.base, wt.source], ["origin/other", "pull request"]);
  assert.equal((await summarize(dir, { "x/y:child": "main" })).source, "setting");
});

test("a base that doesn't exist falls through", async () => {
  const { dir, git } = stacked();
  git("config", "branch.child.gh-merge-base", "gone");
  assert.equal((await summarize(dir)).source, "created from");
  assert.equal((await worktreeDiff(dir)).chosenBase, "gone");
});

test("only sets a branch the page offered, on the branch it showed", async () => {
  const { dir } = stacked();
  assert.equal(await setBase(dir, "other", "main"), false);
  assert.equal(await setBase(dir, "child", "--foo"), false);
  assert.equal((await worktreeDiff(dir)).chosenBase, null);
});

test("a local parent ahead of the remote's keeps its commits out of the diff", async () => {
  const { dir, git, commit } = stacked();
  git("switch", "-q", "parent");
  git("push", "-q", "origin", "parent");
  commit("unpushed.txt");
  git("switch", "-q", "-c", "next");
  commit("next.txt");
  const wt = await summarize(dir);
  assert.deepEqual([wt.base, wt.ahead], ["parent", 1]);
});

test("a branch from its own remote branch diffs against the default", async () => {
  const { dir, git, commit } = stacked();
  git("switch", "-q", "main");
  git("switch", "-q", "-c", "side");
  commit("side.txt");
  git("push", "-q", "origin", "side");
  git("switch", "-q", "main");
  git("branch", "-q", "-D", "side");
  git("switch", "-q", "side");
  commit("more.txt");
  const wt = await summarize(dir);
  assert.deepEqual([wt.base, wt.source, wt.ahead], ["origin/main", "default", 2]);
});

test("the default branch of a clone isn't based on what it switched from", async () => {
  const { dir, git } = stacked();
  git("switch", "-q", "main");
  assert.deepEqual([(await summarize(dir)).base, (await summarize(dir)).source], ["origin/main", "default"]);
});

test("a relative start point isn't a parent", async () => {
  const { dir, git, commit } = stacked();
  git("switch", "-q", "-c", "rel", "HEAD~1");
  commit("a.txt");
  commit("b.txt");
  const wt = await summarize(dir);
  assert.deepEqual([wt.base, wt.source, wt.ahead], ["origin/main", "default", 3]);
});
