// The server's routes behind the pull requests' board: moving a pull
// request to another column and asking Copilot to review it.

import type { Hono } from "hono";
import * as board from "../board.ts";
import type { BoardStore } from "../board-store.ts";
import { requestCopilot } from "../github/api.ts";
import type { PullCheck } from "../github/poll.ts";
import { limit } from "../hooks.ts";

/** What the board's routes need of the server. */
export type PullsServer = {
  // The last check of the pull requests, or null before one.
  latest: () => PullCheck | null;
  // The columns the user moved pull requests to, and what came of asking
  // Copilot to review each.
  board: BoardStore;
  // Called after the board changes.
  changed: () => void;
};

/** Adds the board's routes to routes, for server, which only requests that
 * allowed lets through may use: moving an open pull request to a column of
 * board.MOVABLE, or back for null, and asking Copilot to review one. */
export function routePulls(routes: Hono, server: PullsServer, allowed: (headers: Headers) => boolean) {
  const isOpen = (url: unknown) => board.isOpen(server.latest()?.pulls ?? [], url);
  routes.post("/pulls/stage", limit(), async (c) => {
    if (!allowed(c.req.raw.headers)) return c.body(null, 403);
    const { url, stage } = JSON.parse((await c.req.text()) || "{}");
    if (!(stage === null || board.MOVABLE.includes(stage))) return c.body(null, 400);
    if (!isOpen(url)) return c.body(null, 404);
    if (server.board.move(url, stage)) server.changed();
    return c.body(null, 204);
  });
  routes.post("/pulls/copilot", limit(), async (c) => {
    if (!allowed(c.req.raw.headers)) return c.body(null, 403);
    const { url } = JSON.parse((await c.req.text()) || "{}");
    if (!isOpen(url)) return c.body(null, 404);
    const asked = await server.board.askCopilot(url, (u) => requestCopilot(u));
    server.changed();
    return c.body(null, asked ? 204 : 502);
  });
}
