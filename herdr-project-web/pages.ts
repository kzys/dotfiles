// The page's views, by its location after the #.

/** Returns s decoded from a URL, or as is if it isn't encoded right. */
export function decodeHash(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Returns the title of the view at hash, the page's location after its
 * #. */
export function pageTitle(hash: string): string {
  if (hash === "diffs") return "Worktrees";
  if (hash.startsWith("diffs/")) {
    const dir = decodeHash(hash.slice("diffs/".length));
    return `${dir.split("/").filter(Boolean).pop() ?? "Worktree"} · Diff`;
  }
  return "Projects";
}
