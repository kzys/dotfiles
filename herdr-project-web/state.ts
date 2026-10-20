// Reading what the watcher and the agents' notes say into one state
// for the page.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Item, frontMatter, projectItems, watchedItems } from "./inbox.ts";
import { isCheckout, worktreeDirs } from "./worktrees.ts";

// A check of a pull request's latest commit.
export type Run = {
  name: string;
  state: "passed" | "failed" | "running" | "skipped" | "cancelled";
  url: string | null;
};

// An open pull request as the watcher lists it.
export type PullRequest = {
  url: string;
  repo: string;
  number: number;
  label: string;
  title: string;
  draft: boolean;
  // The rollup state of its checks, like SUCCESS, or null without any.
  checks: string | null;
  failed: string[];
  // Each check, from watchers that keep them.
  runs?: Run[];
  review: string | null;
  project: string | null;
  agent: boolean;
  // The agent's pane, from watchers that keep it.
  pane?: string | null;
};

export type Section = {
  title: string;
  at: string | null;
  // When the watcher checks again, from watchers that say.
  next?: string | null;
  lines: string[];
  // The pull requests the lines list, if the section is about them.
  pullRequests?: PullRequest[];
  // What the lines list, if the section is about Slack or Linear.
  entries?: Entry[];
};

// A Slack conversation or a Linear issue.
export type Entry = {
  // Its channel or identifier.
  label: string;
  title: string;
  // What is pending, if title doesn't say.
  note?: string;
  // Its state, like In Progress, if it has one.
  detail?: string;
  url: string | null;
  waiting: boolean;
  // Whether Claude finds nothing left for the user in it, from watchers
  // that say.
  done?: boolean;
  project: string | null;
};

export type Project = {
  dir: string;
  name: string;
  title: string;
  // The labels of the Herdr workspaces with panes in dir.
  workspaces: string[];
  // The git worktrees and checkouts directly in dir, followed by the
  // checkouts in ~/repos it works in.
  worktrees: string[];
  items: Item[];
};

// What herdr workspace list and herdr pane list say, in part.
export type Herdr = {
  workspaces: { workspace_id: string; label?: string }[];
  panes: {
    pane_id: string;
    workspace_id: string;
    cwd?: string;
    foreground_cwd?: string;
    agent?: string | null;
    agent_status?: string;
  }[];
};

export type State = {
  // The watcher's sections, or null if it hasn't written any.
  sections: Section[] | null;
  // When the watcher last wrote them, in ISO 8601.
  watchedAt: string | null;
  projects: Project[];
  // What the watcher found that belongs to no project.
  unowned: Item[];
  // The URLs of the open pull requests by their labels, like name#N.
  links: Record<string, string>;
  // What each agent pane in Herdr is doing, like working or idle, by id,
  // or null if Herdr couldn't be asked.
  agents: Record<string, string> | null;
};

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJSON(path: string): unknown {
  const text = read(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Returns the project directories under root, newest name first, as
 * the ~/project convention dates them, skipping hidden ones. */
export function projectDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => join(root, e.name))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Returns the projects under root that aren't closed, newest first,
 * each with its README.md, or null if it has none. */
export function openProjects(root: string): [string, string | null][] {
  return projectDirs(root).flatMap((dir): [string, string | null][] => {
    const readme = read(join(dir, "README.md"));
    return readme !== null && frontMatter(readme, "closed") ? [] : [[dir, readme]];
  });
}

/** Returns the URLs of the pull requests in prs, what the watcher kept
 * in pull-requests.json, by their labels: owner/name#N, and name#N as
 * the watcher shows them, unless two share it. */
export function pullRequestLinks(prs: unknown): Record<string, string> {
  const links: Record<string, string> = {};
  if (!prs || typeof prs !== "object") return links;
  const shared = new Set<string>();
  for (const url of Object.keys(prs)) {
    const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
    if (!m) continue;
    links[`${m[1]}/${m[2]}#${m[3]}`] = url;
    const short = `${m[2]}#${m[3]}`;
    if (links[short] && links[short] !== url) shared.add(short);
    links[short] = url;
  }
  for (const label of shared) delete links[label];
  return links;
}

/** Returns the agents' notes in directory as [role, text] pairs. */
function roleNotes(directory: string): [string, string][] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith("AGENT-") && n.endsWith(".md"))
    .sort()
    .flatMap((n): [string, string][] => {
      const text = read(join(directory, n));
      return text === null ? [] : [[n.slice("AGENT-".length, -".md".length), text]];
    });
}

