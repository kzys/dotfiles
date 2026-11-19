// A source read every so often.

import { type Clock, Reader, type Source } from "./source.ts";

/** Returns a Source that read reads at once and then every ms after each
 * read ends, telling its listeners only of changes, as equal tells them. */
export function polled<T>(
  read: () => Promise<T>,
  options: { every: number; equal?: (a: T, b: T) => boolean; onError?: (error: unknown) => void; signal?: AbortSignal; clock?: Clock },
): Source<T> {
  return new Reader(read, options);
}
