// The YAML front matter of a project's README.md.

import { parse } from "yaml";

/** Returns field key from the front matter of README.md text, a list as
 * its items, one a line, or "" if it has no such field. The front matter
 * starts at the first line, between lines of ---. Agents write it by
 * hand, so if it isn't valid YAML, key's own line is read as it stands,
 * for a stray colon in the title not to hide that a project is closed. */
export function frontMatter(readme: string, key: string): string {
  const lines = readme.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 0) return "";
  const block = lines.slice(1, end);
  try {
    // The failsafe schema keeps a value like 1.10 the string it was written as.
    const value = parse(block.join("\n"), { schema: "failsafe" })?.[key];
    return Array.isArray(value) ? value.join("\n") : String(value ?? "");
  } catch {
    const line = block.find((l) => l.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).trim() : "";
  }
}
