// A project in ~/project: what its files say, the checkouts it works in,
// and where Herdr's panes show it at work.

import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { frontMatter } from "../frontmatter.ts";
import type { Herdr } from "../herdr/backend.ts";
import { type Item, projectItems } from "../inbox.ts";
import { isProject } from "../launch.ts";
import { isCheckout, lastSubject, worktreeDirs } from "./worktrees.ts";

// A worktree or checkout, with the subject of its last commit, if git
// can say.
export type Worktree = { dir: string; subject: string | null };

// An agent's pane in Herdr.
export type Pane = {
  id: string;
  // Where the agent works.
  cwd: string | null;
  role: string | null;
  // What Herdr says the agent is doing, like working or idle.
  status: string | null;
  // How full its context is, in percent, if it says.
  ctx: number | null;
  // The title its terminal shows, if any.
  title?: string;
  // What its Bash tool still runs, longest-running first, if known.
  waits?: import("../waits.ts").Wait[];
};

// What the page shows of a project.
export type ProjectView = {
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
  // How many Herdr tabs have a pane working in dir.
  tabs: number;
  items: Item[];
  // The files directly in dir, as projectFiles lists them.
  files: ProjectFile[];
};

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Returns the project directories under root, newest name first, as
 * the ~/project convention dates them, skipping those isProject doesn't
 * take for one. */
export function projectDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isProject(e.name))
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
    return closed && !workspacesIn(dir, herdr).length ? [] : [[dir, readme]];
  });
}

/** Returns the name and title of the project in dir, from the front
 * matter of readme, its README.md, if any, else its directory's name and
 * "(no title)". */
export function projectLabels(dir: string, readme: string | null): { name: string; title: string } {
  return {
    name: (readme && frontMatter(readme, "name")) || dir.split("/").pop()!,
    title: (readme && frontMatter(readme, "title")) || "(no title)",
  };
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

/** Returns the checkout in home's ~/repos, laid out as
 * repos/<org>/<repo>, that holds cwd, or null. */
export function checkoutOf(cwd: string, home: string): string | null {
  const [org, repo] = relative(join(home, "repos"), cwd).split("/");
  return org && repo && !org.startsWith(".") && !repo.startsWith(".") ? join(home, "repos", org, repo) : null;
}

/** Records in links, by project, that the project in dir works in
 * checkout, and returns whether it is news. */
export function linkCheckout(links: Record<string, string[]>, dir: string, checkout: string): boolean {
  if (links[dir]?.includes(checkout)) return false;
  links[dir] = [...(links[dir] ?? []), checkout];
  return true;
}

/** Reports whether cwd, if any, is dir or under it. */
function inside(dir: string, cwd?: string): boolean {
  return !!cwd && (cwd === dir || cwd.startsWith(dir + "/"));
}

/** Returns the labels of the workspaces in herdr with a pane in dir or
 * under it, in the order herdr lists them. */
function workspacesIn(dir: string, herdr: Herdr | null): string[] {
  if (!herdr) return [];
  const ids = new Set(
    herdr.panes.filter((p) => inside(dir, p.cwd) || inside(dir, p.foreground_cwd)).map((p) => p.workspace_id),
  );
  return herdr.workspaces
    .filter((w) => ids.has(w.workspace_id))
    .map((w) => w.label || w.workspace_id);
}

/** What the page shows of a project from its files: its README.md, if
 * any, its agents' notes, the worktrees and checkouts it works in, with
 * their last commits' subjects, and its other files. */
export type ProjectRead = {
  dir: string;
  readme: string | null;
  notes: [string, string][];
  worktrees: { dir: string; subject: string | null }[];
  files: ProjectFile[];
};

/** Reads the project in dir, whose README.md says readme. checkouts are
 * the checkouts its agents went into, which it lists. The others it works
 * in are those in home's ~/repos that the "repositories" field of its
 * README.md names, or else that it or its notes name. */
export function readProject(dir: string, readme: string | null, home: string, checkouts: string[] = []): ProjectRead {
  const notes = roleNotes(dir);
  const named = (readme && frontMatter(readme, "repositories")) || [readme ?? "", ...notes.map(([, t]) => t)].join("\n");
  const others = new Set([...namedCheckouts(named, home), ...checkouts].filter(isCheckout));
  return {
    dir,
    readme,
    notes,
    worktrees: [...worktreeDirs(dir), ...others].map((d) => ({ dir: d, subject: lastSubject(d) })),
    files: projectFiles(dir),
  };
}

/** A project as readProject read it, and where the panes in herdr show it
 * at work. */
export class Project {
  private read: ProjectRead;
  private herdr: Herdr | null;

  constructor(read: ProjectRead, herdr: Herdr | null) {
    this.read = read;
    this.herdr = herdr;
  }

  /** Returns its directory. */
  dir(): string {
    return this.read.dir;
  }

  /** Returns its name and title: see projectLabels. */
  labels(): { name: string; title: string } {
    return projectLabels(this.read.dir, this.read.readme);
  }

  /** Reports whether its README.md says it is closed. */
  closed(): boolean {
    return Boolean(this.read.readme && frontMatter(this.read.readme, "closed"));
  }

  /** Returns the labels of the workspaces in herdr with a pane in it, in
   * the order herdr lists them. */
  workspaces(): string[] {
    return workspacesIn(this.read.dir, this.herdr);
  }

  /** Returns the panes in herdr working in it, in the order herdr lists
   * them, by the directory their agent reports, as the watcher reads it,
   * else Herdr's. */
  herdrPanes(): Herdr["panes"] {
    const { dir } = this.read;
    return (this.herdr?.panes ?? []).filter((p) => inside(dir, p.tokens?.cwd || p.cwd) || inside(dir, p.foreground_cwd));
  }

  /** Returns how many tabs in herdr have a pane working in it. */
  tabs(): number {
    return new Set(this.herdrPanes().map((p) => p.tab_id)).size;
  }

  /** Returns the agent panes in herdr working in it, in the order herdr
   * lists them, with how full each one's context is. A background session
   * reports to the pane that started it, flagging that with the bg token,
   * so then the ctx isn't the pane's own. */
  panes(): Pane[] {
    return this.herdrPanes()
      .filter((p) => p.agent)
      .map((p) => {
        const ctx = p.tokens?.bg ? "" : (p.tokens?.ctx ?? "");
        return {
          id: p.pane_id,
          cwd: p.tokens?.cwd || p.cwd || null,
          role: p.tokens?.role || null,
          status: p.agent_status ?? null,
          ctx: /^\d+%*$/.test(ctx) ? parseInt(ctx, 10) : null,
          ...(p.terminal_title ? { title: p.terminal_title } : {}),
        };
      });
  }

  /** Returns what the page shows of it, with found, what the watcher found
   * for it. */
  view(found: Item[]): ProjectView {
    const { dir, notes, worktrees, files } = this.read;
    return {
      dir,
      ...this.labels(),
      workspaces: this.workspaces(),
      panes: this.panes(),
      tabs: this.tabs(),
      worktrees,
      items: projectItems(dir, this.closed(), notes, found),
      files,
    };
  }
}

/** Reads the projects under projectRoot that are open or still have a
 * workspace in herdr, newest first, as readProject does with checkouts by
 * project. */
export function readProjects(
  projectRoot: string, herdr: Herdr | null, home: string, checkouts: Record<string, string[]>,
): ProjectRead[] {
  return openProjects(projectRoot, herdr).map(([dir, readme]) => readProject(dir, readme, home, checkouts[dir]));
}