/** Returns the checkouts in home's ~/repos, laid out as
 * repos/<org>/<repo>, that text names as ~/repos/<org>/<repo> or by
 * their full paths, each once, in the order it names them. */
export function namedCheckouts(text: string, home: string): string[] {
  const at = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dirs = [...text.matchAll(new RegExp(String.raw`(?:~|${at})/repos/([\w.-]+)/([\w.-]+)`, "g"))]
    .map((m) => [m[1], m[2].replace(/\.+$/, "")])
    .filter((names) => names.every((n) => n && !n.startsWith(".")))
    .map(([org, repo]) => join(home, "repos", org, repo));
  return [...new Set(dirs)];
}

/** Returns the labels of the workspaces in herdr with a pane in dir or
 * under it, in the order herdr lists them. */
export function workspaceLabels(dir: string, herdr: Herdr | null): string[] {
  if (!herdr) return [];
  const inside = (cwd?: string) => !!cwd && (cwd === dir || cwd.startsWith(dir + "/"));
  const ids = new Set(
    herdr.panes.filter((p) => inside(p.cwd) || inside(p.foreground_cwd)).map((p) => p.workspace_id),
  );
  return herdr.workspaces
    .filter((w) => ids.has(w.workspace_id))
    .map((w) => w.label || w.workspace_id);
}

/** Returns what each agent pane in herdr is doing, by id, or null if
 * herdr is. Other panes have none. */
export function agentStates(herdr: Herdr | null): Record<string, string> | null {
  if (!herdr) return null;
  const agents: Record<string, string> = {};
  for (const p of herdr.panes) if (p.agent && p.agent_status) agents[p.pane_id] = p.agent_status;
  return agents;
}

/** Returns the state for the page from the watcher's files in stateDir
 * and the open projects under projectRoot, naming their workspaces in
 * herdr, if known. Projects with a workspace or something waiting on the
 * user come first, newest first within each group. The checkouts a
 * project works in are those in home's ~/repos that the "repositories"
 * field of its README.md names, or else that it or its notes name. */
export function readState(
  stateDir: string,
  projectRoot: string,
  herdr: Herdr | null = null,
  home: string = homedir(),
): State {
  const raw = readJSON(join(stateDir, "screen.json"));
  const sections = Array.isArray(raw) ? (raw as Section[]) : null;
  let watchedAt: string | null = null;
  try {
    watchedAt = statSync(join(stateDir, "screen.json")).mtime.toISOString();
  } catch {}

  const open = openProjects(projectRoot);
  const known = new Set(open.map(([dir]) => dir));
  const byProject = new Map<string, Item[]>();
  const unowned: Item[] = [];
  for (const item of watchedItems(readJSON(join(stateDir, "inbox.json")))) {
    // Items of projects since removed or closed belong to none.
    if (item.project === null || !known.has(item.project)) unowned.push(item);
    else byProject.set(item.project, [...(byProject.get(item.project) ?? []), item]);
  }

  const projects: Project[] = [];
  for (const [dir, readme] of open) {
    const notes = roleNotes(dir);
    const items = projectItems(dir, readme, notes, byProject.get(dir) ?? []);
    const named =
      (readme && frontMatter(readme, "repositories")) || [readme ?? "", ...notes.map(([, t]) => t)].join("\n");
    projects.push({
      dir,
      name: (readme && frontMatter(readme, "name")) || dir.split("/").pop()!,
      title: (readme && frontMatter(readme, "title")) || "(no title)",
      workspaces: workspaceLabels(dir, herdr),
      worktrees: [...worktreeDirs(dir), ...namedCheckouts(named, home).filter(isCheckout)],
      items,
    });
  }
  const quiet = (p: Project) => !p.workspaces.length && !p.items.length;
  projects.sort((a, b) => Number(quiet(a)) - Number(quiet(b)));
  const links = pullRequestLinks(readJSON(join(stateDir, "pull-requests.json")));
  return { sections, watchedAt, projects, unowned, links, agents: agentStates(herdr) };
}
