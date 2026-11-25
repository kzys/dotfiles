import assert from "node:assert/strict";
import { test } from "node:test";
import { AGAIN, Store, effect } from "./store.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("tells its listeners once for the changes made together, and not for none", async () => {
  const store = new Store({ a: 1, b: "x" });
  const told: object[] = [];
  store.listen((s) => told.push(s));
  store.set({ a: 2 });
  store.set({ b: "y" });
  store.set({ a: 2 });
  await settle();
  assert.deepEqual(told, [{ a: 2, b: "y" }]);
  store.set({ a: 2, b: "y" });
  await settle();
  assert.equal(told.length, 1);
  store.tell();
  await settle();
  assert.equal(told.length, 2);
});

test("runs an effect when its key changes, one run at a time, with the latest state", async () => {
  const store = new Store({ n: 0, other: 0 });
  const runs: number[] = [];
  let release = () => {};
  effect(store, (s) => s.n, async (_s, n) => {
    runs.push(n);
    if (n === 1) await new Promise<void>((resolve) => (release = resolve));
  });
  await settle();
  assert.deepEqual(runs, [0]);
  store.set({ other: 1 }); // Not in the key.
  await settle();
  assert.deepEqual(runs, [0]);
  store.set({ n: 1 });
  await settle();
  store.set({ n: 2 });
  await settle();
  store.set({ n: 3 });
  await settle();
  assert.deepEqual(runs, [0, 1]);
  release();
  await settle();
  assert.deepEqual(runs, [0, 1, 3]);
});

test("runs a failed effect again only when its key changes, or on any change with retry", async () => {
  const store = new Store({ n: 0, other: 0 });
  const runs: string[] = [];
  const errors: unknown[] = [];
  effect(store, (s) => s.n, (_s, n) => {
    runs.push(`once ${n}`);
    throw new Error("no");
  }, { onError: (e) => errors.push(e) });
  effect(store, (s) => s.n, (_s, n) => {
    runs.push(`retry ${n}`);
    throw new Error("no");
  }, { retry: true });
  await settle();
  store.set({ other: 1 });
  await settle();
  store.set({ n: 1 });
  await settle();
  assert.deepEqual(runs, ["once 0", "retry 0", "retry 0", "once 1", "retry 1"]);
  assert.equal(errors.length, 2);
});

test("tells of a key that raises instead of raising, and runs a retry with what changed meanwhile", async () => {
  const store = new Store({ n: 0 });
  const errors: unknown[] = [];
  effect(store, (s) => {
    if (s.n === 1) throw new Error("bad key");
    return s.n;
  }, () => {}, { onError: (e) => errors.push(e) });
  store.set({ n: 1 });
  await settle();
  assert.deepEqual(errors.map((e) => (e as Error).message), ["bad key"]);

  const runs: number[] = [];
  effect(store, (s) => s.n, (_s, n) => {
    runs.push(n);
    if (n === 1) {
      store.set({ n: 2 });
      throw AGAIN;
    }
  }, { retry: true, onError: (e) => errors.push(e) });
  await settle();
  await settle();
  assert.deepEqual(runs, [1, 2]);
  assert.equal(errors.length, 2); // The key raising again for n = 1, but not AGAIN.
});
