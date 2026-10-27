// Putting together what the watcher's checks found, and the title it
// gives the watch workspace.

import type { Item } from "./inbox.ts";
import type { Herdr, Section, Watched } from "./state.ts";

// What one of the checks found: its section, or null to show none, and
// its inbox items, by its title.
export type Found = { title: string; section: Section | null; items: Item[] };

/** Returns what the checks found, found, in that order, with urls, those
 * of the open pull requests. It is when the first section was checked. */
export function watchedFrom(found: Found[], urls: string[]): Watched {
  const sections = found.flatMap((f) => (f.section ? [f.section] : []));
  return {
    sections,
    inbox: Object.fromEntries(found.map((f) => [f.title, f.items])),
    urls,
    at: sections[0]?.at ?? new Date().toISOString(),
  };
}

/** Returns the title for the watcher's workspace from inbox, the inbox
 * items by source: how many wait on the user from each. */
export function title(inbox: unknown): string {
  const counts = Object.entries(inbox && typeof inbox === "object" ? inbox : {})
    .filter(([, found]) => Array.isArray(found) && found.length)
    .map(([source, found]) => `${source}: ${found.length}`);
  return counts.join(" · ") || "Nothing waiting";
}

/** Returns the id of the Herdr workspace named watch that the pane in
 * env runs in, by herdr, or null. Only that one takes the watcher's
 * title. */
export function watchWorkspace(env: NodeJS.ProcessEnv, herdr: Herdr | null): string | null {
  const id = env.HERDR_WORKSPACE_ID;
  if (!env.HERDR_PANE_ID || !id || !herdr) return null;
  return herdr.workspaces.some((w) => w.workspace_id === id && w.label === "watch") ? id : null;
}
