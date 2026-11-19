// Running a job every so often, such as reading something outside the
// server or checking the user's pull requests, and sooner when asked.

/** The time and timers a Schedule uses, the real ones by default. */
export type Clock = {
  now: () => number;
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export type ScheduleOptions = {
  /** How long after a run ends to run again. */
  every: number;
  /** Whether to run at once; otherwise the first refresh does. */
  start?: boolean;
  /** Called with what a run raises; by default, nothing is. */
  onError?: (error: unknown) => void;
  /** Stops it running. */
  signal?: AbortSignal;
  clock?: Clock;
};

/** Runs job, one run at a time, at once unless start is false, then every
 * ms after each run ends, or sooner when refreshed. */
export class Schedule {
  private job: () => Promise<void>;
  private options: ScheduleOptions;
  private clock: Clock;
  private timer: unknown = null;
  private due = 0;
  private running = false;
  // The latest time a run was asked to start at or after, which a run
  // that started before it may have missed, and whether one was asked for
  // while a run went on, in case both fall in the same millisecond.
  private wanted = -Infinity;
  private again = false;

  constructor(job: () => Promise<void>, options: ScheduleOptions) {
    this.job = job;
    this.options = options;
    this.clock = options.clock ?? realClock;
    options.signal?.addEventListener("abort", () => this.cancel());
    if (options.start !== false) this.refresh();
  }

  /** Makes sure a run starts within ms from now, by default at once, and
   * not before then: what prompted it may not show sooner. A run planned
   * sooner, or going on, still runs, and it runs again then. Asking never
   * puts a run off. */
  refresh(within = 0) {
    if (this.options.signal?.aborted) return;
    const at = this.clock.now() + within;
    this.wanted = Math.max(this.wanted, at);
    if (this.running) this.again = true;
    else if (this.timer === null || this.due > at) this.plan(within);
  }

  /** Returns when it next runs, or null if no run is planned. */
  next(): Date | null {
    return this.timer === null ? null : new Date(this.due);
  }

  private cancel() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private plan(ms: number) {
    this.cancel();
    this.due = this.clock.now() + ms;
    this.timer = this.clock.setTimeout(() => this.run(), ms);
  }

  private async run() {
    this.timer = null;
    this.running = true;
    this.again = false;
    const started = this.clock.now();
    try {
      await this.job();
    } catch (e) {
      this.options.onError?.(e);
    } finally {
      this.running = false;
    }
    if (this.options.signal?.aborted) return;
    if (this.again || this.wanted > started) this.plan(Math.max(this.wanted - this.clock.now(), 0));
    else this.plan(this.options.every);
  }
}
