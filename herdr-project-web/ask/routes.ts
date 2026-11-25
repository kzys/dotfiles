// The server's routes for asking every agent a question from the page,
// and for the replies agents send back with herdr-project --reply.

import type { Hono } from "hono";
import { jsonBody, limit, only } from "../http.ts";
import type { Askee, Asks } from "./ask.ts";

/** What the routes of the questions need of the server. */
export type AsksServer = {
  asks: Asks;
  // The agents to ask now.
  askees: () => Askee[];
  // Queues text for session, if known, in pane, returning its id.
  queue: (pane: string, text: string, session?: string) => string;
  // Called after a question is asked or replied to.
  changed: () => void;
};

/** Adds to page the request to ask every agent {text}, which only
 * requests that allowed lets through may make. */
export function routeAsks(page: Hono, server: AsksServer, allowed: (headers: Headers) => boolean) {
  page.post("/api/asks", limit((c) => c.json({ error: "too large" }, 413)), only(allowed), async (c) => {
    const { text } = await jsonBody(c);
    if (typeof text !== "string" || !text.trim()) return c.json({ error: "no question" }, 400);
    const agents = server.askees();
    if (!agents.length) return c.json({ error: "no agents to ask" }, 409);
    server.asks.ask(text.trim(), agents, server.queue);
    server.changed();
    return c.body(null, 204);
  });
}

/** Adds to socket the request an agent replies with: a form of the token
 * it was asked with and its text. */
export function routeReplies(socket: Hono, server: AsksServer) {
  socket.post("/reply", limit((c) => c.text("reply too long\n", 413)), async (c) => {
    const form = new URLSearchParams(await c.req.text());
    const text = form.get("text")?.trim();
    if (!text) return c.text("no reply\n", 400);
    if (!server.asks.reply(form.get("token") ?? "", text)) return c.text("no such question\n", 404);
    server.changed();
    return c.text("Sent.\n");
  });
}
