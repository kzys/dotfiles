// The LEARNINGS.md files in ~/repos, one for each GitHub organization,
// where finished projects leave what a later task would need.

// A heading of a LEARNINGS.md and the bullets and paragraphs under it.
export type Topic = { heading: string; items: string[] };

export type Learnings = { org: string; path: string; topics: Topic[] };

/** Returns the topics of a LEARNINGS.md, by its second-level headings.
 * Text before the first of them, such as its title, is left out. Each
 * "-" or "*" bullet or paragraph is one item, its lines joined by
 * spaces. Nested bullets become items of their own; numbered lists
 * and fenced code aren't recognized. */
export function parseLearnings(text: string): Topic[] {
  const topics: Topic[] = [];
  let open = false;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.*?)\s*$/);
    if (heading) {
      topics.push({ heading: heading[1], items: [] });
      open = false;
      continue;
    }
    const topic = topics.at(-1);
    if (!topic) continue;
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      topic.items.push(bullet[1].trim());
      open = true;
    } else if (!line.trim()) {
      open = false;
    } else if (open) {
      topic.items[topic.items.length - 1] += ` ${line.trim()}`;
    } else {
      topic.items.push(line.trim());
      open = true;
    }
  }
  return topics;
}

/** Returns text split into plain parts and code spans, each code span
 * marked true. An unclosed backtick is left as text. */
export function codeParts(text: string): [string, boolean][] {
  return text
    .split(/`([^`]+)`/g)
    .map((p, i): [string, boolean] => [p, i % 2 === 1])
    .filter(([p]) => p);
}
