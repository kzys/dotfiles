import assert from "node:assert/strict";
import { test } from "node:test";
import { halMessage } from "./hal.ts";

test("has HAL say what needs attention first", () => {
  const ok = { connected: true, running: true, stale: false, waiting: 0, hour: 9 };
  assert.equal(halMessage(ok), "Good morning. Nothing waits on you.");
  assert.equal(halMessage({ ...ok, waiting: 1, hour: 20 }), "Good evening. 1 item waits on you.");
  assert.equal(halMessage({ ...ok, waiting: 3, hour: 2 }), "Working late. 3 items wait on you.");
  assert.match(halMessage({ ...ok, stale: true, waiting: 3 }), /stopped reporting/);
  assert.match(halMessage({ ...ok, running: false, stale: true }), /isn't running/);
  assert.match(halMessage({ ...ok, connected: false, running: false }), /Can't reach the server/);
});
