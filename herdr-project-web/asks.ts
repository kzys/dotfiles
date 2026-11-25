// Asking every agent a question from the page, and the replies they send
// back with herdr-project --reply, kept across restarts.

import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import type { Queued } from "./agents.ts";
import type { Herdr } from "./herdr/backend.ts";
import { jsonBody, limit, only } from "./http.ts";
import { baseName } from "./paths.ts";
import { loadState, saveState } from "./statefile.ts";

// An agent asked: its pane, how the page names it, the id of the message
// queued for it, the token its reply carries, and its reply, if any.
export type Asked = { pane: string; label: string; message: string; token: string; reply: { text: string; at: number } | null };

// A question and the agents it went to.
export type Ask = { id: string; text: string; at: number; agents: Asked[] };

// Where the question to an agent stands: waiting in the outbox, typed in
// and not answered, answered, or not answered by an agent that is gone.
export type AskStatus = "queued" | "asked" | "replied" | "gone";

// What the page shows of a question.
export type AskView = {
  id: string;
  text: string;
  at: number;
  agents: { label: string; status: AskStatus; reply: { text: string; at: number } | null }[];
};

// An agent to ask: its pane, its label, and its session, if known.
export type Askee = { pane: string; label: string; session?: string };

// How many questions are kept.
const KEPT = 20;

/** Returns what an agent is told for text, the question, so that it
 * replies with token. */
export function askMessage(text: string, token: string): string {
  return `${text}\n\n(The user asked every agent this from herdr-project-web. ` +
    `Reply by running: herdr-project --reply ${token} '<your answer>')`;
}

/** Returns what the page shows of asks, newest first, from queued, what
 * the outbox holds by pane, and present, which reports whether a pane may
 * still have its agent. */
export function askViews(asks: Ask[], queued: Record<string, Queued[]>, present: (pane: string) => boolean): AskView[] {
  return [...asks].reverse().map(({ id, text, at, agents: asked }) => ({
    id, text, at,
    agents: asked.map((a) => {
      const status: AskStatus = a.reply ? "replied"
        : (queued[a.pane] ?? []).some((m) => m.id === a.message) ? "queued"
        : present(a.pane) ? "asked" : "gone";
      return { label: a.label, status, reply: a.reply };
    }),
  }));
}

/** The questions asked, kept in path. */
export class Asks {
  private path: string;
  private asks: Ask[];
  private token: () => string;

  constructor(path: string, token = () => randomBytes(6).toString("hex")) {
    this.path = path;
    this.token = token;
    const kept = loadState(path);
    this.asks = Array.isArray(kept) ? (kept as Ask[]) : [];
  }

  /** Returns the questions, oldest first. */
  all(): Ask[] {
    return this.asks;
  }

  /** Asks each of agents text, queueing the message to each with queue,
   * which returns the message's id, and returns the question. */
  ask(text: string, agents: Askee[], queue: (pane: string, text: string, session?: string) => string, at = Date.now()): Ask {
    const asked = agents.map(({ pane, label, session }) => {
      const token = this.token();
      return { pane, label, token, message: queue(pane, askMessage(text, token), session), reply: null };
    });
    const ask = { id: `${at}`, text, at, agents: asked };
    this.asks = [...this.asks, ask].slice(-KEPT);
    saveState(this.path, this.asks);
    return ask;
  }

  /** Records text as the reply of the agent asked with token, replacing
   * an earlier one, and returns whether token was one. */
  reply(token: string, text: string, at = Date.now()): boolean {
    const found = this.asks.flatMap((a) => a.agents).find((a) => a.token === token);
    if (!found) return false;
    found.reply = { text, at };
    saveState(this.path, this.asks);
    return true;
  }
}

/** Returns the agents among herdr's panes to ask, each named after the
 * project in projects whose panes hold it, else its directory, and its
 * role, else its pane. */
export function askees(herdr: Herdr | null, projects: { name: string; panes: { id: string }[] }[]): Askee[] {
  return (herdr?.panes ?? []).filter((p) => p.agent).map((p) => {
    const where = projects.find((q) => q.panes.some((a) => a.id === p.pane_id))?.name ?? (baseName(p.cwd ?? "") || "?");
    const session = p.agent_session?.value;
    return { pane: p.pane_id, label: `${where} · ${p.tokens?.role || p.pane_id}`, ...(session ? { session } : {}) };
  });
}

/** What the routes of the questions need of the server. */
export type AsksServer = {
  asks: Asks;
  // The agents to ask now.
  askees: () => Askee[];
  // Queues text for session, if known, in pane, returning its id.
  queue: (pane: string, text: string, session?: string) => string;
  // Called after what the page shows changed.
  changed: () => void;
};

/** Adds to page the request to ask every agent {text}, which only
 * requests that allowed lets through may make, and to socket the one an
 * agent replies with, a form of its token and text. */
export function routeAsks(page: Hono, socket: Hono, server: AsksServer, allowed: (headers: Headers) => boolean) {
  page.post("/api/asks", limit((c) => c.json({ error: "too large" }, 413)), only(allowed), async (c) => {
    const { text } = await jsonBody(c);
    if (typeof text !== "string" || !text.trim()) return c.json({ error: "no question" }, 400);
    const agents = server.askees();
    if (!agents.length) return c.json({ error: "no agents to ask" }, 409);
    server.asks.ask(text.trim(), agents, server.queue);
    server.changed();
    return c.body(null, 204);
  });
  socket.post("/reply", limit((c) => c.text("reply too long\n", 413)), async (c) => {
    const form = new URLSearchParams(await c.req.text());
    const text = form.get("text")?.trim();
    if (!text) return c.text("no reply\n", 400);
    if (!server.asks.reply(form.get("token") ?? "", text)) return c.text("no such question\n", 404);
    server.changed();
    return c.text("Sent.\n");
  });
}
