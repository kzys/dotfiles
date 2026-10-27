// Watching the user's pull requests on GitHub and telling the user, and
// the Herdr agent working on each one, when its checks, review or state
// change.

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { Item } from "./inbox.ts";
import { type NotesText, type Owner, escapeRegExp, notesTexts, ownedItem, pad, projectName } from "./owners.ts";
import { type HerdrPane, paneCwd } from "./panes.ts";
import { day } from "./slack.ts";
import type { PullRequest, Run } from "./state.ts";
import { loadState, saveState } from "./statefile.ts";

const QUERY = `
query($q: String!, $open: String!) {
  open: search(query: $open, type: ISSUE, first: 50) { ...pullRequests }
  search(query: $q, type: ISSUE, first: 50) { ...pullRequests }
}

fragment pullRequests on SearchResultItemConnection {
    nodes {
      ... on PullRequest {
        number title url state isDraft headRefName reviewDecision
        repository { nameWithOwner }
        headRepository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup {
          state
          contexts(first: 100) { nodes {
            __typename
            ... on CheckRun { name conclusion detailsUrl }
            ... on StatusContext { context state targetUrl }
          } }
        } } } }
      }
    }
}
`;

// Check run conclusions and status states that count as failures.
const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);

const MARKS: Record<string, string> = { SUCCESS: "✓", FAILURE: "✗", ERROR: "✗", PENDING: "…", EXPECTED: "…" };

// How each check run conclusion or status state counts; anything else,
// such as a check run without a conclusion yet, is still running.
const RUN_STATES: Record<string, Run["state"]> = {
  ...Object.fromEntries([...FAILED].map((s) => [s, "failed" as const])),
  SUCCESS: "passed", NEUTRAL: "skipped", SKIPPED: "skipped", CANCELLED: "cancelled", STALE: "cancelled",
};

// A pull request as GitHub's search finds it: its url, repo
// ("owner/name"), the repo its branch is in (head, the same unless from
// a fork), state (OPEN, MERGED or CLOSED), the rollup state of its checks,
// or null without checks, the names of failed checks, each check and
// its review decision.
export type Pull = {
  url: string;
  repo: string;
  head: string;
  number: number;
  title: string;
  branch: string;
  state: string;
  draft: boolean;
  checks: string | null;
  failed: string[];
  runs: Run[];
  review: string | null;
};

// What changed about a pull request: the message, and whether the agent
// working on it should act on it.
export type Change = [pr: Pull, message: string, wake: boolean];

// What the state file keeps of each open pull request, by url.
export type Seen = Record<string, { state: string; checks: string | null; review: string | null }>;

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Returns the checks in contexts, from a commit's status check rollup,
 * with their name, state and url, or null, sorted by name. */
export function runs(contexts: any[]): Run[] {
  return contexts
    .map((c) => ({
      name: c.name || c.context || "?",
      state: RUN_STATES[c.conclusion || c.state] ?? "running",
      url: c.detailsUrl || c.targetUrl || null,
    }))
    .sort((a, b) => byString(a.name, b.name));
}

/** Returns the GitHub search for the user's pull requests updated since
 * the date since, or only the open ones if onlyOpen, most recently
 * updated first, in any of orgs, or anywhere without orgs. */
export function searchQuery(since: Date, orgs: string[] = [], onlyOpen = false): string {
  return [
    "is:pr author:@me archived:false", ...(onlyOpen ? ["is:open"] : []), ...orgs.map((o) => `org:${o}`),
    `updated:>=${day(since)} sort:updated-desc`,
  ].join(" ");
}

/** Returns two searches for the user's pull requests updated in the last
 * days days in any of orgs, or anywhere without orgs, each most recently
 * updated first, as GitHub's GraphQL API returns them: open, the open
 * ones, and search, all of them, including merged and closed ones, which
 * may push the open ones out. Raises if command, gh, fails, with its
 * error rather than the query. */
export async function fetch(command = "gh", orgs: string[] = [], days = 14): Promise<any> {
  const since = new Date(Date.now() - days * 86400_000);
  try {
    const { stdout } = await promisify(execFile)(
      command,
      ["api", "graphql", "-f", `query=${QUERY}`, "-f", `q=${searchQuery(since, orgs)}`,
       "-f", `open=${searchQuery(since, orgs, true)}`],
      { maxBuffer: 64 << 20, timeout: 120_000 },
    );
    return JSON.parse(stdout);
  } catch (e: any) {
    if (e instanceof SyntaxError) throw e;
    throw new Error(String(e.stderr ?? "").trim() || (e.killed ? "gh took too long" : `gh exited with ${e.code}`));
  }
}

