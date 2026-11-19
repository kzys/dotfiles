// A check run on a schedule, such as of the user's pull requests, which
// takes a while and whose result tells when it ran.

import { type Clock, Reader, type Source } from "./source.ts";

/** Returns a Source that runs check, and again after ms once it ends, or
 * sooner when refreshed. Each result counts as a change. Unless start is
 * false, it runs at once; otherwise the first refresh starts it. */
export function scheduled<T>(
  check: () => Promise<T>,
  options: { after: number; start?: boolean; onError?: (error: unknown) => void; signal?: AbortSignal; clock?: Clock },
): Source<T> {
  return new Reader(check, { ...options, every: options.after, equal: () => false });
}
