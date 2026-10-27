// Putting together what the watcher found: the poller's report with the
// server's own checks, and the title it gives the watch workspace.

import type { Item } from "./inbox.ts";
import type { Herdr, Section, Watched } from "./state.ts";

// What one of the server's own checks found: its section, or null to
// show none, and its inbox items, by its title.
export type Found = { title: string; section: Section | null; items: Item[] };

/** Returns watched, what the poller last reported, if anything, with
 * found, what the server's checks found, in that order after the
 * poller's pull requests, in place of any it reported by their titles.
 * Without a report, it is when the first section was checked. */
export function withFound(watched: Watched | null, found: Found[]): Watched {
  const titles = new Set(found.map((f) => f.title));
  const sections = (Array.isArray(watched?.sections) ? (watched.sections as Section[]) : []).filter(
    (s) => !titles.has(s.title),
  );
  const after = sections.findIndex((s) => s.title === "Pull requests") + 1;
  const ours = found.flatMap((f) => (f.section ? [f.section] : []));
  const inbox = watched?.inbox && typeof watched.inbox === "object" ? watched.inbox : {};
  return {
    ...watched,
    sections: [...sections.slice(0, after), ...ours, ...sections.slice(after)],
    inbox: { ...inbox, ...Object.fromEntries(found.map((f) => [f.title, f.items])) },
    at: watched?.at ?? ours[0]?.at ?? new Date().toISOString(),
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
