import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseLearnings, readLearnings } from "./learnings.ts";

test("reads the LEARNINGS.md of each organization", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  for (const org of ["b", "a", "none"]) mkdirSync(join(root, org));
  writeFileSync(join(root, "b", "LEARNINGS.md"), "## B\n\n- b\n");
  writeFileSync(join(root, "a", "LEARNINGS.md"), "## A\n\n- a\n");
  assert.deepEqual(readLearnings(root), [
    { org: "a", path: join(root, "a", "LEARNINGS.md"), topics: [{ heading: "A", items: ["- a"] }] },
    { org: "b", path: join(root, "b", "LEARNINGS.md"), topics: [{ heading: "B", items: ["- b"] }] },
  ]);
  assert.deepEqual(readLearnings(join(root, "gone")), []);
});

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
