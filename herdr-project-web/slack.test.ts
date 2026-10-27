import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { NotesText, Owner } from "./owners.ts";
import { type Conversation, entries, events, owner, poll, remember, table } from "./slack.ts";

function conversation(channel_id: string, thread_ts: string, last_ts: string,
                      { waiting = false, links = [] as string[], done = false } = {}): Conversation {
  return { channel_id, thread_ts, channel: `#${channel_id}`,
           permalink: `https://x.slack.com/archives/${channel_id}/p${thread_ts.replaceAll(".", "")}`,
           summary: `about ${thread_ts}`, waiting_on_me: waiting, done, last_ts, links };
}

test("finds the projects of Slack conversations", () => {
  const texts: NotesText[] = [["/p/a", "main", "Slack thread C1 p1700000000123456 asks for review"],
                              ["/p/b", null, "see C2 for context"],
                              ["/p/c", "dm", "DM in D9 about the rollout"]];
  const prOwners: Record<string, Owner> = { "https://github.com/o/r/pull/1": { project: "/p/x" } };
  const find = (c: Conversation) => owner(c, texts, prOwners)?.project ?? null;
  assert.equal(find(conversation("C1", "1700000000123456.000000", "0")), null);
  assert.equal(find(conversation("C1", "1700000000.123456", "0")), "/p/a");
  assert.equal(find(conversation("D9", "", "0")), "/p/c");
  assert.equal(find(conversation("C2", "17.5", "0", { links: ["https://github.com/o/r/pull/1"] })), "/p/x");
  assert.equal(find(conversation("C3", "18.5", "0")), null);
  // Odd thread ts match literally.
  assert.equal(owner(conversation("C1", "12(3", "0"), [["/p/a", null, "p12(3"]], {})?.project, "/p/a");
  assert.equal(owner(conversation("C1", "1.2(", "0"), [], {}), null);
});

test("reports Slack conversations waiting on me", () => {
  const before = [conversation("C1", "1.0", "100", { waiting: true }), conversation("C2", "2.0", "100")];
  assert.deepEqual(events(null, before), []);
  const old = remember(null, before, 200);
  const after = [conversation("C1", "1.0", "100", { waiting: true }),
                 conversation("C2", "2.0", "150", { waiting: true }),
                 conversation("C3", "3.0", "160", { waiting: true }),
                 conversation("C4", "4.0", "170")];
  assert.deepEqual(events(old, after).map((c) => c.channel_id), ["C2", "C3"]);
  assert.deepEqual(remember(old, after, 100 + 7 * 86400 + 10), {
    "C2/2.0": "150.000000", "C3/3.0": "160.000000", "C4/4.0": "170.000000" });
  // However Claude writes the ts.
  const kept = remember(null, [conversation("C1", "1.5", "1700000000.1", { waiting: true })], 1700000100);
  assert.deepEqual(events(kept, [conversation("C1", "1.5", "1700000000.100000", { waiting: true })]), []);
});

test("doesn't notify again from what the Python watcher kept", () => {
  const old = { "C0A/1792624947.336059": "1792624947.336059", "D9/": "1792600000.000000" };
  assert.deepEqual(events(old, [conversation("C0A", "1792624947.336059", "1792624947.336059", { waiting: true }),
                                conversation("D9", "", "1792600000", { waiting: true })]), []);
});

test("polls Slack", async () => {
  const dir = mkdtempSync(join(tmpdir(), "slack-"));
  mkdirSync(join(dir, "a"));
  writeFileSync(join(dir, "a/README.md"), "---\nname: alpha\n---\n");
  const texts: NotesText[] = [[join(dir, "a"), null, "thread C1 p15"]];
  const runs = [[conversation("C1", "1.5", "10")],
                [conversation("C1", "1.5", "20", { waiting: true }), conversation("C2", "", "5")]];
  const calls: string[][] = [];
  const notify = async (title: string, body: string) => calls.push([title, body]);
  const state = join(dir, "state/slack.json");
  const fetch = async () => runs.shift()!;

  assert.deepEqual((await poll(notify, texts, state, {}, fetch)).lines, ["  #C1 alpha about 1.5"]);
  assert.deepEqual(calls, []);
  const { lines, rows, items } = await poll(notify, texts, state, {}, fetch);
  assert.deepEqual(items, [{ project: join(dir, "a"), role: null, mark: "slack", text: "Slack #C1: about 1.5" }]);
  assert.deepEqual(lines, ["* #C1 alpha about 1.5", "#C2", "    about "]);
  assert.deepEqual(rows, [
    { label: "#C1", title: "about 1.5", url: "https://x.slack.com/archives/C1/p15",
      waiting: true, done: false, project: "alpha" },
    { label: "#C2", title: "about ", url: "https://x.slack.com/archives/C2/p",
      waiting: false, done: false, project: null },
  ]);
  assert.deepEqual(calls, [["Slack #C1", "about 1.5 (a)"]]);
});

test("keeps done Slack conversations out of the way", () => {
  const found = [conversation("C1", "1.5", "1", { waiting: true, done: true }),
                 conversation("C2", "2.5", "1"), conversation("C3", "3.5", "1", { waiting: true })];
  assert.deepEqual(table(found, {}), ["#C3", "  * about 3.5", "#C2", "    about 2.5", "#C1", "  ✓ about 1.5"]);
  assert.deepEqual(entries(found, {}).map((r) => [r.label, r.waiting, r.done]), [
    ["#C3", true, false], ["#C2", false, false], ["#C1", false, true]]);
  assert.deepEqual(events(remember(null, [], 0), found).map((c) => c.channel_id), ["C3"]);
});

test("groups Slack conversations without a project by channel", () => {
  const dir = mkdtempSync(join(tmpdir(), "slack-"));
  mkdirSync(join(dir, "a"));
  writeFileSync(join(dir, "a/README.md"), "---\nname: alpha\n---\n");
  const owners = { "C1/1.5": { project: join(dir, "a") } };
  const found = [conversation("C1", "1.5", "1"), conversation("C2", "2.5", "1"),
                 conversation("C3", "3.5", "1", { waiting: true }), conversation("C2", "4.5", "1", { waiting: true })];
  [found[1].channel, found[2].channel, found[3].channel] = ["#general", "", "general"];
  assert.deepEqual(table(found, owners), [
    "  #C1 alpha about 1.5", "C3", "  * about 3.5", "general", "  * about 4.5", "    about 2.5"]);
  delete found[1].permalink;
  assert.deepEqual(entries(found, owners).map((r) => [r.label, r.title, r.url, r.project]), [
    ["C3", "about 3.5", "https://x.slack.com/archives/C3/p35", null],
    ["general", "about 4.5", "https://x.slack.com/archives/C2/p45", null],
    ["#C1", "about 1.5", "https://x.slack.com/archives/C1/p15", "alpha"],
    ["#general", "about 2.5", null, null],
  ]);
});
