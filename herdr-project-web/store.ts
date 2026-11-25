// What the server does as the signals it follows change, as a page's
// state flows to what it renders.

import { type ReadonlySignal, effect as track } from "@preact/signals-core";

/** What an effect's run raises to run again on its retry signal's next
 * change, without it counting as an error. */
export const AGAIN = new Error("again");

export type EffectOptions = {
  onError?: (error: unknown) => void;
  /** What a run that raises waits to change before running again, rather
   * than only once its key changes. */
  retry?: ReadonlySignal<unknown>;
};

/** Runs run with key's value soon, and again whenever that value, compared
 * as JSON, changes, one run at a time: one asked for while another goes on
 * runs after it, with the value then. Key's reads of signals are what it
 * follows, so key reads only signals, and a key that raises follows only
 * those it read before; run's reads are not followed. A run that raises
 * with retry runs again once retry changes, or at once if it changed
 * during the run. */
export function effect<K>(key: () => K, run: (key: K) => unknown, options: EffectOptions = {}) {
  // Key's value as last read, or undefined if it raised.
  let latest: { value: K; text: string } | undefined;
  // Key's value as JSON for the last run, or undefined if there is none
  // or it is to run again.
  let done: string | undefined;
  let running = false;
  // Whether something it follows changed since go last looked.
  let pending = false;
  const go = async () => {
    if (running) return;
    running = true;
    try {
      while (pending) {
        pending = false;
        if (!latest || latest.text === done) continue;
        const { value, text } = latest;
        done = text;
        try {
          await run(value);
        } catch (e) {
          if (e !== AGAIN) options.onError?.(e);
          if (options.retry) done = undefined;
        }
      }
    } finally {
      running = false;
    }
  };
  track(() => {
    options.retry?.value;
    try {
      const value = key();
      latest = { value, text: JSON.stringify(value) };
    } catch (e) {
      options.onError?.(e);
      latest = undefined;
      done = undefined;
    }
    pending = true;
    // After the changes made together, and outside what track follows.
    queueMicrotask(() => void go());
  });
}
