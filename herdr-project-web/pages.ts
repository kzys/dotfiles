// The page's views, by its location after the #.

export type Route =
  | { view: "projects" }
  | { view: "worktrees" }
  | { view: "diff"; dir: string }
  | { view: "learnings" };

/** Returns s decoded from a URL, or as is if it isn't encoded right. */
export function decodeHash(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Returns the view at hash, the page's location after its #. Any hash
 * the page doesn't know shows the projects. */
export function route(hash: string): Route {
  if (hash === "diffs") return { view: "worktrees" };
  if (hash.startsWith("diffs/")) return { view: "diff", dir: decodeHash(hash.slice("diffs/".length)) };
  if (hash === "learnings") return { view: "learnings" };
  return { view: "projects" };
}

/** Returns the tab of the page's console strip that r is under. */
export function tab(r: Route): "projects" | "worktrees" | "learnings" {
  return r.view === "diff" ? "worktrees" : r.view;
}

/** Returns the title of the view at r. */
export function pageTitle(r: Route): string {
  switch (r.view) {
    case "worktrees":
      return "Worktrees";
    case "diff":
      return `${r.dir.split("/").filter(Boolean).pop() ?? "Worktree"} · Diff`;
    case "learnings":
      return "Learnings";
    case "projects":
      return "Projects";
  }
}
