// Asking git how the worktrees in the projects differ from where their
// branches started.

import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Untracked files past this many go unshown.
const MAX_UNTRACKED = 100;

export type Commit = { hash: string; subject: string };

export type Summary = {
  dir: string;
  // The checked out branch, or null if HEAD is detached.
  branch: string | null;
  // The ref the diff starts from, like origin/main, or null when it
  // only shows changes since HEAD.
  base: string | null;
  // How many commits HEAD has past the base.
  ahead: number;
  files: number;
  added: number;
  removed: number;
  untracked: number;
  // Why git couldn't say, as when the worktree's repository is gone.
  error: string | null;
};

export type WorktreeDiff = Summary & {
  commits: Commit[];
  // What git diff says, with untracked files as added.
  diff: string;
  // How many untracked files the diff leaves out: past the first ones,
  // and repositories nested in the worktree.
  omitted: number;
};

/** Reports whether dir is a git worktree or checkout. */
export function isCheckout(dir: string): boolean {
  try {
    return statSync(dir).isDirectory() && !!statSync(join(dir, ".git"), { throwIfNoEntry: false });
  } catch {
    return false;
  }
}

/** Returns the git worktrees and checkouts directly in projectDir. */
export function worktreeDirs(projectDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(projectDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => !n.startsWith("."))
    .map((n) => join(projectDir, n))
    .filter(isCheckout)
    .sort();
}

/** Returns the git checkouts in root, laid out as root/<org>/<repo>. */
export function checkoutDirs(root: string): string[] {
  let orgs: string[];
  try {
    orgs = readdirSync(root).filter((n) => !n.startsWith("."));
  } catch {
    return [];
  }
  return orgs.sort().flatMap((org) => worktreeDirs(join(root, org)));
}

/** Returns the output of git with args in dir. Exit codes in ok besides
 * 0 don't fail, as for git diff --no-index, which exits 1 on a
 * difference. */
function git(dir: string, args: string[], ok: number[] = []): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      "git",
      ["-C", dir, "-c", "core.quotePath=false", ...args],
      // Don't take the index lock that agents working here may want.
      { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 64 << 20, timeout: 15_000 },
      (err, stdout, stderr) => {
        if (!err || ok.includes(err.code as number)) resolve(stdout);
        else reject(new Error(stderr.trim().split("\n").pop() || err.message));
      },
    ),
  );
}

/** Returns the ref the branch in dir starts from and where it forked
 * from that: the remote's default branch, else its upstream, or null
 * if neither is known. */
async function base(dir: string): Promise<[string, string] | null> {
  const refs: string[] = [];
  try {
    refs.push((await git(dir, ["rev-parse", "--abbrev-ref", "origin/HEAD"])).trim());
  } catch {
    refs.push("origin/main", "origin/master");
  }
  refs.push("@{upstream}");
  for (const ref of refs) {
    try {
      const fork = (await git(dir, ["merge-base", "HEAD", ref])).trim();
      const name = ref === "@{upstream}" ? (await git(dir, ["rev-parse", "--abbrev-ref", ref])).trim() : ref;
      return [name, fork];
    } catch {}
  }
  return null;
}

/** Returns what to diff dir's files against, as base returns it, or
 * HEAD, or the empty tree before the first commit, and whether there is
 * a commit. */
async function start(dir: string): Promise<[string | null, string, boolean]> {
  const b = await base(dir);
  if (b) return [...b, true];
  try {
    await git(dir, ["rev-parse", "--verify", "-q", "HEAD"]);
    return [null, "HEAD", true];
  } catch {
    // The empty tree's name depends on the repository's hash.
    return [null, (await git(dir, ["hash-object", "-t", "tree", "/dev/null"])).trim(), false];
  }
}

// The arguments of git diff for the page, whose parser expects git's
// usual a/ and b/ prefixes, whatever the user's config says.
const DIFF = ["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"];

/** Returns the paths of the untracked files in dir that git doesn't
 * ignore. */
async function untracked(dir: string): Promise<string[]> {
  return (await git(dir, ["ls-files", "-z", "--others", "--exclude-standard"])).split("\0").filter((p) => p);
}

/** Returns how dir differs from where its branch started, without the
 * diff itself, with what the diff starts from, whether HEAD has a
 * commit, and the untracked files, unless git failed. */
async function inspect(dir: string): Promise<[Summary, string, boolean, string[]]> {
  const summary: Summary = {
    dir, branch: null, base: null, ahead: 0, files: 0, added: 0, removed: 0, untracked: 0, error: null,
  };
  let from = "HEAD";
  let born = true;
  let others: string[] = [];
  try {
    let b: string | null;
    [b, from, born] = await start(dir);
    summary.base = b;
    let branch, numstat, ahead;
    [branch, numstat, ahead, others] = await Promise.all([
      git(dir, ["symbolic-ref", "-q", "--short", "HEAD"], [1]),
      git(dir, ["diff", "--numstat", "-z", "--find-renames", from]),
      born ? git(dir, ["rev-list", "--count", `${from}..HEAD`]) : "0",
      untracked(dir),
    ]);
    summary.branch = branch.trim() || null;
    summary.ahead = Number(ahead.trim()) || 0;
    // Each file is "added\tremoved\tpath\0", or with an empty path and
    // two more fields for a rename; binary files count "-".
    for (const m of numstat.matchAll(/(-|\d+)\t(-|\d+)\t(?:\0[^\0]*\0)?[^\0]*\0/g)) {
      summary.files++;
      summary.added += Number(m[1]) || 0;
      summary.removed += Number(m[2]) || 0;
    }
    summary.untracked = others.length;
  } catch (e) {
    summary.error = (e as Error).message;
  }
  return [summary, from, born, others];
}

/** Returns how dir differs from where its branch started, without the
 * diff itself. */
export async function summarize(dir: string): Promise<Summary> {
  return (await inspect(dir))[0];
}

/** Returns how dir differs from where its branch started: its commits
 * since and the diff of its files, untracked ones included as added. */
export async function worktreeDiff(dir: string): Promise<WorktreeDiff> {
  const [summary, from, born, others] = await inspect(dir);
  const result: WorktreeDiff = { ...summary, commits: [], diff: "", omitted: 0 };
  if (summary.error) return result;
  try {
    const [log, diff] = await Promise.all([
      born ? git(dir, ["log", "-z", "--format=%h %s", `${from}..HEAD`]) : "",
      git(dir, [...DIFF, "--find-renames", from]),
    ]);
    result.commits = log.split("\0").filter((l) => l).map((l) => {
      const i = l.indexOf(" ");
      return { hash: l.slice(0, i), subject: l.slice(i + 1) };
    });
    // git lists a nested repository as its directory, which it can't
    // diff as a file.
    const files = others.filter((p) => !p.endsWith("/")).slice(0, MAX_UNTRACKED);
    result.omitted = others.length - files.length;
    const added = await Promise.all(
      files.map((p) => git(dir, [...DIFF, "--no-index", "--", "/dev/null", p], [1])),
    );
    result.diff = diff + added.join("");
  } catch (e) {
    result.error = (e as Error).message;
  }
  return result;
}
