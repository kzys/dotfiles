// The page's views, by its location: its path, as /pulls, or after its #.

// The paths the page is served at besides /, each a view.
export const PAGE_PATHS = ["/pulls"];

/** Reports whether the page is served at pathname. */
export const isPagePath = (pathname: string) => pathname === "/" || PAGE_PATHS.includes(pathname);

/** Returns the location route reads from the page's pathname and hash:
 * the hash without its #, if any, else the path without its first /. */
export function locationKey(pathname: string, hash: string): string {
  return hash.replace(/^#/, "") || pathname.slice(1);
}

/** Returns where the view of hash, from a link made before it moved to a
 * path, is now, or null if it hasn't moved. */
export function movedTo(hash: string): string | null {
  const path = `/${hash.replace(/^#/, "")}`;
  return PAGE_PATHS.includes(path) ? path : null;
}

export type Route =
  | { view: "inbox" }
  | { view: "projects" }
  | { view: "project"; dir: string }
  | { view: "worktrees" }
  | { view: "diff"; dir: string }
  | { view: "file"; dir: string; name: string }
  | { view: "learnings" }
  | { view: "pulls" };

/** Returns s decoded from a URL, or as is if it isn't encoded right. */
export function decodeHash(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Returns the view at hash, the page's location as locationKey reads it.
 * Any location the page doesn't know shows the inbox. */
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
  if (hash === "pulls") return { view: "pulls" };
  return { view: "inbox" };
}

/** Returns the tab of the page's console strip that r is under. */
export function tab(r: Route): "inbox" | "pulls" | "projects" | "worktrees" | "learnings" {
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
    case "pulls":
      return "Pull requests";
    case "inbox":
      return "Inbox";
    case "projects":
      return "Projects";
  }
}
