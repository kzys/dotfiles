// Acting on agents from the page: messages wait in an outbox until their
// agent is idle, since text typed at a prompt could answer it. Prompts are
// shown, not answered: keys sent to one can't be tied to what it asks.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { jsonBody, limit, only } from "./http.ts";
import { isFree } from "./herdr/backend.ts";
import type { HookEvent } from "./hooks.ts";
import { loadState, saveState } from "./statefile.ts";

// A message, for the session in its pane when it was written, if known: a
// later agent in that pane didn't ask for it.
export type Queued = { id: string; text: string; at: number; session?: string };

// Messages for a pane that is gone, as Herdr gives a moved pane a new id.
export type Undelivered = { pane: string; messages: Queued[] };

// What the page shows of an agent, besides what Herdr says of it.
export type AgentView = { queued: Queued[]; permission: { detail: string; at: number } | null };

/** Keeps messages for agents in path by pane, surviving restarts, and
 * sends them with send once ready, which looks at the pane again, says
 * it can take them, returning the session in it, "" if unknown, or null. */
export class Outbox {
  private path: string;
  private send: (pane: string, text: string) => Promise<unknown>;
  private ready: (pane: string) => Promise<string | null>;
  private queues: Record<string, Queued[]>;
  private sending = new Set<string>();
  private next = 0;

  constructor(
    path: string,
    send: (pane: string, text: string) => Promise<unknown>,
    ready: (pane: string) => Promise<string | null>,
  ) {
    this.path = path;
    this.send = send;
    this.ready = ready;
    this.queues = (loadState(path) as Record<string, Queued[]> | null) ?? {};
  }

  /** Returns the messages waiting for pane. */
  queued(pane: string): Queued[] {
    return this.queues[pane] ?? [];
  }

  /** Returns all the messages waiting, by pane. */
  all(): Record<string, Queued[]> {
    return this.queues;
  }

  /** Queues text for session, if known, in pane. */
  add(pane: string, text: string, session?: string, at = Date.now()) {
    this.set(pane, [...this.queued(pane), { id: `${at}-${this.next++}`, text, at, ...(session ? { session } : {}) }]);
  }

  /** Removes the message with id from pane's queue, and returns whether
   * it was there and not already being sent. */
  cancel(pane: string, id: string): boolean {
    if (this.sending.has(pane)) return false;
    const kept = this.queued(pane).filter((m) => m.id !== id);
    if (kept.length === this.queued(pane).length) return false;
    this.set(pane, kept);
    return true;
  }

  /** Sends each idle pane its messages as one, from statuses, what Herdr
   * says of each pane, keeping them if that fails. Messages for panes
   * statuses doesn't list wait. Returns whether it sent any. */
  async deliver(statuses: Record<string, string>): Promise<boolean> {
    const panes = Object.keys(this.queues).filter((p) => isFree(statuses[p]) && !this.sending.has(p));
    const sent = await Promise.all(panes.map((p) => this.deliverTo(p)));
    return sent.includes(true);
  }

  private async deliverTo(pane: string): Promise<boolean> {
    this.sending.add(pane);
    try {
      const session = await this.ready(pane);
      if (session === null) return false;
      const messages = this.queued(pane).filter((m) => !m.session || !session || m.session === session);
      if (!messages.length) return false;
      await this.send(pane, messages.map((m) => m.text).join("\n\n"));
      // Messages can arrive while it sends.
      this.set(pane, this.queued(pane).filter((m) => !messages.some((s) => s.id === m.id)));
      return true;
    } catch (e) {
      console.error("herdr-project-web:", e);
      return false;
    } finally {
      this.sending.delete(pane);
    }
  }

  private set(pane: string, messages: Queued[]) {
    if (messages.length) this.queues[pane] = messages;
    else delete this.queues[pane];
    saveState(this.path, this.queues);
  }
}

/** Returns the messages nothing will deliver, from queued, what the outbox
 * holds by pane, and sessions, the session of each pane with an agent:
 * those of panes without an agent, or with another session. */
export function undelivered(queued: Record<string, Queued[]>, sessions: Record<string, string>): Undelivered[] {
  return Object.entries(queued).flatMap(([pane, all]) => {
    const messages = all.filter((m) => !Object.hasOwn(sessions, pane) || (m.session && sessions[pane] && m.session !== sessions[pane]));
    return messages.length ? [{ pane, messages }] : [];
  });
}

/** Returns the permission an agent waits for, from its last hook event
 * and what Herdr says it is doing, or null. */
export function permission(event: HookEvent | undefined, status: string | undefined): AgentView["permission"] {
  if (status !== "blocked" || event?.event !== "PermissionRequest" || !event.detail) return null;
  return { detail: event.detail, at: event.at };
}

/** Forgets, in latest, the permission requests of panes that stopped
 * being blocked between statuses before and after: they were answered,
 * so a later prompt that blocks the agent is another one. */
export function forgetAnswered(latest: Map<string, HookEvent>, before: Record<string, string>, after: Record<string, string>) {
  for (const [pane, event] of latest)
    if (event.event === "PermissionRequest" && before[pane] === "blocked" && after[pane] !== "blocked") latest.delete(pane);
}

/** Reports whether a request with these headers comes from the page
 * itself, at one of hosts. Browsers set Origin on every POST, so another
 * site can't pass as the page. */
export function fromPage(headers: Headers, hosts: Set<string>): boolean {
  const origin = headers.get("origin") ?? "";
  return origin.startsWith("http://") && hosts.has(origin.slice("http://".length))
    && headers.get("content-type") === "application/json";
}

export type AgentActions = {
  outbox: Outbox;
  // Whether pane has an agent.
  known: (pane: string) => boolean;
  // The session of the agent in pane, if known.
  session: (pane: string) => string | undefined;
  focus: (pane: string) => Promise<unknown>;
  // Called after anything the page shows changed.
  changed: () => void;
};

/** Adds to app the requests to act on an agent, under /api/agents. Those
 * that allowed refuses get 403. */
export function routeAgents(app: Hono, actions: AgentActions, allowed: (headers: Headers) => boolean = () => true) {
  const agents = new Hono();
  agents.use(only(allowed));
  // Only the agents in panes that have one.
  const known = createMiddleware(async (c, next) =>
    actions.known(c.req.param("pane")!) ? next() : c.json({ error: "no such agent" }, 404)
  );

  // Queues {text} for the agent in pane.
  agents.post("/:pane/messages", limit((c) => c.json({ error: "too large" }, 413)), known, async (c) => {
    const pane = c.req.param("pane");
    const { text } = await jsonBody(c);
    if (typeof text !== "string" || !text.trim()) return c.json({ error: "no text" }, 400);
    actions.outbox.add(pane, text.trim(), actions.session(pane));
    actions.changed();
    return c.body(null, 204);
  });

  // Cancels a queued message, even for a pane that is gone.
  agents.delete("/:pane/messages/:id", (c) => {
    if (!actions.outbox.cancel(c.req.param("pane"), c.req.param("id"))) return c.json({ error: "already sent" }, 404);
    actions.changed();
    return c.body(null, 204);
  });

  agents.post("/:pane/focus", known, async (c) => {
    await actions.focus(c.req.param("pane"));
    return c.body(null, 204);
  });

  app.route("/api/agents", agents);
}
