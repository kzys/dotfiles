// The server's routes behind the pull requests' board: moving a pull
// request to another column and asking Copilot to review it.

import type { Hono } from "hono";
import * as board from "./board.ts";
import type { BoardStore } from "./board-store.ts";
import { requestCopilot } from "../github/api.ts";
import type { PullCheck } from "../github/poll.ts";
import { jsonBody, limit, only } from "../http.ts";

/** What the board's routes need of the server. */
export type PullsServer = {
  // The last check of the pull requests, or null before one.
  latest: () => PullCheck | null;
  // The columns the user moved pull requests to, and what came of asking
  // Copilot to review each.
  board: BoardStore;
};

/** Adds the board's routes to routes, for server, which only requests that
 * allowed lets through may use: moving an open pull request to a column of
 * board.MOVABLE, or back for null, and asking Copilot to review one. */
export function routePulls(routes: Hono, server: PullsServer, allowed: (headers: Headers) => boolean) {
  const isOpen = (url: unknown) => board.isOpen(server.latest()?.pulls ?? [], url);
  routes.post("/pulls/stage", limit(), only(allowed), async (c) => {
    const { url, stage } = await jsonBody(c);
    if (!(stage === null || board.MOVABLE.includes(stage))) return c.body(null, 400);
    if (!isOpen(url)) return c.body(null, 404);
    server.board.move(url, stage);
    return c.body(null, 204);
  });
  routes.post("/pulls/copilot", limit(), only(allowed), async (c) => {
    const { url } = await jsonBody(c);
    if (!isOpen(url)) return c.body(null, 404);
    const asked = await server.board.askCopilot(url, (u) => requestCopilot(u));
    return c.body(null, asked ? 204 : 502);
  });
}
