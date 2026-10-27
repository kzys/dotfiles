import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type NotesText, notesTexts, projectOf } from "./owners.ts";

test("reads the projects' notes", () => {
  const root = mkdtempSync(join(tmpdir(), "owners-"));
  for (const d of ["b", "a", ".old"]) mkdirSync(join(root, d));
  writeFileSync(join(root, "b/README.md"), "b readme");
  writeFileSync(join(root, "a/AGENT-main.md"), "a main");
  writeFileSync(join(root, "a/README.md"), "a readme");
  writeFileSync(join(root, "a/NOTES.md"), "other");
  writeFileSync(join(root, ".old/README.md"), "hidden");
  writeFileSync(join(root, "file.md"), "not a project");
  assert.deepEqual(notesTexts(root), [
    [join(root, "a"), "main", "a main"],
    [join(root, "a"), null, "a readme"],
    [join(root, "b"), null, "b readme"],
  ]);
  assert.deepEqual(notesTexts(join(root, "none")), []);
});

test("prefers the latest project, and its last agent's notes to its README", () => {
  const texts: NotesText[] = [["/p/a", "main", "X-1"], ["/p/b", null, "X-1"], ["/p/b", "dev", "X-1"],
                              ["/p/b", "ops", "X-1"], ["/p/c", null, "X-2"]];
  assert.deepEqual(projectOf(/X-1/, [], texts, {}), { project: "/p/b", role: "ops" });
  assert.deepEqual(projectOf(/X-1/, [], texts.slice(0, 2), {}), { project: "/p/b", role: null });
  assert.deepEqual(projectOf(/X-2/, ["u"], texts, { u: { project: "/p/x" } }), { project: "/p/c", role: null });
  assert.deepEqual(projectOf(/X-3/, ["v", "u"], texts, { u: { project: "/p/x" }, v: null }), { project: "/p/x" });
});
