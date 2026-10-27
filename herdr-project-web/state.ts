// Reading what the watcher and the agents' notes say into one state
// for the page.

import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FULL_AT, type Item, frontMatter, projectItems, watchedItems } from "./inbox.ts";
import { isCheckout, lastSubject, worktreeDirs } from "./worktrees.ts";

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

// A worktree or checkout, with the subject of its last commit, if git
// can say.
export type Worktree = { dir: string; subject: string | null };

// An agent's pane in Herdr.
export type Pane = {
  id: string;
  role: string | null;
  // What Herdr says the agent is doing, like working or idle.
  status: string | null;
  // How full its context is, in percent, if it says.
  ctx: number | null;
};

export type Project = {
  dir: string;
  name: string;
  title: string;
  // The labels of the Herdr workspaces with panes in dir.
  workspaces: string[];
  // The git worktrees and checkouts directly in dir, followed by the
  // checkouts in ~/repos it works in.
  worktrees: Worktree[];
  // The agent panes in Herdr working in dir.
  panes: Pane[];
  items: Item[];
  // The files directly in dir, as projectFiles lists them.
  files: ProjectFile[];
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
    // What the agent's status line reports, like its role and ctx.
    tokens?: Record<string, string>;
  }[];
};

// What the watcher last reported: its sections and its inbox items by
// source, in the form it sends them, and when, in ISO 8601.
export type Watched = { sections: unknown; inbox: unknown; at: string };

