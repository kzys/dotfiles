import assert from "node:assert/strict";
import { test } from "node:test";
import { codeParts, parseLearnings } from "./learnings.ts";

test("reads the topics of a LEARNINGS.md", () => {
  const text = [
    "# Learnings", "", "Facts from finished projects.", "",
    "## Git", "", "- `git ls-remote` exits 0", "  without the tag.", "- Fetch first.", "",
    "## Fonts", "A paragraph", "on two lines.", "", "* Another bullet", "",
    "## Empty", "",
  ].join("\r\n");
  assert.deepEqual(parseLearnings(text), [
    { heading: "Git", items: ["`git ls-remote` exits 0 without the tag.", "Fetch first."] },
    { heading: "Fonts", items: ["A paragraph on two lines.", "Another bullet"] },
    { heading: "Empty", items: [] },
  ]);
});

test("splits code spans out of text", () => {
  assert.deepEqual(codeParts("Run `a` and `b`, not `c"), [
    ["Run ", false], ["a", true], [" and ", false], ["b", true], [", not `c", false],
  ]);
  assert.deepEqual(codeParts("`x`"), [["x", true]]);
});
