// Acting on agents from the page: messages wait in an outbox until their
// agent is idle, since text typed at a prompt could answer it. Prompts are
// shown, not answered: keys sent to one can't be tied to what it asks.

import type { IncomingMessage, ServerResponse } from "node:http";
import { type HookEvent, readBody } from "./hooks.ts";
import { loadState, saveState } from "./statefile.ts";

export type Queued = { id: string; text: string; at: number };

// What the page shows of an agent, besides what Herdr says of it.
export type AgentView = { queued: Queued[]; permission: { detail: string; at: number } | null };

const free = (status: string | undefined) => status === "idle" || status === "done";

/** Keeps messages for agents in path by pane, surviving restarts, and
 * sends them with send once ready, which looks at the pane again, says
 * it can still take them. */
export class Outbox {
  private path: string;
  private send: (pane: string, text: string) => Promise<unknown>;
  private ready: (pane: string) => Promise<boolean>;
  private queues: Record<string, Queued[]>;
  private sending = new Set<string>();
  private next = 0;

  constructor(path: string, send: (pane: string, text: string) => Promise<unknown>, ready: (pane: string) => Promise<boolean>) {
    this.path = path;
    this.send = send;
    this.ready = ready;
    this.queues = (loadState(path) as Record<string, Queued[]> | null) ?? {};
  }

  /** Returns the messages waiting for pane. */
  queued(pane: string): Queued[] {
    return this.queues[pane] ?? [];
  }

  /** Queues text for pane. */
  add(pane: string, text: string, at = Date.now()) {
    this.set(pane, [...this.queued(pane), { id: `${at}-${this.next++}`, text, at }]);
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
    const panes = Object.keys(this.queues).filter((p) => free(statuses[p]) && !this.sending.has(p));
    const sent = await Promise.all(panes.map((p) => this.deliverTo(p)));
    return sent.includes(true);
  }

  private async deliverTo(pane: string): Promise<boolean> {
    const messages = this.queued(pane);
    this.sending.add(pane);
    try {
      if (!(await this.ready(pane))) return false;
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
export function fromPage(headers: IncomingMessage["headers"], hosts: Set<string>): boolean {
  const origin = headers.origin ?? "";
  return origin.startsWith("http://") && hosts.has(origin.slice("http://".length))
    && headers["content-type"] === "application/json";
}

export type AgentActions = {
  outbox: Outbox;
  // Whether pane has an agent.
  known: (pane: string) => boolean;
  focus: (pane: string) => Promise<unknown>;
  // Called after anything the page shows changed.
  changed: () => void;
};

/** Returns the pane and action of a request's path under /api/agents,
 * with the id of a message if it names one, or null if it isn't one. */
export function agentPath(path: string): { pane: string; action: string; id?: string } | null {
  const m = /^\/api\/agents\/([^/]+)\/(messages|focus)(?:\/([^/]+))?$/.exec(path);
  if (!m) return null;
  try {
    return { pane: decodeURIComponent(m[1]), action: m[2], ...(m[3] ? { id: decodeURIComponent(m[3]) } : {}) };
  } catch {
    return null;
  }
}

/** Handles a request to act on an agent, already known to come from the
 * page, as agentPath parsed it. */
export async function handleAgent(
  req: IncomingMessage,
  res: ServerResponse,
  { pane, action, id }: { pane: string; action: string; id?: string },
  actions: AgentActions,
) {
  const reply = (status: number, error?: string) => {
    if (error) res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error }));
    else res.writeHead(status).end();
  };
  const raw = await readBody(req);
  if (raw === null) return reply(413, "too large");
  let body: { text?: unknown };
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return reply(400, "not JSON");
  }
  if (req.method === "DELETE" && action === "messages" && id) {
    if (!actions.outbox.cancel(pane, id)) return reply(404, "already sent");
    actions.changed();
    return reply(204);
  }
  if (req.method !== "POST" || id) return reply(404, "no such action");
  if (!actions.known(pane)) return reply(404, "no such agent");
  if (action === "messages") {
    if (typeof body.text !== "string" || !body.text.trim()) return reply(400, "no text");
    actions.outbox.add(pane, body.text.trim());
    actions.changed();
    return reply(204);
  }
  await actions.focus(pane);
  return reply(204);
}