export type State = {
  // The watcher's sections, or null if it hasn't reported any.
  sections: Section[] | null;
  // When the watcher last reported them, in ISO 8601.
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

/** Returns the projects under root that aren't closed, or still have a
 * workspace in herdr, newest first, each with its README.md, or null if
 * it has none. */
export function openProjects(root: string, herdr: Herdr | null = null): [string, string | null][] {
  return projectDirs(root).flatMap((dir): [string, string | null][] => {
    const readme = read(join(dir, "README.md"));
    const closed = readme !== null && frontMatter(readme, "closed");
    return closed && !workspaceLabels(dir, herdr).length ? [] : [[dir, readme]];
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

// A file of a project and when it last changed, in milliseconds since
// the epoch.
export type ProjectFile = { name: string; at: number };

// The most of a file the page shows.
const MAX_FILE = 1 << 20;

// Files the agents' status lines leave for the picker, not for people.
const USAGE = /^(claude|codex)-.*\.json$/;

/** Returns the regular files directly in the project in directory,
 * hidden ones and USAGE files left out: its README.md, then its agents'
 * AGENT-<role>.md, then the others by name. Symbolic links are left
 * out too, since they can point outside the project. */
export function projectFiles(directory: string): ProjectFile[] {
  let names: string[];
  try {
    names = readdirSync(directory).filter((n) => !n.startsWith(".") && !USAGE.test(n));
  } catch {
    return [];
  }
  const order = (n: string) => (n === "README.md" ? 0 : n.startsWith("AGENT-") && n.endsWith(".md") ? 1 : 2);
  return names
    .sort((a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0))
    .flatMap((name) => {
      try {
        const st = lstatSync(join(directory, name));
        return st.isFile() ? [{ name, at: st.mtimeMs }] : [];
      } catch {
        return [];
      }
    });
}

/** Returns the text of the file called name in directory if
 * projectFiles lists it, or else null; or why it isn't shown, if it is
 * larger than the page shows, not text or can't be read. It reads what
 * it opened, so the file can't turn into a link, a pipe or a larger
 * file meanwhile. */
export function readProjectFile(directory: string, name: string): { text: string } | { error: string } | null {
  if (!projectFiles(directory).some((f) => f.name === name)) return null;
  let fd: number;
  try {
    fd = openSync(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EACCES" ? { error: "It can't be read." } : null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    // One byte more than shown tells a file that is too large.
    const buf = Buffer.alloc(MAX_FILE + 1);
    let n = 0;
    for (let got; n < buf.length && (got = readSync(fd, buf, n, buf.length - n, null)) > 0; ) n += got;
    if (n > MAX_FILE) return { error: "It is too large to show." };
    const bytes = buf.subarray(0, n);
    if (bytes.subarray(0, 8192).includes(0)) return { error: "It isn't text." };
    return { text: bytes.toString("utf8") };
  } catch {
    return { error: "It can't be read." };
  } finally {
    closeSync(fd);
  }
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

/** Returns the panes in herdr working in dir or under it, in the order
 * herdr lists them, by the directory their agent reports, as the watcher
 * reads it, else Herdr's. */
function panesIn(dir: string, herdr: Herdr | null): Herdr["panes"] {
  if (!herdr) return [];
  const inside = (cwd?: string) => !!cwd && (cwd === dir || cwd.startsWith(dir + "/"));
  return herdr.panes.filter((p) => inside(p.tokens?.cwd || p.cwd) || inside(p.foreground_cwd));
}

/** Returns the agent panes in herdr working in dir or under it, in the
 * order herdr lists them, with how full each one's context is, as
 * herdr_project/panes.py reads it. A background session reports to the
 * pane that started it, flagging that with the bg token, so then the ctx
 * isn't the pane's own. */
export function projectPanes(dir: string, herdr: Herdr | null): Pane[] {
  return panesIn(dir, herdr)
    .filter((p) => p.agent)
    .map((p) => {
      const ctx = p.tokens?.bg ? "" : (p.tokens?.ctx ?? "");
      return {
        id: p.pane_id,
        role: p.tokens?.role || null,
        status: p.agent_status ?? null,
        ctx: /^\d+%*$/.test(ctx) ? parseInt(ctx, 10) : null,
      };
    });
}

/** Returns lines, the watcher's lines about panes, without those about
 * the panes with ids, named after the first field, and without saying
 * there are none. */
export function panesElsewhere(lines: string[], ids: Set<string>): string[] {
  return lines.filter((l) => l !== "Nothing to clean up." && !ids.has(l.match(/^\s*\S+\s+(\S+)/)?.[1] ?? ""));
}

/** Returns what each agent pane in herdr is doing, by id, or null if
 * herdr is. Other panes have none. */
export function agentStates(herdr: Herdr | null): Record<string, string> | null {
  if (!herdr) return null;
  const agents: Record<string, string> = {};
  for (const p of herdr.panes) if (p.agent && p.agent_status) agents[p.pane_id] = p.agent_status;
  return agents;
}

/** Returns the state for the page from watched, what the watcher last
 * reported, its pull requests in stateDir, and the projects under projectRoot that are open or still have a
 * workspace in herdr, naming their workspaces, if known. Projects with an agent whose context is at least
 * FULL_AT percent full come first, then those with a workspace or
 * something waiting on the user, newest first within each group. The
 * watcher's Panes section keeps only panes outside the listed projects,
 * and goes if none are left. The checkouts a project works in are those
 * in home's ~/repos that the "repositories" field of its README.md
 * names, or else that it or its notes name. */
export function readState(
  watched: Watched | null,
  stateDir: string,
  projectRoot: string,
  herdr: Herdr | null = null,
  home: string = homedir(),
): State {
  // Copies, since the Panes section is trimmed below.
  const sections = Array.isArray(watched?.sections) ? (watched.sections as Section[]).map((s) => ({ ...s })) : null;
  const watchedAt = watched?.at ?? null;

  const open = openProjects(projectRoot, herdr);
  const known = new Set(
    open.filter(([, readme]) => !(readme && frontMatter(readme, "closed"))).map(([dir]) => dir),
  );
  const byProject = new Map<string, Item[]>();
  const unowned: Item[] = [];
  for (const item of watchedItems(watched?.inbox)) {
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
      panes: projectPanes(dir, herdr),
      worktrees: [...worktreeDirs(dir), ...namedCheckouts(named, home).filter(isCheckout)].map((d) => ({
        dir: d,
        subject: lastSubject(d),
      })),
      items,
      files: projectFiles(dir),
    });
  }
  const rank = (p: Project) =>
    p.panes.some((pane) => (pane.ctx ?? 0) >= FULL_AT) ? 0 : p.workspaces.length || p.items.length ? 1 : 2;
  projects.sort((a, b) => rank(a) - rank(b));
  // The panes in projects show with them, and the section only when
  // others are left.
  const ids = new Set(projects.flatMap((p) => panesIn(p.dir, herdr).map((pane) => pane.pane_id)));
  for (const section of sections ?? [])
    if (section.title === "Panes") section.lines = panesElsewhere(section.lines, ids);
  const shown = sections?.filter((s) => s.title !== "Panes" || s.lines.length) ?? null;
  const links = pullRequestLinks(readJSON(join(stateDir, "pull-requests.json")));
  return { sections: shown, watchedAt, projects, unowned, links, agents: agentStates(herdr) };
}
