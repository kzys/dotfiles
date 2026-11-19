// A clock for tests whose time moves only when they say.

import type { Clock } from "./schedule.ts";

/** Returns a clock whose time moves only when advanced, running the
 * timers that come due and letting what they start settle. */
export function fakeClock() {
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
