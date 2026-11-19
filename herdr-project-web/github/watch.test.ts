import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeClock } from "../fakeclock.ts";
import type { PullCheck } from "./poll.ts";
import { type PullChecked, PullRequests } from "./watch.ts";

test("keeps what the last check that didn't fail found, and checks soon when asked", async () => {
  const { clock, advance } = fakeClock();
  const results: (string | Error)[] = ["first", new Error("gh: timeout\nmore"), "second"];
  const check = async () => {
    const r = results.shift()!;
    if (r instanceof Error) throw r;
    return { urls: [r] } as unknown as PullCheck;
  };
  const heard: [number, string | null, string[] | undefined][] = [];
  const onCheck = ({ at, error, last }: PullChecked) => heard.push([at.getTime(), error, last?.urls]);
  const pulls = new PullRequests(check, onCheck, { every: 300, soon: 15, start: false, clock });
  assert.equal(pulls.latest(), null);
  assert.equal(pulls.checkSoon()?.getTime(), 15);
  await advance(15);
  assert.equal(pulls.checkSoon()?.getTime(), 30);
  await advance(15);
  await advance(300);
  assert.deepEqual(heard, [[15, null, ["first"]], [30, "Error: gh: timeout", ["first"]], [330, null, ["second"]]]);
  assert.deepEqual(pulls.latest()?.urls, ["second"]);
});
