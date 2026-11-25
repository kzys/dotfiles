// What the server knows, in one place that its sources write and its
// effects follow, as a page's state flows to what it renders.

/** A state that sources change and listeners follow, told once for the
 * changes made together. */
export class Store<T extends object> {
  private state: T;
  private listeners: ((state: T) => void)[] = [];
  private due = false;
  private defer: (f: () => void) => void;

  constructor(initial: T, defer: (f: () => void) => void = queueMicrotask) {
    this.state = initial;
    this.defer = defer;
  }

  /** Returns the state as it is now. */
  get(): T {
    return this.state;
  }

  /** Replaces the fields in patch that differ, telling the listeners
   * after the changes made together. */
  set(patch: Partial<T>) {
    const changed = (Object.keys(patch) as (keyof T)[]).some((k) => !Object.is(patch[k], this.state[k]));
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.tell();
  }

  /** Tells the listeners, as for a change to something the state doesn't
   * hold but what they derive from it reads. */
  tell() {
    if (this.due) return;
    this.due = true;
    this.defer(() => {
      this.due = false;
      for (const listener of this.listeners) listener(this.state);
    });
  }

  /** Calls listener with the state after each change. */
  listen(listener: (state: T) => void) {
    this.listeners.push(listener);
  }
}

/** What an effect's run raises to run again on the next change of
 * anything, with retry, without it counting as an error. */
export const AGAIN = new Error("again");

export type EffectOptions = {
  onError?: (error: unknown) => void;
  /** Whether a run that raises runs again on the next change of anything,
   * rather than only once key changes. */
  retry?: boolean;
};

/** Runs run with store's state and key's value for it soon, and again
 * whenever that value, compared as JSON, changes, one run at a time: one
 * asked for while another goes on runs after it, with the state then. */
export function effect<T extends object, K>(
  store: Store<T>, key: (state: T) => K, run: (state: T, key: K) => unknown, options: EffectOptions = {},
) {
  let done: string | undefined;
  let running = false;
  const go = async () => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const state = store.get();
        let value: K;
        try {
          value = key(state);
        } catch (e) {
          options.onError?.(e);
          done = undefined;
          break;
        }
        const text = JSON.stringify(value);
        if (text === done) break;
        done = text;
        try {
          await run(state, value);
        } catch (e) {
          if (e !== AGAIN) options.onError?.(e);
          if (options.retry) done = undefined;
        }
        // A run to retry waits for the next change, unless what it went by
        // has changed already.
        if (done === undefined && JSON.stringify(key(store.get())) === text) break;
      }
    } catch (e) {
      options.onError?.(e);
    } finally {
      running = false;
    }
  };
  store.listen(() => void go());
  // With the others, once what run reads is set up.
  store.tell();
}
