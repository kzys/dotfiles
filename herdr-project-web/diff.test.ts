import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiff, splitRows, unquote } from "./diff.ts";

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
