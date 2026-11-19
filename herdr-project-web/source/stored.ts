// A value the user sets, such as where they moved a pull request on the
// board, kept in a JSON file across restarts.

import { loadState, saveState } from "../statefile.ts";
import type { Source } from "./source.ts";

/** A Source the server sets. */
export interface Stored<T> extends Source<T> {
  /** Sets it, saving it and telling listeners if it changed. */
  set(value: T): void;
}

/** Returns a Stored kept in the JSON file at path, starting from what is
 * there if valid says it is one, else from fallback. A save that fails
 * goes to onError, keeping the value set. */
export function stored<T>(
  path: string,
  valid: (value: unknown) => value is T,
  fallback: T,
  options: { onError?: (error: unknown) => void } = {},
): Stored<T> {
  const loaded = loadState(path);
  let value: T = valid(loaded) ? loaded : fallback;
  const listeners: ((value: T, before: T | null) => void)[] = [];
  return {
    current: () => value,
    onChange: (listener) => void listeners.push(listener),
    refresh: () => {},
    next: () => null,
    set(next: T) {
      if (JSON.stringify(next) === JSON.stringify(value)) return;
      const before = value;
      value = next;
      try {
        saveState(path, next);
      } catch (e) {
        options.onError?.(e);
      }
      for (const listener of listeners) listener(next, before);
    },
  };
}

/** Reports whether value is a plain object, as a JSON record is. */
export const isRecord = <T extends object>(value: unknown): value is T =>
  typeof value === "object" && value !== null && !Array.isArray(value);
