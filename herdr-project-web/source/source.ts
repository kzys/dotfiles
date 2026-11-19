// Keeping what the server shows of something outside it current: read
// now and then, when told it changed, or on a schedule.

/** Something outside the server, as last read. */
export interface Source<T> {
  /** What it was when last read, or null before a read succeeds. */
  current(): T | null;
  /** Calls listener with what a read found and what it was before, when
   * they differ as its source tells. */
  onChange(listener: (value: T, before: T | null) => void): void;
  /** Makes sure a read starts within ms from now, by default at once, and
   * not before then: what prompted it may not show sooner. A read planned
   * sooner, or running, still runs, and it reads again then. Asking never
   * puts a read off. */
  refresh(within?: number): void;
  /** When it is next read, or null if no read is planned. */
  next(): Date | null;
}

/** The time and timers a Reader uses, the real ones by default. */
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

export type ReaderOptions<T> = {
  /** How long after a read ends to read again, or null to read only when
   * asked. */
  every: number | null;
  /** Whether two values are the same, so that listeners hear only of
   * changes; by default, whether they are the same as JSON. */
  equal?: (a: T, b: T) => boolean;
  /** Whether to read at once; otherwise the first refresh does. */
  start?: boolean;
  /** Called with what a read raises; by default, nothing is. */
  onError?: (error: unknown) => void;
  /** Stops it reading. */
  signal?: AbortSignal;
  clock?: Clock;
};

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A Source whose value read returns. One read runs at a time. A read
 * that fails, by raising, keeps the value before. What listeners raise
 * isn't caught. */
export class Reader<T> implements Source<T> {
  private value: T | null = null;
  private read: () => Promise<T>;
  private options: ReaderOptions<T>;
  private clock: Clock;
  private listeners: ((value: T, before: T | null) => void)[] = [];
  private timer: unknown = null;
  private due = 0;
  private reading = false;
  // The latest time a read was asked to start at or after, which a read
  // that started before it may have missed, and whether one was asked for
  // while a read ran, in case both fall in the same millisecond.
  private wanted = -Infinity;
  private again = false;

  constructor(read: () => Promise<T>, options: ReaderOptions<T>) {
    this.read = read;
    this.options = options;
    this.clock = options.clock ?? realClock;
    options.signal?.addEventListener("abort", () => this.cancel());
    if (options.start !== false) this.refresh();
  }

  current(): T | null {
    return this.value;
  }

  onChange(listener: (value: T, before: T | null) => void) {
    this.listeners.push(listener);
  }

  next(): Date | null {
    return this.timer === null ? null : new Date(this.due);
  }

  refresh(within = 0) {
    if (this.options.signal?.aborted) return;
    const at = this.clock.now() + within;
    this.wanted = Math.max(this.wanted, at);
    if (this.reading) this.again = true;
    else if (this.timer === null || this.due > at) this.plan(within);
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
    this.reading = true;
    this.again = false;
    const started = this.clock.now();
    let read: { value: T } | null = null;
    try {
      read = { value: await this.read() };
    } catch (e) {
      // The value before stays.
      this.options.onError?.(e);
    } finally {
      this.reading = false;
    }
    if (!this.options.signal?.aborted) {
      if (this.again || this.wanted > started) this.plan(Math.max(this.wanted - this.clock.now(), 0));
      else if (this.options.every !== null) this.plan(this.options.every);
    }
    if (!read) return;
    const before = this.value;
    const equal = this.options.equal ?? sameJson;
    if (before !== null && equal(before, read.value)) return;
    this.value = read.value;
    for (const listener of this.listeners) listener(read.value, before);
  }
}
