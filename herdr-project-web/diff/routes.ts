// The server's routes behind the page's diffs: a worktree's diff, more of a
// file around it, and the branch it is compared with.

import type { Hono } from "hono";
import type { Herdr } from "../herdr/backend.ts";
import { highlightDiff, highlightLines } from "./highlight.ts";
import { jsonBody, limit, only } from "../http.ts";
import { openProjects } from "../project/project.ts";
import { worktreeDirs } from "../project/worktrees.ts";
import { type PullBases, changedSince, checkoutDirs, fileLines, setBase, worktreeDiff } from "./git.ts";

/** What the diff routes need of the server. */
export type DiffServer = {
  projectRoot: string;
  reposRoot: string;
  // Herdr's panes and workspaces as last read, whose workspaces keep closed
  // projects listed.
  herdr: () => Herdr | null;
  // The bases of the pull requests found, which their branches compare with.
  bases: () => PullBases;
};

/** Returns the worktrees the page lists, the only ones the routes serve:
 * those in the projects that are open or still have a workspace in herdr,
 * and the checkouts in reposRoot, where some tasks work on their
 * branches. */
function listedWorktrees(server: DiffServer): string[] {
  return [
    ...openProjects(server.projectRoot, server.herdr()).flatMap(([dir]) => worktreeDirs(dir)),
    ...checkoutDirs(server.reposRoot),
  ];
}

/** Adds the diff routes to routes, for server: a listed worktree's diff,
 * lines of a file in one for more context, and setting the base it is
 * compared with, which only requests that allowed lets through may do. */
export function routeDiff(routes: Hono, server: DiffServer, allowed: (headers: Headers) => boolean) {
  const listed = (dir: string) => listedWorktrees(server).includes(dir);
  routes.get("/diff", async (c) => {
    // Only the worktrees the page lists, not any directory asked for.
    const dir = c.req.query("dir") ?? "";
    if (!listed(dir)) return c.json({ error: "no such worktree" }, 404);
    return c.json(await highlightDiff(await worktreeDiff(dir, server.bases())));
  });
  routes.get("/diff/lines", async (c) => {
    const dir = c.req.query("dir") ?? "";
    const path = c.req.query("path") ?? "";
    const known = listed(dir);
    // Newer lines would pass for unchanged ones in the diff taken then.
    if (known && changedSince(dir, path, Number(c.req.query("at")))) return c.json({ error: "the file changed" }, 409);
    const lines = known ? fileLines(dir, path, Number(c.req.query("from")), Number(c.req.query("to"))) : null;
    return lines === null ? c.json({ error: "no such file" }, 404) : c.json(await highlightLines(path, lines));
  });
  routes.post("/diff/base", limit(), only(allowed), async (c) => {
    const { dir, branch, base } = await jsonBody(c);
    if (!listed(dir)) return c.body(null, 404);
    if (typeof branch !== "string" || !(base === null || typeof base === "string")) return c.body(null, 400);
    return c.body(null, (await setBase(dir, branch, base)) ? 204 : 409);
  });
}
