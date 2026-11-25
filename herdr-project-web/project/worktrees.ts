// Finding the git worktrees and checkouts in the projects, and their last
// commits.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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
