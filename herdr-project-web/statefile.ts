// Keeping what a check saw last in a JSON file.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Returns the state kept in path, or null if there is none or it can't
 * be read. */
export function loadState(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Keeps state in path, replacing it whole so that a check after a failed
 * write never sees half of it. */
export function saveState(path: string, state: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 1));
  renameSync(`${path}.tmp`, path);
}
