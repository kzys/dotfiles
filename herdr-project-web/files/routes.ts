// The server's route behind the page's view of a project's file.

import type { Hono } from "hono";
import type { Herdr } from "../herdr/backend.ts";
import { openProjects, readProjectFile } from "../state.ts";

/** What the file route needs of the server. */
export type FilesServer = {
  projectRoot: string;
  // Herdr's panes and workspaces as last read, whose workspaces keep closed
  // projects listed.
  herdr: () => Herdr | null;
};

/** Adds the file route to routes, for server: a file of a project the page
 * lists, as readProjectFile reads it. */
export function routeFiles(routes: Hono, server: FilesServer) {
  routes.get("/files", (c) => {
    // Only the files of the projects the page lists, not any file asked for.
    const dir = c.req.query("dir");
    const file = openProjects(server.projectRoot, server.herdr()).some(([d]) => d === dir)
      ? readProjectFile(dir!, c.req.query("name") ?? "")
      : null;
    return file === null ? c.json({ error: "no such file" }, 404) : c.json(file);
  });
}
