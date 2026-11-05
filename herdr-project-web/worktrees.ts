// Asking git how the worktrees in the projects differ from where their
// branches started.

import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoName } from "./github.ts";

// Untracked files past this many go unshown.
const MAX_UNTRACKED = 100;

export type Commit = { hash: string; subject: string };

// What open pull requests merge into, by "owner/name:branch".
export type PullBases = Record<string, string>;

// What says what a branch starts from: its pull request, the setting gh also
// reads, what git recorded when it was created, or nothing, for the default.
export type BaseSource = "pull request" | "setting" | "created from" | "default";

export type Summary = {
  dir: string;
  // The checked out branch, or null if HEAD is detached.
  branch: string | null;
  // The ref the diff starts from, like origin/main, or null when it
  // only shows changes since HEAD.
  base: string | null;
  // What says the base is that.
  source: BaseSource | null;
  // How many commits HEAD has past the base.
  ahead: number;
  files: number;
  added: number;
  removed: number;
  // Untracked paths, counting a directory of them as one, which keeps
  // git from listing every file in a big one.
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
  // The local branches it could start from instead.
  baseOptions: string[];
  // The base chosen for it, in use or not, or null.
  chosenBase: string | null;
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

// The subjects of worktrees' last commits by directory, with when their
// HEAD's log changed then.
const subjects = new Map<string, [number, string | null]>();

/** Returns when the log of HEAD in dir, which a commit or checkout
 * writes, last changed, else HEAD itself, or -1 if neither can be read,
 * as when the worktree's repository is gone. */
function headChanged(dir: string): number {
  try {
    let gitDir = join(dir, ".git");
    if (statSync(gitDir).isFile())
      gitDir = resolve(dir, readFileSync(gitDir, "utf8").replace(/^gitdir:/, "").trim());
    for (const f of [join(gitDir, "logs", "HEAD"), join(gitDir, "HEAD")]) {
      const st = statSync(f, { throwIfNoEntry: false });
      if (st) return st.mtimeMs;
    }
  } catch {}
  return -1;
}

/** Returns the subject of the last commit in dir, or null if git can't
 * say, as when the worktree's repository is gone. git is asked again
 * only once HEAD's log changes. */
export function lastSubject(dir: string): string | null {
  const changed = headChanged(dir);
  const known = subjects.get(dir);
  if (known && known[0] === changed) return known[1];
  let subject: string | null = null;
  try {
    const out = execFileSync("git", ["-C", dir, "log", "-1", "--format=%s"], {
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    subject = out.trim() || null;
  } catch {}
  subjects.set(dir, [changed, subject]);
  return subject;
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

/** Returns the time and message of a line of git reflog --date=unix
 * --format="%gd %gs", or null. */
function logEntry(line: string): { at: number; message: string } | null {
  const m = /^\S*@\{(\d+)\} (.*)$/.exec(line);
  return m && { at: Number(m[1]), message: m[2] };
}

/** Returns the branch a branch was created from, from the reflogs of it and
 * of HEAD, newest first, or null if they don't say. Only the branch's first
 * entry counts: others just record where it has been. A branch created from
 * HEAD names nothing, so it counts what HEAD moved from as it was created. */
export function createdFrom(branchLog: string, headLog: string, branch: string): string | null {
  const first = logEntry(branchLog.trim().split("\n").at(-1) ?? "");
  const created = first && /^branch: Created from (.+)$/.exec(first.message);
  if (!first || !created) return null;
  let name: string | undefined = created[1];
  if (name === "HEAD") {
    const moves = headLog.trim().split("\n").map(logEntry).flatMap((e) => {
      const m = e && Math.abs(e.at - first.at) <= 1 ? /^checkout: moving from (.+) to (.+)$/.exec(e.message) : null;
      return m?.[2] === branch ? [m[1]] : [];
    });
    name = moves.at(-1);
  }
  name = name?.replace(/^refs\/heads\/|^refs\/remotes\/origin\/|^origin\//, "");
  return name && name !== branch ? name : null;
}

/** Returns the remote's default branch in dir as the refs that may name it. */
async function defaultRefs(dir: string): Promise<string[]> {
  try {
    return [(await git(dir, ["rev-parse", "--abbrev-ref", "origin/HEAD"])).trim()];
  } catch {
    return ["origin/main", "origin/master"];
  }
}

// What git's logs say each branch was created from, by directory, branch and
// commit: reading them each time slows the page, and they rarely change.
const creations = new Map<string, string | null>();

/** Returns what branch in dir was created from: see createdFrom. */
async function creationOf(dir: string, branch: string): Promise<string | null> {
  const key = `${dir}\0${branch}\0${(await git(dir, ["rev-parse", "-q", "--verify", "HEAD"], [1])).trim()}`;
  if (creations.has(key)) return creations.get(key)!;
  const log = (ref: string) => git(dir, ["reflog", "show", "--date=unix", "--format=%gd %gs", ref], [128]);
  const created = createdFrom(await log(`refs/heads/${branch}`), await log("HEAD"), branch);
  if (creations.size > 1000) creations.clear();
  creations.set(key, created);
  return created;
}

/** Returns the branches the checked out branch of dir may start from other
 * than the default one, best first, with what says so. pulls holds what
 * open pull requests merge into, by "owner/name:branch". */
async function namedBases(dir: string, pulls: PullBases): Promise<[string, BaseSource][]> {
  const branch = (await git(dir, ["symbolic-ref", "-q", "--short", "HEAD"], [1])).trim();
  if (!branch) return [];
  const [url, setting, created] = await Promise.all([
    git(dir, ["remote", "get-url", "origin"], [2]),
    git(dir, ["config", "--get", `branch.${branch}.gh-merge-base`], [1]),
    creationOf(dir, branch),
  ]);
  const pull = pulls[`${repoName(url)}:${branch}`];
  const named: [string | null | undefined, BaseSource][] = [[pull, "pull request"], [setting.trim(), "setting"], [created, "created from"]];
  return named.flatMap(([name, source]) => (name && name !== branch ? [[name, source] as [string, BaseSource]] : []));
}

/** Returns the ref for branch name in dir that is nearest HEAD, local or the
 * remote's, with where HEAD forked from it, or null if it has neither: a
 * local parent may be ahead of the remote's, and behind it after a pull. */
async function nearest(dir: string, name: string): Promise<[string, string] | null> {
  const found = await Promise.all([[name, `refs/heads/${name}`], [`origin/${name}`, `refs/remotes/origin/${name}`]].map(async ([label, ref]) => {
    try {
      const fork = (await git(dir, ["merge-base", "HEAD", ref])).trim();
      return [[label, fork, Number(await git(dir, ["rev-list", "--count", `${fork}..HEAD`]))] as [string, string, number]];
    } catch {
      return [];
    }
  }));
  const best = found.flat().sort((a, b) => a[2] - b[2])[0];
  return best ? [best[0], best[1]] : null;
}

/** Returns the ref the branch in dir starts from, where it forked from that
 * and what says so, or null if nothing is known: what namedBases finds, the
 * first that is a branch here, else the remote's default branch, else its
 * upstream. A branch it was created from counts only until that is merged. */
async function base(dir: string, pulls: PullBases): Promise<[string, string, BaseSource] | null> {
  const [defaults, named] = await Promise.all([defaultRefs(dir), namedBases(dir, pulls)]);
  for (const [name, source] of named) {
    const found = await nearest(dir, name);
    if (!found) continue;
    const merged = source === "created from" && (await Promise.all(defaults.map((d) => isAncestor(dir, found[0], d)))).some(Boolean);
    if (!merged) return [...found, source];
  }
  for (const ref of [...defaults, "@{upstream}"]) {
    try {
      const fork = (await git(dir, ["merge-base", "HEAD", ref])).trim();
      const name = ref === "@{upstream}" ? (await git(dir, ["rev-parse", "--abbrev-ref", ref])).trim() : ref;
      return [name, fork, "default"];
    } catch {}
  }
  return null;
}

/** Reports whether ref is in the history of other. */
const isAncestor = (dir: string, ref: string, other: string) =>
  git(dir, ["merge-base", "--is-ancestor", ref, other]).then(() => true, () => false);

/** Records base as what branch of dir starts from, or forgets it for null,
 * returning whether it could: branch must still be checked out, and base a
 * branch offered. gh pr create reads the same setting. */
export async function setBase(dir: string, branch: string, base: string | null): Promise<boolean> {
  const now = (await git(dir, ["symbolic-ref", "--short", "HEAD"])).trim();
  if (now !== branch || (base !== null && !(await baseOptions(dir, now)).includes(base))) return false;
  const key = `branch.${branch}.gh-merge-base`;
  await git(dir, base ? ["config", key, base] : ["config", "--unset", key], [5]);
  return true;
}

/** Returns the local branches of dir to offer as a base, newest first,
 * without the one checked out. */
async function baseOptions(dir: string, branch: string | null): Promise<string[]> {
  const out = await git(dir, ["for-each-ref", "--sort=-committerdate", "--count=30", "--format=%(refname:short)", "refs/heads"]);
  return out.split("\n").filter((b) => b && b !== branch);
}

/** Returns what to diff dir's files against, as base returns it, or
 * HEAD, or the empty tree before the first commit, and whether there is
 * a commit. */
async function start(dir: string, pulls: PullBases): Promise<[string | null, string, boolean, BaseSource | null]> {
  const b = await base(dir, pulls);
  if (b) return [b[0], b[1], true, b[2]];
  try {
    await git(dir, ["rev-parse", "--verify", "-q", "HEAD"]);
    return [null, "HEAD", true, null];
  } catch {
    // The empty tree's name depends on the repository's hash.
    return [null, (await git(dir, ["hash-object", "-t", "tree", "/dev/null"])).trim(), false, null];
  }
}

// The arguments of git diff for the page, whose parser expects git's
// usual a/ and b/ prefixes, whatever the user's config says.
const DIFF = ["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"];

/** Returns the paths of the untracked files in dir that git doesn't
 * ignore, with a directory of only such files as one path if collapse
 * is set. */
async function untracked(dir: string, collapse = false): Promise<string[]> {
  const args = ["ls-files", "-z", "--others", "--exclude-standard"];
  if (collapse) args.push("--directory", "--no-empty-directory");
  return (await git(dir, args)).split("\0").filter((p) => p);
}

/** Returns how dir differs from where its branch started, without the
 * diff itself, with what the diff starts from and whether HEAD has a
 * commit. */
async function inspect(dir: string, pulls: PullBases): Promise<[Summary, string, boolean]> {
  const summary: Summary = {
    dir, branch: null, base: null, source: null, ahead: 0, files: 0, added: 0, removed: 0, untracked: 0, error: null,
  };
  let from = "HEAD";
  let born = true;
  try {
    let b: string | null;
    [b, from, born, summary.source] = await start(dir, pulls);
    summary.base = b;
    const [branch, numstat, ahead, others] = await Promise.all([
      git(dir, ["symbolic-ref", "-q", "--short", "HEAD"], [1]),
      git(dir, ["diff", "--numstat", "-z", "--find-renames", from]),
      born ? git(dir, ["rev-list", "--count", `${from}..HEAD`]) : "0",
      untracked(dir, true),
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
  return [summary, from, born];
}

/** Returns how dir differs from where its branch started, without the
 * diff itself. */
export async function summarize(dir: string, pulls: PullBases = {}): Promise<Summary> {
  return (await inspect(dir, pulls))[0];
}

// Lines of context around each change; the page can show more.
const CONTEXT = 10;
// A file larger than this isn't read for more context.
const MAX_FILE = 5 << 20;

/** Returns lines from through to of the file at path in dir, as they are
 * now, numbered from 1, or null if it isn't a file in dir that can be read. */
export function fileLines(dir: string, path: string, from: number, to: number): string[] | null {
  try {
    const root = realpathSync(dir);
    const file = realpathSync(join(dir, path));
    const stat = statSync(file);
    if (!file.startsWith(`${root}/`) || !stat.isFile() || stat.size > MAX_FILE) return null;
    const lines = readFileSync(file, "utf8").split("\n");
    // A last newline ends the last line, rather than starting another.
    if (lines.at(-1) === "") lines.pop();
    return lines.slice(from - 1, to);
  } catch {
    return null;
  }
}

/** Returns how dir differs from where its branch started: its commits
 * since and the diff of its files, untracked ones included as added. */
export async function worktreeDiff(dir: string, pulls: PullBases = {}): Promise<WorktreeDiff> {
  // Listed alongside the summary, which doesn't list every file.
  const listing = untracked(dir);
  listing.catch(() => {});
  const [summary, from, born] = await inspect(dir, pulls);
  const result: WorktreeDiff = { ...summary, commits: [], diff: "", omitted: 0, baseOptions: [], chosenBase: null };
  if (summary.error) return result;
  try {
    const [options, chosen, log, diff, others] = await Promise.all([
      baseOptions(dir, summary.branch),
      summary.branch ? git(dir, ["config", "--get", `branch.${summary.branch}.gh-merge-base`], [1]) : "",
      born ? git(dir, ["log", "-z", "--format=%h %s", `${from}..HEAD`]) : "",
      git(dir, [...DIFF, "--find-renames", `--unified=${CONTEXT}`, from]),
      listing,
    ]);
    result.baseOptions = options;
    result.chosenBase = chosen.trim() || null;
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
