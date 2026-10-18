// Learning from Herdr's socket when its panes and workspaces change,
// rather than asking it over and over.

import { type Socket, createConnection } from "node:net";
import type { Herdr } from "./state.ts";

// The events that change what the page shows of Herdr, besides agent
// states, which Herdr only reports pane by pane.
const LIFECYCLE = [
  "pane.created",
  "pane.closed",
  "pane.exited",
  "pane.moved",
  "pane.agent_detected",
  "workspace.created",
  "workspace.closed",
  "workspace.renamed",
  "workspace.updated",
  "workspace.moved",
  "workspace.reordered",
];

/** Returns the subscriptions for events.subscribe that tell when what
 * the page shows of herdr changes: its lifecycle events, and the agent
 * state of each agent pane in it. */
export function subscriptions(herdr: Herdr | null): object[] {
  const agents = (herdr?.panes ?? []).filter((p) => p.agent).map((p) => p.pane_id).sort();
  return [
    ...LIFECYCLE.map((type) => ({ type })),
    ...agents.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id })),
  ];
}

/** Subscribes to Herdr's events through the socket that locate finds,
 * calling changed whenever one arrives, or the subscription fails or
 * ends, as when Herdr restarts or the reader falls behind. Either way
 * the caller should read Herdr again, and call update with what it
 * read, which subscribes again if the agent panes changed. After a
 * failure, changed waits retryMs, doubling while failures go on, up to
 * a minute. */
export class HerdrEvents {
  private locate: () => Promise<string>;
  private changed: () => void;
  private socket: Socket | null = null;
  private wanted = "";
  private retry: ReturnType<typeof setTimeout> | undefined;
  private firstRetryMs: number;
  private retryMs: number;
  private attempt = 0;

  constructor(locate: () => Promise<string>, changed: () => void, retryMs = 2000) {
    this.locate = locate;
    this.changed = changed;
    this.firstRetryMs = this.retryMs = retryMs;
  }

  /** Stops listening. */
  close() {
    clearTimeout(this.retry);
    this.attempt++;
    this.socket?.destroy();
    this.socket = null;
  }

  /** Subscribes for herdr, as subscriptions returns them, unless the
   * current subscription already covers them. */
  update(herdr: Herdr | null) {
    const subs = JSON.stringify(subscriptions(herdr));
    if (subs === this.wanted && this.socket) return;
    this.wanted = subs;
    this.connect();
  }

  private async connect() {
    this.close();
    const attempt = this.attempt;
    const fail = () => {
      if (attempt !== this.attempt) return;
      this.attempt++;
      this.socket?.destroy();
      this.socket = null;
      // Read again, which subscribes again, waiting longer while it
      // fails, as while Herdr is gone.
      this.retry = setTimeout(this.changed, this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 60_000);
    };
    let path: string;
    try {
      path = await this.locate();
    } catch {
      return fail();
    }
    if (attempt !== this.attempt) return;
    const socket = createConnection(path);
    this.socket = socket;
    let buf = "";
    socket.on("connect", () => {
      const request = { id: "watch", method: "events.subscribe", params: { subscriptions: JSON.parse(this.wanted) } };
      socket.write(JSON.stringify(request) + "\n");
    });
    socket.on("data", (data) => {
      const lines = (buf + data.toString()).split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        let message: { error?: unknown; result?: { type?: string } };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        // Such as a pane that closed before we subscribed, or events lost.
        if (message.error) return fail();
        if (message.result?.type === "subscription_started") this.retryMs = this.firstRetryMs;
        // Once subscribed, read again for what happened before.
        this.changed();
      }
    });
    socket.on("error", fail);
    socket.on("close", fail);
  }
}
