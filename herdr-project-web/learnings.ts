// The LEARNINGS.md files in ~/repos, one for each GitHub organization,
// where finished projects leave what a later task would need.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { md } from "./markdown.ts";

// A heading of a LEARNINGS.md and the blocks under it, as Markdown.
export type Topic = { heading: string; items: string[] };

export type Learnings = { org: string; path: string; topics: Topic[] };

/** Returns the LEARNINGS.md of each organization in reposRoot, laid out
 * as <org>/LEARNINGS.md, in order of the organizations' names. */
export function readLearnings(reposRoot: string): Learnings[] {
  let orgs: string[];
  try {
    orgs = readdirSync(reposRoot).sort();
  } catch {
    return [];
  }
  return orgs.flatMap((org) => {
    const path = join(reposRoot, org, "LEARNINGS.md");
    try {
      return [{ org, path, topics: parseLearnings(readFileSync(path, "utf8")) }];
    } catch {
      return [];
    }
  });
}

/** Returns the topics of a LEARNINGS.md, by its second-level headings.
 * Text before the first of them, such as its title, is left out. Each
 * item is the Markdown of one block under the heading, such as a
 * paragraph, or of one item of a list, with its marker and anything
 * nested in it. */
export function parseLearnings(text: string): Topic[] {
  // Lines as markdown-it counts them.
  const lines = text.split(/\r\n?|\n/);
  const source = (map: [number, number] | null) =>
    map ? lines.slice(map[0], map[1]).join("\n").trimEnd() : "";
  const tokens = md.parse(text, {});
  const topics: Topic[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Only the blocks at the top, each where it starts.
    if (t.level !== 0 || t.nesting === -1 || !t.map) continue;
    if (t.type === "heading_open" && t.tag === "h2") {
      topics.push({ heading: tokens[i + 1].content, items: [] });
      continue;
    }
    const topic = topics.at(-1);
    if (!topic) continue;
    if (t.type === "bullet_list_open" || t.type === "ordered_list_open") {
      for (let j = i + 1; j < tokens.length && !(tokens[j].level === 0 && tokens[j].nesting === -1); j++)
        if (tokens[j].type === "list_item_open" && tokens[j].level === 1) topic.items.push(source(tokens[j].map));
    } else {
      topic.items.push(source(t.map));
    }
  }
  return topics;
}
