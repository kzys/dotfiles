// A value computed from other sources, kept until one of them changes,
// so that what reads it doesn't compute it again or keep its own copy.

import type { Source } from "./source.ts";

type Values<I extends readonly Source<unknown>[]> = { [K in keyof I]: I[K] extends Source<infer V> ? V : never };

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Returns a Source whose value compute returns from the values of
 * inputs, computed again whenever one of them changes, telling its
 * listeners only of changes, as equal tells, by default as JSON. It has
 * none until every input has one. refresh computes it again. */
export function derived<const I extends readonly Source<unknown>[], T>(
  inputs: I,
  compute: (...values: Values<I>) => T,
  options: { equal?: (a: T, b: T) => boolean } = {},
): Source<T> {
  let value: T | null = null;
  const listeners: ((value: T, before: T | null) => void)[] = [];
  const update = () => {
    const values = inputs.map((input) => input.current());
    if (values.some((v) => v === null)) return;
    const next = compute(...(values as Values<I>));
    const before = value;
    if (before !== null && (options.equal ?? sameJson)(before, next)) return;
    value = next;
    for (const listener of listeners) listener(next, before);
  };
  for (const input of inputs) input.onChange(update);
  update();
  return {
    current: () => value,
    onChange: (listener) => void listeners.push(listener),
    refresh: update,
    next: () => null,
  };
}
