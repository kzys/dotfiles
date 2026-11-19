// Finding the project, and the Herdr agent, working on each pull request:
// by a checkout on its branch, or by the notes that mention it.

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { type NotesText, type Owner, escapeRegExp } from "../owners.ts";
import { type HerdrPane, paneCwd } from "../panes.ts";
import { type PullRequest as Pull, byString, repoName } from "./pullrequest.ts";

/** Returns what git with args prints in directory d, trimmed, or "" if it
 * fails or takes over 10 seconds, as on a stuck mount. */
async function git(d: string, ...args: string[]): Promise<string> {
  try {
    return (await promisify(execFile)("git", ["-C", d, ...args], { timeout: 10_000 })).stdout.trim();
  } catch {
    return "";
  }
}

// A git checkout's branch and repo ("owner/name" of origin, or null).
type Checkout = { branch: string; repo: string | null };

/** Returns the git checkout directory d is in, or null if it isn't in
 * one or is on no branch. */
async function checkout(d: string): Promise<Checkout | null> {
  const branch = await git(d, "branch", "--show-current");
  if (!branch) return null;
  return { branch, repo: repoName(await git(d, "remote", "get-url", "origin")) };
}

/** Returns the agent panes in panes that work in a checkout of a pull
 * request in prs on its branch, by the pull request's url, the first pane
 * for each. The checkout's origin must be the repository the branch is
 * in, so that a fork's branch doesn't match the upstream's branch of the
 * same name. */
export async function checkoutPanes(panes: HerdrPane[], prs: Pull[]): Promise<Record<string, HerdrPane>> {
  const found: Record<string, HerdrPane> = {};
  const seen = new Map<string, Promise<Checkout | null>>();
  for (const p of panes) {
    const d = paneCwd(p);
    if (!p.agent || !d) continue;
    if (!seen.has(d)) seen.set(d, checkout(d));
    const c = await seen.get(d)!;
    for (const pr of c ? prs : [])
      if (c!.branch === pr.branch && (c!.repo ?? "").toLowerCase() === pr.head.toLowerCase()) found[pr.url] ??= p;
  }
  return found;
}

// A git checkout directly in a project.
export type Tree = { project: string; dir: string } & Checkout;

/** Returns the git checkouts directly in the projects under root, skipping
 * hidden ones, in order of their paths. */
export async function worktrees(root: string): Promise<Tree[]> {
  const list = (d: string) => {
    try {
      return readdirSync(d).filter((n) => !n.startsWith(".")).sort(byString);
    } catch {
      return [];
    }
  };
  const dirs = list(root).flatMap((p) => list(join(root, p)).map((n) => [join(root, p), join(root, p, n)]));
  const trees: Tree[] = [];
  for (const [project, dir] of dirs) {
    if (!existsSync(join(dir, ".git"))) continue;
    const branch = await git(dir, "branch", "--show-current");
    if (branch) trees.push({ project, dir, branch, repo: repoName(await git(dir, "remote", "get-url", "origin")) });
  }
  return trees;
}

/** Reports whether text mentions pr by its url, as owner/name#N or as
 * name#N. */
export function mentions(text: string, pr: Pull): boolean {
  const name = pr.repo.split("/")[1];
  return new RegExp(
    `${escapeRegExp(pr.url)}(?!\\d)|(?<![\\w.-])(?:${escapeRegExp(pr.repo)}|${escapeRegExp(name)})#${pr.number}(?!\\d)`,
  ).test(text);
}

/** Returns the project working on pr: the one with a worktree on pr's
 * branch, with that worktree, else the latest whose notes in texts
 * mention pr, preferring an agent's notes, with its role. Returns null if
 * no project is. */
export function owner(pr: Pull, trees: Tree[], texts: NotesText[]): Owner | null {
  for (const t of trees)
    if (t.branch === pr.branch && (t.repo ?? "").toLowerCase() === pr.repo.toLowerCase())
      return { project: t.project, dir: t.dir, role: null };
  let found: Owner | null = null;
  for (const [project, role, text] of texts)
    // Prefer the latest project, and an agent's notes over README.md.
    if (mentions(text, pr) && (!found || project > found.project || (project === found.project && role)))
      found = { project, dir: null, role };
  return found;
}

/** Returns the pane in panes of the agent working on the pull request
 * that found owns, or null: the agent in its worktree, else the one with
 * its role, else any agent in its project. */
export function agentPane(panes: HerdrPane[], found: Owner): HerdrPane | null {
  const inside = (path: string, d: string) => path === d || path.startsWith(d.replace(/\/+$/, "") + "/");
  const inProject = panes.filter((p) => p.agent && inside(paneCwd(p), found.project));
  return (
    inProject.find((p) => found.dir && inside(paneCwd(p), found.dir)) ??
    inProject.find((p) => found.role && p.tokens?.role === found.role) ??
    inProject[0] ??
    null
  );
}

