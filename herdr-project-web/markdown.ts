// Markdown, such as the agents' notes and LEARNINGS.md, as HTML for the
// page.

import MarkdownIt from "markdown-it";

// Raw HTML in the text stays text, and markdown-it drops links to
// javascript: and other unsafe URLs, so the HTML is safe to show. Images
// stay text too: notes can quote untrusted text, and an image would
// make the page fetch whatever URL it names.
export const md = new MarkdownIt({ html: false, linkify: true }).disable("image");
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noreferrer");
  return self.renderToken(tokens, idx, options);
};

/** Returns Markdown text with its front matter, which Markdown doesn't
 * know and would read as a heading, as code, on the same lines. */
function fencedFrontMatter(text: string): string {
  const front = text.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/);
  if (!front) return text;
  // A fence longer than any run of backticks in it.
  const body = front[1] ?? "";
  const fence = "`".repeat(Math.max(3, ...(body.match(/`+/g) ?? []).map((r) => r.length + 1)));
  const lines = front[1] === undefined ? "" : `${body}\n`;
  return `${fence}\n${lines}${fence}\n${text.slice(front[0].length)}`;
}

/** Returns Markdown text as HTML, its links opening in a new tab, and its
 * front matter as code. */
export const renderMarkdown = (text: string): string => md.render(fencedFrontMatter(text));

/** An element of rendered Markdown. html is what it holds if it holds no
 * elements of its own, and at is where it comes from if it can take a
 * comment: its first line, from 1, and its source. */
export type MarkdownNode = {
  tag: string;
  attrs: Record<string, string | number>;
  html: string | null;
  nodes: MarkdownNode[];
  at: { line: number; code: string } | null;
};

// The blocks that take comments: those that hold text, and tables whole.
const COMMENTABLE = new Set(["paragraph_open", "heading_open", "fence", "code_block", "table_open"]);

/** Returns Markdown text as renderMarkdown shows it, as elements that say
 * which lines of text they come from, so a page can put comments on them.
 * The text of a tight list's item is a paragraph here too, and code has no
 * language class. */
export function markdownTree(text: string): MarkdownNode[] {
  // Lines as markdown-it counts them.
  const source = text.split(/\r\n?|\n/);
  const root: MarkdownNode = { tag: "div", attrs: {}, html: null, nodes: [], at: null };
  const open = [root];
  for (const t of md.parse(fencedFrontMatter(text), {})) {
    const parent = open[open.length - 1];
    if (t.nesting === -1) {
      open.pop();
    } else if (t.type === "inline") {
      parent.html = md.renderer.renderInline(t.children ?? [], md.options, {});
    } else {
      const code = t.type === "fence" || t.type === "code_block";
      const node: MarkdownNode = {
        tag: code ? "pre" : t.tag,
        attrs: Object.fromEntries(t.attrs ?? []),
        html: code ? `<code>${md.utils.escapeHtml(t.content)}</code>` : null,
        nodes: [],
        at: COMMENTABLE.has(t.type) && t.map
          ? { line: t.map[0] + 1, code: source.slice(t.map[0], t.map[1]).join("\n").trimEnd() }
          : null,
      };
      parent.nodes.push(node);
      if (t.nesting === 1) open.push(node);
    }
  }
  return root.nodes;
}

/** Returns the blocks of nodes, however deep, that can take a comment. */
export const commentable = (nodes: MarkdownNode[]): NonNullable<MarkdownNode["at"]>[] =>
  nodes.flatMap((n) => (n.at ? [n.at] : commentable(n.nodes)));

/** Returns one line of Markdown, such as a heading, as inline HTML. */
export const renderInline = (text: string): string => md.renderInline(text);

/** Returns one line of Markdown as plain text, without its markup. */
export function plainInline(text: string): string {
  return md
    .parseInline(text, {})
    .flatMap((t) => t.children ?? [])
    .map((t) => (t.type === "text" || t.type === "code_inline" ? t.content : ""))
    .join("");
}
