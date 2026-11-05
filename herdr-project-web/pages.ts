// The page's views, by its location after the #.

export type Route =
  | { view: "inbox" }
  | { view: "projects" }
  | { view: "project"; dir: string }
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
 * the page doesn't know shows the inbox. */
export function route(hash: string): Route {
  if (hash === "projects") return { view: "projects" };
  if (hash.startsWith("projects/")) return { view: "project", dir: decodeHash(hash.slice("projects/".length)) };
  if (hash === "diffs") return { view: "worktrees" };
  if (hash.startsWith("diffs/")) return { view: "diff", dir: decodeHash(hash.slice("diffs/".length)) };
  if (hash.startsWith("files/")) {
    const [dir = "", name = ""] = hash.slice("files/".length).split("/");
    return { view: "file", dir: decodeHash(dir), name: decodeHash(name) };
  }
  if (hash === "learnings") return { view: "learnings" };
  return { view: "inbox" };
}

/** Returns the tab of the page's console strip that r is under. */
export function tab(r: Route): "inbox" | "projects" | "worktrees" | "learnings" {
  return r.view === "diff" ? "worktrees" : r.view === "file" || r.view === "project" ? "projects" : r.view;
}

/** Returns the link to the page of the project in dir. */
export const projectHref = (dir: string) => `#projects/${encodeURIComponent(dir)}`;

/** Returns the link to the page of the file called name in the project
 * in dir. */
export const fileHref = (dir: string, name: string) =>
  `#files/${encodeURIComponent(dir)}/${encodeURIComponent(name)}`;

/** Returns the title of the view at r. */
export function pageTitle(r: Route): string {
  switch (r.view) {
    case "project":
      return `${r.dir.split("/").filter(Boolean).pop() ?? "Project"} · Project`;
    case "worktrees":
      return "Worktrees";
    case "diff":
      return `${r.dir.split("/").filter(Boolean).pop() ?? "Worktree"} · Diff`;
    case "file":
      return `${r.name} · ${r.dir.split("/").filter(Boolean).pop() ?? "Project"}`;
    case "learnings":
      return "Learnings";
    case "inbox":
      return "Inbox";
    case "projects":
      return "Projects";
  }
}
