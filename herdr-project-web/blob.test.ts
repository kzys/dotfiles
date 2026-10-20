import assert from "node:assert/strict";
import { test } from "node:test";
import { blobPath, blobPoints } from "./blob.ts";

test("moves the blob's outline from a circle as it wobbles", () => {
  const distances = (ps: [number, number][]) => ps.map(([x, y]) => Math.hypot(x - 16, y - 16));
  for (const d of distances(blobPoints(3, 32, 0))) assert.ok(Math.abs(d - 32 * 0.38) < 1e-9);
  const moving = distances(blobPoints(3, 32, 1));
  assert.ok(moving.some((d) => Math.abs(d - 32 * 0.38) > 0.1));
  assert.ok(moving.every((d) => d > 32 * 0.38 * 0.85 && d < 32 * 0.38 * 1.15));
  assert.notDeepEqual(blobPoints(3, 32, 1), blobPoints(4, 32, 1));

  const path = blobPath(blobPoints(0, 32, 1));
  assert.match(path, /^M[\d.]+,[\d.]+(C[\d., ]+){7}Z$/);
});
