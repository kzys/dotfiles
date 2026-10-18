// Colouring the code in diffs with Shiki, on the server, so the page
// doesn't load its grammars.

import { basename, extname } from "node:path";
import { type BundledLanguage, bundledLanguages, codeToTokens } from "shiki";
import { type FileDiff, type Token, hunkSides, parseDiff, withTokens } from "./diff.ts";
import type { WorktreeDiff } from "./worktrees.ts";

const THEME = "github-light";

// How many lines of a diff are highlighted at most. Highlighting blocks
// the server, at about 3,000 lines a second; files past this are left
// plain.
const MAX_LINES = 3000;

// How many diffs, by their text, are kept highlighted, as the page asks
// again whenever it regains focus.
const CACHED = 16;

/** Returns the language Shiki names for path, by its extension or, for
 * files like Makefile, its name, or null if it has none. */
export function language(path: string | null): BundledLanguage | null {
  if (!path) return null;
  const name = basename(path).toLowerCase();
  const ext = extname(name).slice(1);
  for (const key of [ext, name]) if (key && Object.hasOwn(bundledLanguages, key)) return key as BundledLanguage;
  return null;
}

/** Returns the tokens of each of lines in lang, or none without lang.
 * Tokens in the theme's own colour have none, so they take the page's. */
async function tokens(lines: string[], lang: BundledLanguage | null): Promise<Token[][]> {
  if (!lines.length || !lang) return [];
  const { tokens, fg } = await codeToTokens(lines.join("\n"), {
    lang,
    theme: THEME,
    // Longer lines, as in minified files, are slow and left plain.
    tokenizeMaxLineLength: 1000,
  });
  const plain = fg?.toLowerCase();
  return tokens.map((line) =>
    line.map((t) => (t.color && t.color.toLowerCase() !== plain ? [t.content, t.color] : [t.content])),
  );
}

/** Returns file with the lines of its hunks highlighted, each side of a
 * hunk as a whole in its file's language. Each hunk starts afresh, so
 * one that starts inside a comment or string is coloured wrong. Sides in
 * languages Shiki doesn't know, and files it fails on, are left plain. */
export async function highlight(file: FileDiff): Promise<FileDiff> {
  const oldLang = language(file.from);
  const newLang = language(file.to);
  if (!oldLang && !newLang) return file;
  try {
    const hunks = [];
    for (const h of file.hunks) {
      const [old, now] = hunkSides(h);
      hunks.push(withTokens(h, await tokens(old, oldLang), await tokens(now, newLang)));
    }
    return { ...file, hunks };
  } catch {
    return file;
  }
}

// A worktree's diff as the page shows it: in files, highlighted.
export type HighlightedDiff = Omit<WorktreeDiff, "diff"> & { fileDiffs: FileDiff[] };

const cache = new Map<string, FileDiff[]>();

/** Returns wt with its diff parsed into files and highlighted, in order,
 * up to MAX_LINES lines. */
export async function highlightDiff({ diff, ...wt }: WorktreeDiff): Promise<HighlightedDiff> {
  let files = cache.get(diff);
  if (!files) {
    files = [];
    let left = MAX_LINES;
    for (const f of parseDiff(diff)) {
      const lines = f.hunks.reduce((n, h) => n + h.lines.length, 0);
      if (lines > left) {
        files.push(f);
        continue;
      }
      left -= lines;
      files.push(await highlight(f));
    }
    cache.set(diff, files);
    if (cache.size > CACHED) cache.delete(cache.keys().next().value!);
  }
  return { ...wt, fileDiffs: files };
}
