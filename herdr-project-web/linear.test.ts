import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Issue, events, owner, poll, remember } from "./linear.ts";
import type { NotesText, Owner } from "./owners.ts";

function issue(identifier: string, updated_at: string,
               { waiting = false, links = [] as string[], state = "Backlog" } = {}): Issue {
  return { identifier, title: `Title ${identifier}`, state, url: `https://linear.app/x/issue/${identifier}`,
           updated_at, summary: `about ${identifier}`, waiting_on_me: waiting, links };
}

test("finds the projects of Linear issues", () => {
  const texts: NotesText[] = [["/p/a", "main", "tracks ABC-123 and ABC-12"], ["/p/b", null, "XABC-7 XYZ-45"]];
  const prOwners: Record<string, Owner> = { "https://github.com/o/r/pull/1": { project: "/p/x" } };
  const find = (i: Issue) => owner(i, texts, prOwners)?.project ?? null;
  assert.equal(find(issue("ABC-123", "")), "/p/a");
  assert.equal(find(issue("ABC-1", "")), null);
  assert.equal(find(issue("ABC-7", "")), null);
  assert.equal(find(issue("XYZ-45", "")), "/p/b");
  assert.equal(find(issue("ABC-9", "", { links: ["https://github.com/o/r/pull/1"] })), "/p/x");
});

test("polls Linear", async () => {
  const dir = mkdtempSync(join(tmpdir(), "linear-"));
  mkdirSync(join(dir, "a"));
  const texts: NotesText[] = [[join(dir, "a"), "main", "ABC-2"]];
  const runs = [
    [issue("ABC-1", "2026-10-15T00:00Z", { waiting: true }), issue("ABC-2", "2026-10-14T00:00Z")],
    [issue("ABC-1", "2026-10-15T00:00Z", { waiting: true }),
     issue("ABC-2", "2026-10-16T00:00Z", { waiting: true, state: "In Progress" }),
     issue("ABC-3", "2026-10-13T00:00Z")],
  ];
  const calls: string[][] = [];
  const notify = async (title: string, body: string) => calls.push([title, body]);
  const state = join(dir, "state/linear.json");
  const now = new Date("2026-10-16T00:00:00Z");
  const fetch = async () => runs.shift()!;
  const blank = " ".repeat(20);

  assert.deepEqual((await poll(notify, texts, state, {}, fetch, now)).lines, [
    `* ABC-1     Backlog     ${blank} about ABC-1`,
    `  ABC-2     Backlog     ${"a".padEnd(20)} about ABC-2`,
  ]);
  assert.deepEqual(calls, []);
  const { lines, rows } = await poll(notify, texts, state, {}, fetch, now);
  assert.deepEqual(lines, [
    `* ABC-2     In Progress ${"a".padEnd(20)} about ABC-2`,
    `* ABC-1     Backlog     ${blank} about ABC-1`,
    `  ABC-3     Backlog     ${blank} about ABC-3`,
  ]);
  assert.deepEqual(rows[0], { label: "ABC-2", title: "Title ABC-2", note: "about ABC-2", detail: "In Progress",
                              url: "https://linear.app/x/issue/ABC-2", waiting: true, project: "a" });
  assert.deepEqual((rows as { label: string }[]).map((r) => r.label), ["ABC-2", "ABC-1", "ABC-3"]);
  assert.deepEqual(calls, [["Linear ABC-2", "about ABC-2 (a)"]]);
});

test("compares times however Claude writes them", () => {
  const now = new Date("2026-10-16T00:00:00Z");
  const old = remember(null, [issue("ABC-1", "2026-10-15T10:00:00.000Z", { waiting: true }),
                              issue("ABC-2", "yesterday", { waiting: true }),
                              issue("ABC-3", "2026-08-01T00:00:00Z")], now);
  assert.deepEqual(old, { "ABC-1": "2026-10-15T10:00:00", "ABC-2": "yesterday" });
  const again = [issue("ABC-1", "2026-10-15T03:00:00-07:00", { waiting: true }),
                 issue("ABC-2", "yesterday", { waiting: true })];
  assert.deepEqual(events(old, again), []);
  // As the Python watcher kept them, and with zones written oddly.
  assert.deepEqual(events({ "RUN-1": "2026-10-16T21:23:57", "RUN-2": "2026-10-01T07:34:56" }, [
    issue("RUN-1", "2026-10-16T21:23:57.123Z", { waiting: true }),
    issue("RUN-2", "2026-10-01T12:34:56+05", { waiting: true }),
  ]), []);
  // One left out doesn't count as new when it is back.
  assert.deepEqual(remember(old, [], now), old);
});
