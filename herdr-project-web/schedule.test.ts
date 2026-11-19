import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeClock } from "./fakeclock.ts";
import { Schedule } from "./schedule.ts";

test("runs at once, then every so often after each run ends, even after one fails", async () => {
  const { clock, advance } = fakeClock();
  const ran: number[] = [];
  const raised: unknown[] = [];
  const job = async () => {
    ran.push(clock.now());
    if (ran.length === 2) throw new Error("down");
  };
  const schedule = new Schedule(job, { every: 100, clock, onError: (e) => raised.push(e) });
  await advance(300);
  assert.deepEqual([ran, raised.map(String)], [[0, 100, 200, 300], ["Error: down"]]);
  assert.equal(schedule.next()?.getTime(), 400);
});

test("runs again after a run that was asked for while one went on", async () => {
  const { clock, advance } = fakeClock();
  let release: (() => void) | null = null;
  let runs = 0;
  const job = () => new Promise<void>((resolve) => {
    runs++;
    release = resolve;
  });
  const schedule = new Schedule(job, { every: 1000, clock });
  await advance(0);
  schedule.refresh();
  schedule.refresh();
  release!();
  await advance(0);
  assert.equal(runs, 2);
  release!();
  await advance(0);
  assert.equal(schedule.next()?.getTime(), 1000);
});

test("runs on a schedule, sooner when asked, never later", async () => {
  const { clock, advance } = fakeClock();
  const ran: number[] = [];
  const schedule = new Schedule(async () => void ran.push(clock.now()), { every: 300, start: false, clock });
  assert.equal(schedule.next(), null);
  schedule.refresh();
  await advance(0);
  assert.equal(schedule.next()?.getTime(), 300);
  schedule.refresh(15);
  schedule.refresh(100);
  assert.equal(schedule.next()?.getTime(), 15);
  await advance(15);
  // The one at 15 started before 100, so another runs then.
  assert.equal(schedule.next()?.getTime(), 100);
  await advance(85);
  assert.deepEqual(ran, [0, 15, 100]);
});

test("runs again when asked for later than a run due sooner", async () => {
  const { clock, advance } = fakeClock();
  const ran: number[] = [];
  const schedule = new Schedule(async () => void ran.push(clock.now()), { every: 300, clock });
  await advance(290);
  schedule.refresh(15);
  assert.equal(schedule.next()?.getTime(), 300);
  await advance(20);
  assert.deepEqual(ran, [0, 300, 305]);
});

test("stops when its signal aborts", async () => {
  const { clock, advance } = fakeClock();
  let runs = 0;
  const stop = new AbortController();
  const schedule = new Schedule(async () => void runs++, { every: 100, clock, signal: stop.signal });
  await advance(0);
  stop.abort();
  schedule.refresh();
  await advance(500);
  assert.deepEqual([runs, schedule.next()], [1, null]);
});
