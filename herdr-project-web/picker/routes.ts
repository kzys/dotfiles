// The server's routes that give the project picker its rows and open
// them, for the terminal picker and the Herdr app's.

import type { Hono } from "hono";
import type { Backend } from "../herdr/backend.ts";
import { jsonBody, limit, only } from "../http.ts";
import { type PlanDeps, choices, inboxChoices, open, paneRecords, plan, rowNotes } from "./rows.ts";
import { codexSessions } from "../agents/sessions.ts";
import type { State } from "../state.ts";

/** What the picker's routes need of the server. */
export type PickerServer = {
  // Where the picker opens rows: the Herdr app, for one that asks, else
  // the TUI.
  backend: (app: boolean) => Backend;
  // The page's state as last sent, for the inbox.
  page: () => State;
  projectRoot: string;
  // herdr-project, which starts agents.
  launcher: string;
  planDeps: PlanDeps;
};

/** Adds the picker's routes to routes, for server: its rows, a row's
 * notes and opening a row, which only requests that allowed lets through
 * may do. */
export function routePicker(routes: Hono, server: PickerServer, allowed: (headers: Headers) => boolean) {
  const panes = async (app: boolean) => paneRecords({ workspaces: [], panes: await server.backend(app).panes() });
  routes.get("/picker", async (c) => {
    const app = c.req.query("app") !== undefined;
    return c.json(c.req.query("inbox") !== undefined
      ? inboxChoices(await panes(app), codexSessions(), server.page())
      : choices(await panes(app), server.projectRoot, codexSessions()));
  });
  routes.get("/picker/notes", (c) => c.text(rowNotes(c.req.query("kind") ?? "", c.req.query("dir") ?? "", c.req.query("session") ?? "")));
  routes.post("/picker/open", limit(), only(allowed), async (c) => {
    const { row, agent, app } = await jsonBody(c);
    // Panes as they are now, not as last read: going by old ones could
    // resume a session that already runs.
    const planned = await plan(row, agent, await panes(Boolean(app)), server.projectRoot, server.launcher, server.planDeps);
    await open(planned, server.backend(Boolean(app)).opener());
    return c.body(null, 204);
  });
}