/** Returns the pull requests in data, a response from fetch, the open ones
 * first, each pull request once. */
export function pullRequests(data: any): Pull[] {
  const prs: Pull[] = [];
  const seen = new Set<string>();
  const nodes = ["open", "search"].flatMap((part) => data?.data?.[part]?.nodes ?? []);
  for (const node of nodes) {
    if (!node?.url || seen.has(node.url)) continue;
    seen.add(node.url);
    const commits = node.commits?.nodes?.length ? node.commits.nodes : [{}];
    const rollup = commits[0]?.commit?.statusCheckRollup ?? {};
    const contexts: any[] = rollup.contexts?.nodes ?? [];
    const failed = [
      ...new Set(contexts.filter((c) => FAILED.has(c.conclusion || c.state)).map((c) => c.name || c.context || "?")),
    ].sort(byString);
    prs.push({
      url: node.url,
      repo: node.repository.nameWithOwner,
      head: (node.headRepository ?? node.repository).nameWithOwner,
      number: node.number,
      title: node.title,
      branch: node.headRefName,
      state: node.state,
      draft: node.isDraft,
      checks: rollup.state ?? null,
      failed,
      runs: runs(contexts),
      review: node.reviewDecision ?? null,
    });
  }
  return prs;
}

/** Returns the "owner/name" of the GitHub repository at remote url, or
 * null if it isn't on GitHub. */
