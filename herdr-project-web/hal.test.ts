import assert from "node:assert/strict";
import { test } from "node:test";
import { halMessage } from "./hal.ts";

test("has HAL say what needs attention first", () => {
  const ok = { connected: true, running: true, stale: false, waiting: 0, hour: 9 };
  assert.equal(halMessage(ok), "Good morning. All systems functional. Nothing requires your attention.");
  assert.equal(halMessage({ ...ok, waiting: 1, hour: 20 }), "Good evening. One matter requires your attention.");
  assert.equal(halMessage({ ...ok, waiting: 3, hour: 2 }), "Working late. 3 matters require your attention.");
  assert.match(halMessage({ ...ok, stale: true, waiting: 3 }), /stopped reporting/);
  assert.match(halMessage({ ...ok, running: false, stale: true }), /isn't running/);
  assert.match(halMessage({ ...ok, connected: false, running: false }), /lost contact/);
});
