import assert from "node:assert/strict";
import { test } from "node:test";
import { type DiffLine, type Hunk, expandHunks, gapAt, parseDiff, splitRows, unquote } from "./diff.ts";

test("reads git's diffs into files and lines", () => {
  const text = [
    "diff --git a/a.txt b/a.txt",
    "index 1..2 100644",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,3 +1,2 @@ heading",
    " one",
    "--- two",
    "-three",
    "\\ No newline at end of file",
    "+three",
    "diff --git a/old b/new",
    "similarity index 100%",
    "rename from old",
    "rename to new",
    "diff --git \"a/sp ace\" \"b/sp ace\"",
    "new file mode 100644",
    "Binary files /dev/null and \"b/sp ace\" differ",
    "",
  ].join("\n");
  const [a, renamed, binary] = parseDiff(text);
  assert.deepEqual([a.from, a.to, a.status, a.added, a.removed], ["a.txt", "a.txt", "modified", 1, 2]);
  assert.deepEqual(a.hunks[0].lines.map((l) => [l.kind, l.old, l.new, l.text]), [
    ["ctx", 1, 1, "one"],
    ["del", 2, null, "-- two"],
    ["del", 3, null, "three"],
    ["note", null, null, "No newline at end of file"],
    ["add", null, 2, "three"],
  ]);
  assert.deepEqual([renamed.from, renamed.to, renamed.status, renamed.hunks], ["old", "new", "renamed", []]);
  assert.deepEqual([binary.from, binary.to, binary.status, binary.binary], [null, "sp ace", "added", true]);
  assert.equal(unquote(String.raw`"caf\303\251\t\"x\""`), 'caf\u00e9\t"x"');
  assert.equal(unquote("plain"), "plain");
});

test("puts removed lines beside the added lines after them", () => {
  const [file] = parseDiff([
    "diff --git a/f b/f", "--- a/f", "+++ b/f",
    "@@ -1,6 +1,5 @@", " a", "-b", "-c", "+B", " d", "-e", "+E", "+F", "\\ No newline at end of file",
    "-g", "\\ No newline at end of file",
    "",
  ].join("\n"));
  const text = (l: { text: string } | null) => l?.text ?? null;
  assert.deepEqual(splitRows(file.hunks[0]).map(([o, n]) => [text(o), text(n)]), [
    ["a", "a"], ["b", "B"], ["c", null], ["d", "d"], ["e", "E"], [null, "F"],
    [null, "No newline at end of file"], ["g", null], ["No newline at end of file", null],
  ]);
});

const line = (n: number, offset = 0): DiffLine => ({ kind: "ctx", text: `l${n}`, old: n + offset, new: n });
const hunk = (header: string): Hunk => ({ header, lines: [] });

test("finds the gaps around hunks", () => {
  const hunks = [hunk("@@ -5,3 +7,4 @@ f()"), hunk("@@ -20,2 +22,2 @@")];
  assert.deepEqual(gapAt(hunks, 0), { from: 1, to: 6, offset: -2 });
  assert.deepEqual(gapAt(hunks, 1), { from: 11, to: 21, offset: -2 });
  assert.deepEqual(gapAt(hunks, 2), { from: 24, to: null, offset: -2 });
});

test("finds no gap where hunks touch, the file starts, or it has no last newline", () => {
  assert.equal(gapAt([hunk("@@ -1,3 +1,3 @@")], 0), null);
  assert.equal(gapAt([hunk("@@ -1,3 +1,3 @@"), hunk("@@ -4,1 +4,1 @@")], 1), null);
  const ended: Hunk = { header: "@@ -1,1 +1,1 @@", lines: [{ kind: "note", text: "No newline", old: null, new: null }] };
  assert.equal(gapAt([ended], 1), null);
});

test("a file with no hunks has no gaps", () => {
  assert.equal(gapAt([], 0), null);
});

test("numbers the old file past the last hunk by where that hunk ends", () => {
  assert.deepEqual(gapAt([hunk("@@ -1,10 +1,13 @@")], 1), { from: 14, to: null, offset: -3 });
});

test("reads a hunk that only adds or only removes", () => {
  assert.deepEqual(gapAt([hunk("@@ -5,0 +6,2 @@")], 0), { from: 1, to: 5, offset: 0 });
  assert.deepEqual(gapAt([hunk("@@ -6,2 +5,0 @@")], 0), { from: 1, to: 5, offset: 0 });
});

test("adds lines to the hunks around a gap", () => {
  const hunks = [hunk("@@ -5,3 +7,4 @@ f()"), hunk("@@ -20,2 +22,2 @@")];
  const up = expandHunks(hunks, 1, [line(20, -2), line(21, -2)], "end");
  assert.equal(up[1].header, "@@ -18,4 +20,4 @@");
  const down = expandHunks(up, 1, [line(11, -2)], "start");
  assert.equal(down[0].header, "@@ -5,4 +7,5 @@ f()");
  assert.deepEqual(gapAt(down, 1), { from: 12, to: 19, offset: -2 });
  assert.equal(expandHunks(hunks, 2, [line(24, -2)], "start")[1].header, "@@ -20,3 +22,3 @@");
});

test("joins hunks once they touch", () => {
  const hunks = [hunk("@@ -1,2 +1,2 @@"), hunk("@@ -6,2 +6,2 @@")];
  const joined = expandHunks(hunks, 1, [3, 4, 5].map((n) => line(n)), "start");
  assert.equal(joined.length, 1);
  assert.equal(joined[0].header, "@@ -1,7 +1,7 @@");
  assert.deepEqual(joined[0].lines.map((l) => l.new), [3, 4, 5]);
});