export function repoName(url: string): string | null {
  return url.trim().match(/^(?:https:\/\/|ssh:\/\/git@|git@)github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null;
}

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

/** Returns pr's short name, like name#N. */
export function label(pr: Pull): string {
  return `${pr.repo.split("/")[1]}#${pr.number}`;
}

/** Returns the message saying pr's checks failed. */
export function failure(pr: Pull): string {
  return "checks failed" + (pr.failed.length ? `: ${pr.failed.join(", ")}` : "");
}

/** Returns what changed in prs since old, the state that remember
 * returned last time. With no old state nothing has changed. A pull
 * request seen for the first time counts as changed if its checks
 * failed. */
export function events(old: Seen | null, prs: Pull[]): Change[] {
  if (!old) return [];
  const out: Change[] = [];
  for (const pr of prs) {
    const before = old[pr.url];
    if (!before) {
      if (pr.state === "OPEN" && FAILED.has(pr.checks ?? "")) out.push([pr, failure(pr), true]);
      continue;
    }
    if (pr.state !== before.state) {
      out.push([pr, pr.state.toLowerCase(), false]);
      continue;
    }
    if (pr.state !== "OPEN") continue;
    if (pr.checks !== before.checks) {
      if (FAILED.has(pr.checks ?? "")) out.push([pr, failure(pr), true]);
      else if (pr.checks === "SUCCESS") out.push([pr, "checks passed", false]);
    }
    if (pr.review !== before.review && (pr.review === "APPROVED" || pr.review === "CHANGES_REQUESTED"))
      out.push([pr, pr.review.toLowerCase().replace("_", " "), false]);
  }
  return out;
}

/** Returns the state to compare the next prs with: old updated with prs,
 * without pull requests that are no longer open. */
export function remember(old: Seen | null, prs: Pull[]): Seen {
  const state: Seen = { ...old };
  for (const pr of prs) state[pr.url] = { state: pr.state, checks: pr.checks, review: pr.review };
  return Object.fromEntries(Object.entries(state).filter(([, s]) => s.state === "OPEN"));
}

/** Returns what to tell the agent working on pr about message. */
export function wakeMessage(pr: Pull, message: string): string {
  return `${pr.url} ${message}. Look into it, fix it if it is caused by the change, and update your notes.`;
}

// An open pull request as the page lists it.
export type Row = Pull & PullRequest;

/** Returns the open pull requests in prs, those with projects first, with
 * their label, the name of their project from owners (by url) or null,
 * whether an agent pane works on them, from panes (by url), and the id
 * of the pane in their checkout, from checkouts (by url), or null. Only
 * that pane surely works on them; others may be any agent in their
 * project. */
export function listed(
  prs: Pull[],
  owners: Record<string, Owner | null>,
  panes: Record<string, HerdrPane | null>,
  checkouts: Record<string, HerdrPane> = {},
): Row[] {
  const rows = prs
    .filter((pr) => pr.state === "OPEN")
    .map((pr) => {
      const found = owners[pr.url];
      return {
        ...pr,
        label: label(pr),
        project: found ? projectName(found.project) : null,
        agent: !!panes[pr.url],
        pane: checkouts[pr.url]?.pane_id ?? null,
      };
    });
  return rows.sort((a, b) => Number(a.project === null) - Number(b.project === null));
}

/** Returns lines listing rows, as listed returns them, with their checks,
 * project and whether an agent pane works on them. */
export function table(rows: Row[]): string[] {
  return rows.map(
    (r) =>
      `${MARKS[r.checks ?? ""] ?? " "} ${r.agent ? "●" : " "} ${pad(r.label, 24)} ${pad(r.project ?? "", 20)} ` +
      `${r.title}${r.draft ? " (draft)" : ""}`,
  );
}

/** Returns inbox items for the open pull requests in prs that wait on the
 * user: those whose checks failed, that have changes requested, or that
 * are approved with passing checks, with projects from owners. */
export function waitingItems(prs: Pull[], owners: Record<string, Owner | null>): Item[] {
  return prs.flatMap((pr) => {
    if (pr.state !== "OPEN") return [];
    let message: string;
    if (FAILED.has(pr.checks ?? "")) message = failure(pr);
    else if (pr.review === "CHANGES_REQUESTED") message = "changes requested";
    else if (pr.review === "APPROVED" && (pr.checks === "SUCCESS" || pr.checks === null) && !pr.draft)
      message = "approved, ready to merge";
    else return [];
    return [ownedItem(owners[pr.url], "pr", `${label(pr)} ${message}: ${pr.title}`)];
  });
}

// What poll needs of Herdr.
export type PollHerdr = {
  panes: () => Promise<HerdrPane[]>;
  notify: (title: string, body: string, sound: "request" | "done") => Promise<unknown>;
  // Types text into the pane with id and presses Enter.
  run: (id: string, text: string) => Promise<unknown>;
};

/** Checks the pull requests once, those in orgs or all without orgs, as
 * fetchPrs finds them: tells the user and their agents through herdr
 * about changes since the state in path, saves the new state there, and
 * returns the lines of table, the projects of the pull requests by url,
 * the inbox items of waitingItems, the rows of listed and the URLs of
 * the pull requests the state keeps as open, including those the search
 * no longer finds. The projects are under root. */
export async function poll(
  herdr: PollHerdr,
  root: string,
  path: string,
  orgs: string[] = [],
  fetchPrs: (orgs: string[]) => Promise<any> = (o) => fetch("gh", o),
): Promise<{ lines: string[]; owners: Record<string, Owner | null>; items: Item[]; rows: Row[]; urls: string[] }> {
  const loaded = loadState(path);
  const old = loaded && typeof loaded === "object" ? (loaded as Seen) : null;
  const prs = pullRequests(await fetchPrs(orgs));
  const [trees, texts, panes] = [await worktrees(root), notesTexts(root), await herdr.panes()];
  const owners = Object.fromEntries(prs.map((pr) => [pr.url, owner(pr, trees, texts)]));
  // An agent in a checkout on the branch, wherever it is, surely works on
  // the pull request; one in its project only may.
  const checkouts = await checkoutPanes(panes, prs.filter((pr) => pr.state === "OPEN"));
  const byUrl: Record<string, HerdrPane | null> = {
    ...Object.fromEntries(Object.entries(owners).map(([url, f]) => [url, f && agentPane(panes, f)])),
    ...checkouts,
  };
  for (const [pr, message, wake] of events(old, prs)) {
    const found = owners[pr.url];
    const where = found ? ` (${basename(found.project)})` : "";
    await herdr.notify(`${label(pr)} ${message}`, `${pr.title}${where}`, wake ? "request" : "done").catch(() => {});
    const pane = byUrl[pr.url];
    if (wake && pane && (pane.agent_status === "idle" || pane.agent_status === "done"))
      await herdr.run(pane.pane_id, wakeMessage(pr, message)).catch(() => {});
  }
  const seen = remember(old, prs);
  saveState(path, seen);
  const rows = listed(prs, owners, byUrl, checkouts);
  return { lines: table(rows), owners, items: waitingItems(prs, owners), rows, urls: Object.keys(seen) };
}

/** Returns the text of the watcher's pane for the section titled title,
 * checked at at, with lines: a line naming it and when, in local time,
 * then lines. */
export function screen(title: string, at: Date, lines: string[]): string {
  return [`${title} at ${at.toTimeString().slice(0, 5)}`, ...lines].join("\n");
}
