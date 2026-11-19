// Checking the user's pull requests every so often, and sooner when
// asked, keeping what the last check that didn't fail found.

import { type Clock, Schedule } from "../schedule.ts";
import type { PullCheck } from "./poll.ts";

// A check of the pull requests: when it ran, why it failed, if it did,
// and what the last one that didn't found, if any did.
export type PullChecked = { at: Date; error: string | null; last: PullCheck | null };

export type PullRequestsOptions = {
  /** How long after a check ends to check again. */
  every: number;
  /** How soon to check when asked: GitHub's search takes a while to find
   * a new pull request. */
  soon: number;
  /** Whether to check at once; otherwise checkSoon starts it. */
  start?: boolean;
  /** Called with what onCheck raises. */
  onError?: (error: unknown) => void;
  clock?: Clock;
};

/** Checks the pull requests with check, calling onCheck after each. */
export class PullRequests {
  private last: PullCheck | null = null;
  private schedule: Schedule;
  private soon: number;

  constructor(check: () => Promise<PullCheck>, onCheck: (checked: PullChecked) => void, options: PullRequestsOptions) {
    this.soon = options.soon;
    this.schedule = new Schedule(async () => {
      const at = new Date(options.clock ? options.clock.now() : Date.now());
      let error: string | null = null;
      try {
        this.last = await check();
      } catch (e) {
        error = String(e).split("\n")[0];
      }
      onCheck({ at, error, last: this.last });
    }, { every: options.every, start: options.start, onError: options.onError, clock: options.clock });
  }

  /** Returns what the last check that didn't fail found, or null. */
  latest(): PullCheck | null {
    return this.last;
  }

  /** Checks soon from now, after any check due sooner or running, and
   * returns when the next check runs. */
  checkSoon(): Date | null {
    this.schedule.refresh(this.soon);
    return this.schedule.next();
  }
}
