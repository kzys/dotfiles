import assert from "node:assert/strict";
import { test } from "node:test";
import { signal } from "@preact/signals-core";
import { AGAIN, anyOf, effect, signals, values } from "./store.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("gives a signal for each fact, and their values together", () => {
  const facts = signals({ a: 1, b: "x" });
  facts.b.value = "y";
  assert.deepEqual(values(facts), { a: 1, b: "y" });
});

test("changes anyOf when any fact does, and not when none does", async () => {
  const facts = signals({ a: 1, b: "x" });
  const any = anyOf(facts);
  const runs: number[] = [];
  effect(() => any.value, () => void runs.push(facts.a.value));
  await settle();
  facts.b.value = "y";
  await settle();
  facts.b.value = "y";
  await settle();
  assert.deepEqual(runs, [1, 1]);
});

test("runs an effect when its key changes, one run at a time, with the latest value", async () => {
  const facts = signals({ n: 0, other: 0 });
  const runs: number[] = [];
  let release = () => {};
  effect(() => facts.n.value, async (n) => {
    runs.push(n);
    if (n === 1) await new Promise<void>((resolve) => (release = resolve));
  });
  await settle();
  assert.deepEqual(runs, [0]);
  facts.other.value = 1; // Not in the key.
  await settle();
  assert.deepEqual(runs, [0]);
  facts.n.value = 1;
  await settle();
  facts.n.value = 2;
  await settle();
  facts.n.value = 3;
  await settle();
  assert.deepEqual(runs, [0, 1]);
  release();
  await settle();
  assert.deepEqual(runs, [0, 1, 3]);
});

test("runs once for the changes made together, and not for a key equal as JSON", async () => {
  const facts = signals({ a: 0, b: 0 });
  const runs: number[][] = [];
  effect(() => [facts.a.value, facts.b.value], (key) => void runs.push(key));
  await settle();
  facts.a.value = 1;
  facts.b.value = 1;
  await settle();
  facts.a.value = 2;
  facts.a.value = 1;
  await settle();
  assert.deepEqual(runs, [[0, 0], [1, 1]]);
});

test("doesn't follow what a run reads", async () => {
  const n = signal(0);
  const other = signal(0);
  const runs: number[] = [];
  effect(() => n.value, () => void runs.push(other.value));
  await settle();
  other.value = 1;
  await settle();
  assert.deepEqual(runs, [0]);
});

test("runs a failed effect again only when its key changes, or when retry changes", async () => {
  const facts = signals({ n: 0, other: 0 });
  const any = anyOf(facts);
  const runs: string[] = [];
  const errors: unknown[] = [];
  effect(() => facts.n.value, (n) => {
    runs.push(`once ${n}`);
    throw new Error("no");
  }, { onError: (e) => errors.push(e) });
  effect(() => facts.n.value, (n) => {
    runs.push(`retry ${n}`);
    throw new Error("no");
  }, { retry: any });
  await settle();
  facts.other.value = 1;
  await settle();
  facts.n.value = 1;
  await settle();
  assert.deepEqual(runs, ["once 0", "retry 0", "retry 0", "once 1", "retry 1"]);
  assert.equal(errors.length, 2);
});

test("tells of a key that raises instead of raising, and runs a retry with what changed meanwhile", async () => {
  const facts = signals({ n: 0 });
  const errors: unknown[] = [];
  effect(() => {
    if (facts.n.value === 1) throw new Error("bad key");
    return facts.n.value;
  }, () => {}, { onError: (e) => errors.push(e) });
  facts.n.value = 1;
  await settle();
  assert.deepEqual(errors.map((e) => (e as Error).message), ["bad key"]);

  const runs: number[] = [];
  effect(() => facts.n.value, (n) => {
    runs.push(n);
    if (n === 1) {
      facts.n.value = 2;
      throw AGAIN;
    }
  }, { retry: anyOf(facts), onError: (e) => errors.push(e) });
  await settle();
  await settle();
  assert.deepEqual(runs, [1, 2]);
  assert.equal(errors.length, 1); // Not AGAIN.
});

test("runs a failed retry again at once if retry changed during the run", async () => {
  const facts = signals({ n: 0, other: 0 });
  const runs: number[] = [];
  effect(() => facts.n.value, () => {
    runs.push(facts.other.value);
    if (facts.other.value === 0) facts.other.value = 1;
    throw AGAIN;
  }, { retry: anyOf(facts) });
  await settle();
  await settle();
  assert.deepEqual(runs, [0, 1]);
});
