import assert from "node:assert/strict";
import { test } from "node:test";
import { type MarkdownNode, commentable, markdownTree, plainInline, renderMarkdown } from "./markdown.ts";

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
  assert.equal(renderMarkdown("---\n---\nText\n"), "<pre><code></code></pre>\n<p>Text</p>\n");
});

test("reads a line without its markup", () => {
  assert.equal(plainInline("Run `make` on **CI** via [it](https://x)"), "Run make on CI via it");
});

const blocks = (text: string) => commentable(markdownTree(text));

test("finds the source lines of each block", () => {
  const text = [
    "# Head", "", "Two", "lines", "", "- item", "  wrapped", "  - nested", "", "> quote", "", "```", "x", "```", "",
    "| a |", "|---|", "| b |", "", "---", "", "    indented", "", "",
  ].join("\n");
  assert.deepEqual(blocks(text), [
    { line: 1, code: "# Head" },
    { line: 3, code: "Two\nlines" },
    { line: 6, code: "- item\n  wrapped" },
    { line: 8, code: "  - nested" },
    { line: 10, code: "> quote" },
    { line: 12, code: "```\nx\n```" },
    { line: 16, code: "| a |\n|---|\n| b |" },
    { line: 22, code: "    indented" },
  ]);
});

test("keeps lines right after front matter", () => {
  assert.deepEqual(blocks("---\ntitle: T\n---\n\nText\n"), [
    { line: 1, code: "---\ntitle: T\n---" },
    { line: 5, code: "Text" },
  ]);
  assert.deepEqual(blocks("---\n---\nText\n"), [{ line: 1, code: "---\n---" }, { line: 3, code: "Text" }]);
  assert.deepEqual(blocks("---\r\na: 1\r\n---\r\nText\r\n"), [{ line: 1, code: "---\na: 1\n---" }, { line: 4, code: "Text" }]);
  assert.deepEqual(blocks("one\n\ntwo\rthree\n\nfour\n"), [
    { line: 1, code: "one" }, { line: 3, code: "two\nthree" }, { line: 6, code: "four" },
  ]);
});

/** Returns nodes as HTML, as the page would show them. */
const html = (nodes: MarkdownNode[]): string =>
  nodes.map((n) => {
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
    return n.tag === "hr" ? `<hr${attrs}>` : `<${n.tag}${attrs}>${n.html ?? html(n.nodes)}</${n.tag}>`;
  }).join("");

test("shows what renderMarkdown shows, as safely", () => {
  const text = "## T\n\n1. See https://x/1\n\n3. <b>x</b> [bad](javascript:alert(1))\n\n---\n\n| a |\n|--:|\n| *b* |\n\n```js\n<i>\n```\n";
  const shown = html(markdownTree(text));
  assert.match(shown, /<h2>T<\/h2>/);
  assert.match(shown, /<a href="https:\/\/x\/1" target="_blank" rel="noreferrer">/);
  assert.match(shown, /&lt;b&gt;x/);
  assert.match(shown, /<td style="text-align:right"><em>b<\/em><\/td>/);
  assert.match(shown, /<pre><code>&lt;i&gt;\n<\/code><\/pre>/);
  assert.match(shown, /<hr>/);
  assert.doesNotMatch(shown, /<b>|<i>|href="javascript:/);
  assert.match(html(markdownTree("5. x\n")), /<ol start="5">/);
});

test("shows a title and a name as such, with the other fields", () => {
  const text = "---\ntitle: \"<A>: b\"\nname: n\nclosed: https://x/1\n---\n\nText\n";
  const [front, body] = markdownTree(text);
  assert.equal(
    html([front]),
    '<div class="front-matter"><h1>&lt;A&gt;: b</h1><p class="front-name">n</p><pre class="front-others">closed: https://x/1</pre></div>',
  );
  assert.deepEqual(front.at, { line: 1, code: "---\ntitle: \"<A>: b\"\nname: n\nclosed: https://x/1\n---" });
  assert.equal(body.at?.line, 7);
  assert.equal(html(markdownTree("---\nname: n\n---\n")), '<div class="front-matter"><p class="front-name">n</p></div>');
});

test("reads front matter as YAML", () => {
  const front = (text: string) => html(markdownTree(text).slice(0, 1));
  assert.equal(
    front("---\ntitle: |\n  one\n  two\nclosed:\nrepositories:\n  - a\n---\n"),
    '<div class="front-matter"><h1>one\ntwo</h1><pre class="front-others">closed:\nrepositories:\n  - a</pre></div>',
  );
  assert.equal(front('---\n"name": 1.10\n---\n'), '<div class="front-matter"><p class="front-name">1.10</p></div>');
  assert.equal(front("---\r\ntitle: A\r\n---\r\n"), '<div class="front-matter"><h1>A</h1></div>');
});

test("leaves other front matter as code", () => {
  const code = (body: string) => `<pre><code>${body}\n</code></pre>`;
  assert.equal(html(markdownTree("---\nkey: v\n---\n")), code("key: v"));
  assert.equal(html(markdownTree("---\ntitle: {en: A}\n---\n")), code("title: {en: A}"));
  assert.equal(html(markdownTree("---\ntitle: Fix: a bug\n---\n")), code("title: Fix: a bug"));
  assert.equal(html(markdownTree("---\n- a\n---\n")), code("- a"));
});
