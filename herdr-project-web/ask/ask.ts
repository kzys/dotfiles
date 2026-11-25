// Asking every agent a question from the page, and the replies they send
// back with herdr-project --reply, kept across restarts.

import { randomBytes } from "node:crypto";
import type { Queued } from "../agents.ts";
import type { Herdr } from "../herdr/backend.ts";
import { baseName } from "../paths.ts";
import { loadState, saveState } from "../statefile.ts";

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
    `Reply by running herdr-project --reply ${token} followed by your answer, quoted for the shell.)`;
}

/** Returns what the page shows of asks, newest first, from queued, what
 * the outbox holds by pane, lost, the ids of messages in it that nothing
 * will deliver, and present, which reports whether a pane may still have
 * its agent. */
export function askViews(
  asks: Ask[], queued: Record<string, Queued[]>, lost: Set<string>, present: (pane: string) => boolean,
): AskView[] {
  return [...asks].reverse().map(({ id, text, at, agents: asked }) => ({
    id, text, at,
    agents: asked.map((a) => {
      const status: AskStatus = a.reply ? "replied"
        : lost.has(a.message) || !present(a.pane) ? "gone"
        : (queued[a.pane] ?? []).some((m) => m.id === a.message) ? "queued"
        : "asked";
      return { label: a.label, status, reply: a.reply };
    }),
  }));
}

/** The questions asked, kept in path. */
export class Asks {
  private path: string;
  private asks: Ask[];
  private token: () => string;
  private next = 0;

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
    const ask = { id: `${at}-${this.next++}`, text, at, agents: asked };
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

/** Returns the agents among herdr's panes to ask, those whose status
 * Herdr reports, as the outbox delivers only to them, each named after
 * the project in projects whose panes hold it, else its directory, and
 * its role, else its pane. */
export function askees(herdr: Herdr | null, projects: { name: string; panes: { id: string }[] }[]): Askee[] {
  return (herdr?.panes ?? []).filter((p) => p.agent && p.agent_status).map((p) => {
    const where = projects.find((q) => q.panes.some((a) => a.id === p.pane_id))?.name ?? (baseName(p.cwd ?? "") || "?");
    const session = p.agent_session?.value;
    return { pane: p.pane_id, label: `${where} · ${p.tokens?.role || p.pane_id}`, ...(session ? { session } : {}) };
  });
}
