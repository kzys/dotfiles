import assert from "node:assert/strict";
import { test } from "node:test";
import { frontMatter } from "./frontmatter.ts";

test("reads YAML front matter", () => {
  const readme = "---\ntitle: \"A: b\"\nname: 1.10\nrepositories:\n  - ~/repos/o/a\n  - ~/repos/o/b\nclosed:\n---\ntitle: body\n";
  assert.equal(frontMatter(readme, "title"), "A: b");
  assert.equal(frontMatter(readme, "name"), "1.10");
  assert.equal(frontMatter(readme, "repositories"), "~/repos/o/a\n~/repos/o/b");
  assert.equal(frontMatter(readme, "closed"), "");
  assert.equal(frontMatter(readme, "missing"), "");
});

test("reads a field's line if the front matter isn't valid YAML", () => {
  const readme = "---\ntitle: Fix: a bug\nclosed: https://x/1\n---\n";
  assert.equal(frontMatter(readme, "title"), "Fix: a bug");
  assert.equal(frontMatter(readme, "closed"), "https://x/1");
  assert.equal(frontMatter(readme, "name"), "");
});

test("finds no front matter where there is none to read", () => {
  assert.equal(frontMatter("title: a\n", "title"), "");
  assert.equal(frontMatter("---\ntitle: a\n", "title"), "");
  assert.equal(frontMatter("---\n- a\n---\n", "title"), "");
  assert.equal(frontMatter("---\n---\n", "title"), "");
});
