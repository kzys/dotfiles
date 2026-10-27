import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLearnings } from "./learnings.ts";

test("reads the topics of a LEARNINGS.md", () => {
  const text = [
    "# Learnings", "", "Facts from finished projects.", "",
    "## Git", "", "- `git ls-remote` exits 0", "  without the tag.", "  - nested", "- Fetch first.", "",
    "## Fonts", "A paragraph", "on two lines.", "", "1. Numbered", "", "```", "## not a heading", "```", "",
    "## Empty", "",
  ].join("\r\n");
  assert.deepEqual(parseLearnings(text), [
    { heading: "Git", items: ["- `git ls-remote` exits 0\n  without the tag.\n  - nested", "- Fetch first."] },
    { heading: "Fonts", items: ["A paragraph\non two lines.", "1. Numbered", "```\n## not a heading\n```"] },
    { heading: "Empty", items: [] },
  ]);
  // Lone carriage returns end lines too.
  assert.deepEqual(parseLearnings("## A\rpara\r\r- x\r## B\r- y"), [
    { heading: "A", items: ["para", "- x"] },
    { heading: "B", items: ["- y"] },
  ]);
});
