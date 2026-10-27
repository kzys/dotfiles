// Checking a source that a headless Claude session reads through its
// claude.ai connector, such as Slack or Linear.

import type { Item } from "./inbox.ts";
import type { Section } from "./state.ts";
import type { Found } from "./watched.ts";

// What a source's check returns: lines for the screen, rows for the page
// and inbox items.
export type Checked = { lines: string[]; rows: unknown[]; items: Item[] };

/** Returns what checking the source titled title found, by calling check
 * if its connector is among names, the connected ones, where last is what
 * it found before, if anything, and now tells the time. It checks again
 * intervalMs after it is done. Without the connector, there is no section and there are no
 * items. If names is null, as when listing the connectors failed, or the
 * check fails, the section says so, keeping the last items. */
export async function checkQueue(
  title: string,
  connector: string,
  names: Set<string> | null,
  check: () => Promise<Checked>,
  last: Found | null,
  now: () => Date,
  intervalMs: number,
): Promise<Found> {
  const section = (lines: string[], rows?: unknown[]): Section => {
    const at = now();
    return {
      title, at: at.toISOString(), next: new Date(at.getTime() + intervalMs).toISOString(), lines,
      ...(rows ? { entries: rows as Section["entries"] } : {}),
    };
  };
  if (names === null)
    return { title, section: section(["Cannot list the claude.ai connectors."]), items: last?.items ?? [] };
  if (!names.has(connector)) return { title, section: null, items: [] };
  try {
    const { lines, rows, items } = await check();
    return { title, section: section(lines, rows), items };
  } catch (e) {
    return { title, section: section([`Cannot check ${title}: ${String(e).split("\n")[0]}`]), items: last?.items ?? [] };
  }
}
