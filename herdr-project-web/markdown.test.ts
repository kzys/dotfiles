import assert from "node:assert/strict";
import { test } from "node:test";
import { plainInline, renderMarkdown } from "./markdown.ts";

test("renders notes without running their HTML", () => {
  const html = renderMarkdown(
    "## Remaining\n\n- [you] See https://x/1\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n",
  );
  assert.match(html, /<h2>Remaining<\/h2>/);
  assert.match(html, /<a href="https:\/\/x\/1" target="_blank" rel="noreferrer">/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|href="javascript:/);
  assert.doesNotMatch(renderMarkdown("![x](http://127.0.0.1:9/x)"), /<img/);
});

test("shows front matter as code", () => {
  const html = renderMarkdown("---\ntitle: T\nname: n\n---\n\n# Head\n");
  assert.match(html, /^<pre><code>title: T\nname: n\n<\/code><\/pre>\n<h1>Head<\/h1>/);
  assert.doesNotMatch(renderMarkdown("Text\n---\n"), /<pre>/);
  assert.doesNotMatch(renderMarkdown("Text\n\n---\nmore\n---\n"), /<pre>/);
  assert.equal(renderMarkdown("---\n---\nText\n"), "<pre><code>\n</code></pre>\n<p>Text</p>\n");
});

test("reads a line without its markup", () => {
  assert.equal(plainInline("Run `make` on **CI** via [it](https://x)"), "Run make on CI via it");
});
