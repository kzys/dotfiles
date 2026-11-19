// A source read when something tells that it changed, such as an event
// stream, and now and then besides, for what the events don't cover.

import { type Clock, Reader, type Source } from "./source.ts";

/** Returns a Source that read reads at once, and every resyncEvery ms
 * after each read ends, telling its listeners only of changes. listen
 * starts listening, until signal aborts, calling the source's refresh
 * whenever what it listens to says something changed; it may also follow
 * the source's changes, as to listen for more. */
export function subscribed<T>(
  read: () => Promise<T>,
  listen: (source: Source<T>, signal?: AbortSignal) => void,
  options: { resyncEvery: number; equal?: (a: T, b: T) => boolean; onError?: (error: unknown) => void; signal?: AbortSignal; clock?: Clock },
): Source<T> {
  const source = new Reader(read, { ...options, every: options.resyncEvery });
  listen(source, options.signal);
  return source;
}
