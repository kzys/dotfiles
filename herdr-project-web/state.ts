// Reading what the watcher and the agents' notes say into one state
// for the page.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Item, frontMatter, projectItems, watchedItems } from "./inbox.ts";

export type Section = { title: string; at: string | null; lines: string[] };

export type Project = {
  dir: string;
  name: string;
  title: string;
  // The labels of the Herdr workspaces with panes in dir.
  workspaces: string[];
  items: Item[];
};

// What herdr workspace list and herdr pane list say, in part.
export type Herdr = {
  workspaces: { workspace_id: string; label?: string }[];
  panes: { workspace_id: string; cwd?: string; foreground_cwd?: string }[];
};

export type State = {
  // The watcher's sections, or null if it hasn't written any.
  sections: Section[] | null;
  // When the watcher last wrote them, in ISO 8601.
  watchedAt: string | null;
  projects: Project[];
  // What the watcher found that belongs to no project.
  unowned: Item[];
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

/** Returns the state for the page from the watcher's files in stateDir
 * and the projects under projectRoot, keeping only projects with
 * something waiting on the user, and naming their workspaces in herdr,
 * if known. */
export function readState(stateDir: string, projectRoot: string, herdr: Herdr | null = null): State {
  const raw = readJSON(join(stateDir, "screen.json"));
  const sections = Array.isArray(raw) ? (raw as Section[]) : null;
  let watchedAt: string | null = null;
  try {
    watchedAt = statSync(join(stateDir, "screen.json")).mtime.toISOString();
  } catch {}

  const open = projectDirs(projectRoot).flatMap((dir): [string, string | null][] => {
    const readme = read(join(dir, "README.md"));
    return readme !== null && frontMatter(readme, "closed") ? [] : [[dir, readme]];
  });
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
    const items = projectItems(dir, readme, roleNotes(dir), byProject.get(dir) ?? []);
    if (!items.length) continue;
    projects.push({
      dir,
      name: (readme && frontMatter(readme, "name")) || dir.split("/").pop()!,
      title: (readme && frontMatter(readme, "title")) || "(no title)",
      workspaces: workspaceLabels(dir, herdr),
      items,
    });
  }
  return { sections, watchedAt, projects, unowned };
}
