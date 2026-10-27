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

/** Returns Markdown text as HTML, its links opening in a new tab. Front
 * matter, which Markdown doesn't know and would read as a heading, is
 * shown as code. */
export function renderMarkdown(text: string): string {
  const front = text.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/);
  if (!front) return md.render(text);
  // A fence longer than any run of backticks in it.
  const body = front[1] ?? "";
  const fence = "`".repeat(Math.max(3, ...(body.match(/`+/g) ?? []).map((r) => r.length + 1)));
  return md.render(`${fence}\n${body}\n${fence}\n${text.slice(front[0].length)}`);
}

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
