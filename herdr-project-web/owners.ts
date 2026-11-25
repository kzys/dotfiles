// Finding which project works on something the watcher found, from the
// projects' notes and the pull requests it links to.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Item } from "./inbox.ts";
import { projectLabels, readReadme, roleNotes } from "./project/project.ts";

// Who works on something: the project directory, the worktree in it, if
// known, and the role of the agent, if known.
export type Owner = { project: string; dir?: string | null; role?: string | null };

// A project's notes: its directory, the role whose notes they are, or
// null for README.md, and their text.
export type NotesText = [project: string, role: string | null, text: string];

/** Returns the notes of the projects under root, skipping hidden ones:
 * each README.md and AGENT-<role>.md directly in them, in order of their
 * paths. */
export function notesTexts(root: string): NotesText[] {
  const texts: NotesText[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(root).filter((n) => !n.startsWith(".")).sort();
  } catch {
    return [];
  }
  for (const name of dirs) {
    const dir = join(root, name);
    texts.push(...roleNotes(dir).map(([role, text]): NotesText => [dir, role, text]));
    const readme = readReadme(dir);
    if (readme !== null) texts.push([dir, null, readme]);
  }
  return texts;
}

/** Returns text with what regular expressions treat specially escaped. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns the Owner of something that notes mention when they match
 * pattern: the latest project whose notes in texts do, preferring an
 * agent's notes to README.md. Without one it is the project of the first
 * of links, pull request URLs, in prOwners, which maps them to projects.
 * Returns null if no project is. */
export function projectOf(
  pattern: RegExp,
  links: string[] | undefined,
  texts: NotesText[],
  prOwners: Record<string, Owner | null>,
): Owner | null {
  let found: Owner | null = null;
  for (const [project, role, text] of texts)
    if (pattern.test(text) && (!found || project > found.project || (project === found.project && role)))
      found = { project, role };
  if (found) return found;
  for (const url of links ?? []) if (prOwners[url]) return prOwners[url];
  return null;
}

/** Returns the short name of the project in dir: the name in the front
 * matter of its README.md, else the directory's name. */
export function projectName(dir: string): string {
  return projectLabels(dir, readReadme(dir)).name;
}

/** Returns the short name of the project in dir, as projectName does, from
 * texts, the projects' notes, which hold its README.md if it has one. */
export function projectNameIn(dir: string, texts: NotesText[]): string {
  return projectLabels(dir, texts.find(([project, role]) => project === dir && role === null)?.[2] ?? null).name;
}

/** Returns an inbox item for text with mark, belonging to found, or to
 * no project if found is null. */
export function ownedItem(found: Owner | null | undefined, mark: string, text: string): Item {
  return { project: found?.project ?? null, role: found?.role ?? null, mark, text };
}

/** Returns text cut to at most n characters, counting as Python does. */
export function cut(text: string, n: number): string {
  return Array.from(text).slice(0, n).join("");
}

/** Returns text padded with spaces to at least n characters, counting as
 * Python does. */
export function pad(text: string, n: number): string {
  return text + " ".repeat(Math.max(0, n - Array.from(text).length));
}
