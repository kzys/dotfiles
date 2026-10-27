// The page's views, by its location after the #.

export type Route =
  | { view: "projects" }
  | { view: "worktrees" }
  | { view: "diff"; dir: string }
  | { view: "file"; dir: string; name: string }
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
  if (hash.startsWith("files/")) {
    const [dir = "", name = ""] = hash.slice("files/".length).split("/");
    return { view: "file", dir: decodeHash(dir), name: decodeHash(name) };
  }
  if (hash === "learnings") return { view: "learnings" };
  return { view: "projects" };
}

/** Returns the tab of the page's console strip that r is under. */
export function tab(r: Route): "projects" | "worktrees" | "learnings" {
  return r.view === "diff" ? "worktrees" : r.view === "file" ? "projects" : r.view;
}

/** Returns the link to the page of the file called name in the project
 * in dir. */
export const fileHref = (dir: string, name: string) =>
  `#files/${encodeURIComponent(dir)}/${encodeURIComponent(name)}`;

/** Returns the title of the view at r. */
export function pageTitle(r: Route): string {
  switch (r.view) {
    case "worktrees":
      return "Worktrees";
    case "diff":
      return `${r.dir.split("/").filter(Boolean).pop() ?? "Worktree"} · Diff`;
    case "file":
      return `${r.name} · ${r.dir.split("/").filter(Boolean).pop() ?? "Project"}`;
    case "learnings":
      return "Learnings";
    case "projects":
      return "Projects";
  }
}
