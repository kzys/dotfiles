// The page's views, by its location: its path, as /pulls, or after its #.

import { baseName } from "./paths.ts";

// The paths the page is served at besides /, each a view.
export const PAGE_PATHS = ["/pulls", "/projects"];
// Those of them with more views under them, as /projects/<dir>.
export const NESTED_PATHS = ["/projects"];

/** Returns the path in PAGE_PATHS that pathname is or, if it nests, is
 * under, or null. */
const pagePathOf = (pathname: string) =>
  PAGE_PATHS.find((p) => pathname === p || (NESTED_PATHS.includes(p) && pathname.startsWith(`${p}/`))) ?? null;

/** Reports whether the page is served at pathname. */
export const isPagePath = (pathname: string) => pathname === "/" || pagePathOf(pathname) !== null;

/** Returns the location route reads from the page's pathname and hash:
 * the hash without its #, if any, else the path without its first /. */
export function locationKey(pathname: string, hash: string): string {
  return hash.replace(/^#/, "") || pathname.slice(1);
}

/** Returns where the view at pathname and hash, from a link made before
 * it moved to a path, is now, or null if it hasn't moved: the views after
 * a # at /. */
export function movedTo(pathname: string, hash: string): string | null {
  if (pathname !== "/") return null;
  const path = `/${hash.replace(/^#/, "")}`;
  return path !== "/" && pagePathOf(path) ? path : null;
}

export type Route =
  | { view: "ask" }
  | { view: "projects" }
  | { view: "project"; dir: string }
  // project is the project it was opened from, if known.
  | { view: "diff"; dir: string; project: string | null }
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
 * Any location the page doesn't know shows where every agent is asked. */
export function route(hash: string): Route {
  if (hash === "projects") return { view: "projects" };
  if (hash.startsWith("projects/")) {
    // Directories are encoded, so a / only separates.
    const rest = hash.slice("projects/".length);
    const at = rest.indexOf("/diffs/");
    if (at < 0) return { view: "project", dir: decodeHash(rest) };
    return { view: "diff", dir: decodeHash(rest.slice(at + "/diffs/".length)), project: decodeHash(rest.slice(0, at)) };
  }
  // The list of every worktree is gone; its links go to the projects.
  if (hash === "diffs") return { view: "projects" };
  if (hash.startsWith("diffs/")) return { view: "diff", dir: decodeHash(hash.slice("diffs/".length)), project: null };
  if (hash.startsWith("files/")) {
    const [dir = "", name = ""] = hash.slice("files/".length).split("/");
    return { view: "file", dir: decodeHash(dir), name: decodeHash(name) };
  }
  if (hash === "learnings") return { view: "learnings" };
  if (hash === "pulls") return { view: "pulls" };
  return { view: "ask" };
}

/** Returns the tab of the page's console strip that r is under. */
export function tab(r: Route): "ask" | "pulls" | "projects" | "learnings" {
  return r.view === "diff" || r.view === "file" || r.view === "project" ? "projects" : r.view;
}

/** Returns the link to the page of the project in dir. */
export const projectHref = (dir: string) => `/projects/${encodeURIComponent(dir)}`;

/** Returns the link to the diff of the worktree in dir, a worktree of
 * the project in project. */
export const diffHref = (project: string, dir: string) =>
  `/projects/${encodeURIComponent(project)}/diffs/${encodeURIComponent(dir)}`;

/** Returns the link to the page of the file called name in the project
 * in dir. */
export const fileHref = (dir: string, name: string) =>
  `#files/${encodeURIComponent(dir)}/${encodeURIComponent(name)}`;

/** Returns the title of the view at r. */
export function pageTitle(r: Route): string {
  switch (r.view) {
    case "project":
      return `${baseName(r.dir) || "Project"} · Project`;
    case "diff":
      return `${baseName(r.dir) || "Worktree"} · Diff`;
    case "file":
      return `${r.name} · ${baseName(r.dir) || "Project"}`;
    case "learnings":
      return "Learnings";
    case "pulls":
      return "Pull requests";
    case "projects":
      return "Projects";
    case "ask":
      return "Ask agents";
  }
}
