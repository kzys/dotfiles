// What waits on the user in a project's notes, as herdr_project/inbox.py
// finds it for the picker. Keep the two in step.

export type Item = {
  project: string | null;
  role: string | null;
  mark: string;
  text: string;
};

// Untagged items that likely wait on the user, in notes written before
// agents were told to tag them.
const LIKELY = new RegExp(
  String.raw`\b(decide|not (?:yet )?decided|needs? (?:a )?decision|decision (?:needed|pending)` +
    String.raw`|approve|approval|ask(?: the)? user|needs? (?:the )?user|open for (?:the )?user` +
    String.raw`|(?:agree|discuss|confirm|check)\w*\b.{0,40}?\bwith (?:the )?user` +
    String.raw`|user (?:to|ok(?:ay)?|decides?|says|wants|asks)|when (?:the )?user` +
    String.raw`|reviewed, not pushed|local only|not pushed per user)\b|\((?:ask|user)\)`,
  "i",
);

// Untagged items that the user may want to act on but nothing waits
// for, such as offers to follow up.
const SOFT = /^(?:optional(?:ly)?|offers?)\b|\b(?:if|unless) (?:the )?user (?:wants|asks)/i;

// Untagged items starting with these say nothing waits.
const SETTLED = ["none", "nothing", "done", "[x]"];

// The order of marks in the inbox, most pressing first.
const ORDER: Record<string, number> = { you: 0, "?": 1, maybe: 2, close: 3 };

const isSettled = (item: string) => SETTLED.some((s) => item.toLowerCase().startsWith(s));

/** Returns the items of the "## Remaining" section of notes text: each
 * line starting with "- ", with the indented lines after it. */
export function remainingItems(text: string): string[] {
  const items: string[] = [];
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      inSection = line === "## Remaining";
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith("- ")) items.push(line.slice(2).trim());
    else if (items.length && /^[ \t]/.test(line) && line.trim())
      items[items.length - 1] += " " + line.trim();
  }
  return items;
}

/** Returns how item waits on the user: "you" if it is tagged [you],
 * "maybe" if it is untagged and only offers something, "?" if it is
 * untagged and likely does, or null. */
export function waiting(item: string): string | null {
  if (item.toLowerCase().startsWith("[you]")) return "you";
  if (item.startsWith("[ ]")) item = item.slice(3).trim(); // An unticked task list item.
  if (item.startsWith("[") || isSettled(item)) return null;
  if (SOFT.test(item)) return "maybe";
  return LIKELY.test(item) ? "?" : null;
}

/** Returns field key from the front matter of README.md text, "" if it
 * has no such field. The front matter starts at the first line, between
 * lines of ---. */
export function frontMatter(readme: string, key: string): string {
  const lines = readme.split("\n");
  if (lines[0] !== "---") return "";
  for (const line of lines.slice(1)) {
    if (line === "---") break;
    if (line.startsWith(`${key}:`)) return line.slice(key.length + 1).trim();
  }
  return "";
}

/** Reports whether the agent's notes text close its role, with a line
 * starting with "closed:" and a link or a few words, before the first
 * section. */
export function roleClosed(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) return false;
    if (line.startsWith("closed:") && line.slice("closed:".length).trim()) return true;
  }
  return false;
}

/** Reports whether the agent's notes text look finished: their
 * "## Remaining" section has items, all saying nothing is left or
 * ticked. An empty section may only not be written yet. */
export function settled(text: string): boolean {
  if (!text.split(/\r?\n/).includes("## Remaining")) return false;
  const items = remainingItems(text);
  return items.length > 0 && items.every(isSettled);
}

/** Returns where item goes in the inbox, the most pressing first; what
 * the watcher found goes with the likely ones. */
export const rank = (item: Item) => ORDER[item.mark] ?? ORDER["?"];

/** Returns what waits on the user in the project in directory, whose
 * README.md is readme, or null if it has none, and whose notes are
 * [role, text] pairs, followed by watched, the watcher's items for it,
 * the most pressing first. If the watcher found nothing, it also
 * suggests closing the project when every open role looks finished, or
 * else each role that does. A closed project has none. */
export function projectItems(
  directory: string,
  readme: string | null,
  notes: [string, string][],
  watched: Item[] = [],
): Item[] {
  if (readme !== null && frontMatter(readme, "closed")) return [];
  const open = notes.filter(([, t]) => !roleClosed(t));
  const items: Item[] = [];
  for (const [role, text] of open) {
    for (const item of remainingItems(text)) {
      const mark = waiting(item);
      if (mark)
        items.push({
          project: directory,
          role,
          mark,
          text: mark === "you" ? item.slice("[you]".length).trim() : item,
        });
    }
  }
  items.push(...watched);
  if (watched.length) return items.sort((a, b) => rank(a) - rank(b));
  if (notes.length && open.every(([, t]) => settled(t)))
    return [{ project: directory, role: null, mark: "close",
              text: "Nothing remaining; tell its agent the task is done to close it" }];
  for (const [role, text] of open)
    if (settled(text))
      items.push({ project: directory, role, mark: "close",
                   text: `Nothing remaining for ${role}; tell its agent its part is done to close it` });
  return items.sort((a, b) => rank(a) - rank(b));
}

/** Returns the watcher's inbox items from sources, the contents of
 * inbox.json by source, skipping any not in the form it writes. */
export function watchedItems(sources: unknown): Item[] {
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) return [];
  const strOrNull = (v: unknown) => typeof v === "string" || v === null || v === undefined;
  return Object.values(sources)
    .filter(Array.isArray)
    .flat()
    .filter((i): i is Item =>
      !!i && typeof i === "object" && typeof i.text === "string" &&
      typeof i.mark === "string" && strOrNull(i.project) && strOrNull(i.role))
    .map((i) => ({ ...i, project: i.project ?? null, role: i.role ?? null }));
}
