import assert from "node:assert/strict";
import { test } from "node:test";
import { polled } from "./polled.ts";
import { scheduled } from "./scheduled.ts";
import type { Clock } from "./source.ts";
import { subscribed } from "./subscribed.ts";

/** Returns a clock whose time moves only when advanced, running the
 * timers that come due and letting what they start settle. */
function fakeClock() {
  let now = 0;
  let timers: { at: number; f: () => void }[] = [];
  const clock: Clock = {
    now: () => now,
    setTimeout: (f, ms) => {
      const timer = { at: now + ms, f };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => (timers = timers.filter((t) => t !== timer)),
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      await settle();
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.f();
    }
    now = end;
    await settle();
  };
  return { clock, advance };
}

/** Returns a read that returns values in turn, raising for an Error, and
 * counts its calls. */
function reads<T>(...values: (T | Error)[]) {
  const calls: number[] = [];
  const read = async () => {
    calls.push(calls.length);
    const value = values[Math.min(calls.length - 1, values.length - 1)];
    if (value instanceof Error) throw value;
    return value;
  };
  return { read, calls };
}

test("reads every so often, telling only of changes and keeping the last value on failure", async () => {
  const { clock, advance } = fakeClock();
  const { read, calls } = reads(1, 1, new Error("down"), 2);
  const source = polled(read, { every: 100, clock });
  const heard: [number, number | null][] = [];
  source.onChange((value, before) => heard.push([value, before]));
  await advance(0);
  assert.equal(source.current(), 1);
  await advance(300);
  assert.equal(calls.length, 4);
  assert.equal(source.current(), 2);
  assert.deepEqual(heard, [[1, null], [2, 1]]);
  assert.equal(source.next()?.getTime(), 400);
});

test("reads again after a read that was asked for while it ran", async () => {
  const { clock, advance } = fakeClock();
  let release: (() => void) | null = null;
  let calls = 0;
  const read = () => new Promise<number>((resolve) => {
    calls++;
    release = () => resolve(calls);
  });
  const source = polled(read, { every: 1000, clock });
  await advance(0);
  source.refresh();
  source.refresh();
  release!();
  await advance(0);
  assert.equal(calls, 2);
  release!();
  await advance(0);
  assert.equal(source.current(), 2);
  assert.equal(source.next()?.getTime(), 1000);
});

test("reads when told it changed, and now and then besides", async () => {
  const { clock, advance } = fakeClock();
  const { read, calls } = reads(1, 2, 3);
  let changed = () => {};
  const source = subscribed(read, (s) => (changed = () => s.refresh()), { resyncEvery: 1000, clock });
  await advance(0);
  changed();
  await advance(0);
  assert.equal(source.current(), 2);
  await advance(1000);
  assert.deepEqual([calls.length, source.current()], [3, 3]);
});

test("checks on a schedule, sooner when asked, never later", async () => {
  const { clock, advance } = fakeClock();
  const ran: number[] = [];
  const source = scheduled(async () => (ran.push(clock.now()), "a"), { after: 300, start: false, clock });
  const heard: string[] = [];
  source.onChange((value) => heard.push(value));
  assert.equal(source.next(), null);
  source.refresh();
  await advance(0);
  assert.equal(source.next()?.getTime(), 300);
  source.refresh(15);
  source.refresh(100);
  assert.equal(source.next()?.getTime(), 15);
  await advance(15);
  // The one at 15 started before 100, so another runs then.
  assert.equal(source.next()?.getTime(), 100);
  await advance(85);
  // Each result counts, even the same.
  assert.deepEqual([ran, heard.length], [[0, 15, 100], 3]);
});

test("checks again when asked for later than a check due sooner", async () => {
  const { clock, advance } = fakeClock();
  const ran: number[] = [];
  const source = scheduled(async () => ran.push(clock.now()), { after: 300, clock });
  await advance(290);
  source.refresh(15);
  assert.equal(source.next()?.getTime(), 300);
  await advance(20);
  assert.deepEqual(ran, [0, 300, 305]);
});

test("tells of what a read raises, keeping the value before", async () => {
  const { clock, advance } = fakeClock();
  const raised: unknown[] = [];
  const source = polled(reads(1, new Error("down")).read, { every: 100, clock, onError: (e) => raised.push(e) });
  await advance(100);
  assert.deepEqual([source.current(), raised.map(String)], [1, ["Error: down"]]);
});

test("stops when its signal aborts", async () => {
  const { clock, advance } = fakeClock();
  const { read, calls } = reads(1);
  const stop = new AbortController();
  const source = polled(read, { every: 100, clock, signal: stop.signal });
  await advance(0);
  stop.abort();
  await advance(500);
  assert.deepEqual([calls.length, source.next()], [1, null]);
});
